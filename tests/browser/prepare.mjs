// Root integration owns one preparation and one F26 runtime qualification, then
// serial project waves. Do not prefix test:e2e with prepare:e2e. Compiler fixtures
// finish before workspace Vite starts (their temporary tsconfigs cause reloads).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  loadPreparedNativeConsumers,
  prepareNativeConsumers,
} from '../svelte/package-consumers.mjs'
import { verifyPreparedNativeConsumers } from './prepare-svelte.mjs'
import { chromiumLaunchOptions } from './chromium.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const pnpm = process.env.npm_execpath
assert.ok(pnpm, 'Run through pnpm prepare:e2e or pnpm test:e2e')
assert.equal(
  process.platform,
  'linux',
  'Packed qualification requires Linux bubblewrap'
)
const argv = process.argv.slice(2)
const options = { test: false, scope: 'all', keep: false, forwarded: [] }
for (let index = 0; index < argv.length; index++) {
  const flag = argv[index]
  if (flag === '--') {
    options.forwarded = argv.slice(index + 1)
    break
  }
  if (flag === '--test') options.test = true
  else if (flag === '--native' || flag === '--legacy')
    options.scope = flag.slice(2)
  else if (flag === '--keep-artifacts') options.keep = true
  else if (
    ['--reuse-manifest', '--artifact-root', '--manifest'].includes(flag)
  ) {
    const value = argv[++index]
    assert.ok(value && !value.startsWith('--'), `Missing value for ${flag}`)
    options[
      flag === '--reuse-manifest'
        ? 'reuseManifest'
        : flag === '--artifact-root'
        ? 'artifactRoot'
        : 'manifestPath'
    ] = resolve(value)
  } else
    throw new Error(`Unknown option ${flag}; Playwright arguments follow --`)
}
if (options.test) waveArguments()
const id = `${Date.now()}-${randomUUID()}`
const artifactRoot = options.reuseManifest
  ? undefined
  : options.artifactRoot ?? join('/var/tmp', `shadergradient-e2e-${id}`)
const manifestPath =
  options.reuseManifest ??
  options.manifestPath ??
  join(artifactRoot, 'prepared-native-consumers.json')
const evidence = join(root, 'e2e-results', id)
await mkdir(evidence, { recursive: true })
const abort = new AbortController()
const resources = []
let nativeOperation
const servers = []
const processNames = new Map()
const report = {
  schemaVersion: 1,
  id,
  startedAt: new Date().toISOString(),
  status: 'running',
  node: process.version,
  scope: options.scope,
  mode: options.test ? 'integrated-browser-run' : 'preparation-only',
  workerLimit: 1,
  chromiumLaunchOptions,
  evidence,
  limits: {
    logBytesPerProcess: 16 * 1024 ** 2,
    // Complete multi-engine proof retains canonical blobs and official report assets.
    browserOutputBytes: 3 * 1024 ** 3,
    retainedEvidence:
      'At most three verified inactive owned runs, maximum age 14 days; startup refuses excess or expired evidence until it is archived and explicitly retired. The controller never automatically deletes historical evidence. CI artifacts expire after 14 days.',
    legacy:
      'F02 retains 22 known product failures and 24 unexercised editor/Next limits; no baseline suppression or re-pinning.',
    touch:
      'Firefox hasTouch=true/isMobile=false; Firefox/WebKit trusted touchMove unavailable, tap and keyboard still execute.',
    ssr: 'Support /ssr is a workspace public-import probe. Installed plain compiled SSR and Kit HTTP SSR/request isolation are qualified by the F26 runtime report.',
  },
  processes: [],
  cleanup: [],
}
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const putJSON = (path, data) =>
  writeFile(path, JSON.stringify(data, null, 2) + '\n')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const text = (error) => error?.stack ?? String(error)
let prepared
let ownsArtifacts = false
let ownsLease = false
const leasePath = join(root, 'e2e-results/.active-owner.json')
const ownerRecord = {
  owner: 'shadergradient-root-browser/schema-1',
  id,
  pid: process.pid,
  root,
  evidence,
  createdAt: report.startedAt,
}
let failure
let signalFailure
let outputMonitor
let budgetTask = Promise.resolve()
let budgetRunning = false

function fail(error) {
  if (!abort.signal.aborted) abort.abort(error)
  for (const resource of resources) resource.interrupt()
}
function interrupt(error) {
  signalFailure ??= error
  report.interruption ??= {
    exitCode: error.exitCode,
    error: text(error),
  }
  fail(error)
}
const onINT = () =>
  interrupt(
    Object.assign(new Error('Root integration interrupted (SIGINT)'), {
      exitCode: 130,
    })
  )
const onTERM = () =>
  interrupt(
    Object.assign(new Error('Root integration interrupted (SIGTERM)'), {
      exitCode: 143,
    })
  )
process.once('SIGINT', onINT)
process.once('SIGTERM', onTERM)

function dead(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, 'Invalid owner PID')
  try {
    process.kill(pid, 0)
    return false
  } catch (cause) {
    if (cause.code === 'ESRCH') return true
    throw cause
  }
}
async function claimIntegration() {
  abort.signal.throwIfAborted()
  let lease
  try {
    lease = await open(leasePath, 'wx', 0o600)
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause
    assert.ok(
      (await lstat(leasePath)).isFile(),
      'Root run lease must be a regular file'
    )
    const previous = await json(leasePath)
    assert.equal(previous.owner, ownerRecord.owner)
    assert.equal(previous.root, root)
    throw new Error(
      dead(previous.pid)
        ? `Unfinished integration lease from PID ${previous.pid}: cleanup is unverified. Preserve ${leasePath}; verify all owned workers/namespaces stopped before operator reconciliation.`
        : `Another root integration owns this checkout (PID ${previous.pid}); never run concurrent preparations`
    )
  }
  ownsLease = true
  try {
    await lease.writeFile(JSON.stringify(ownerRecord) + '\n')
  } finally {
    await lease.close()
  }
  await writeFile(
    join(evidence, '.owner.json'),
    JSON.stringify(ownerRecord) + '\n',
    { flag: 'wx' }
  )
  const inactive = []
  for (const item of await readdir(join(root, 'e2e-results'), {
    withFileTypes: true,
  })) {
    if (!item.isDirectory() || item.name === id) continue
    const directory = join(root, 'e2e-results', item.name)
    const record = await json(join(directory, '.owner.json')).catch((cause) => {
      if (cause.code === 'ENOENT') return null
      throw cause
    })
    if (
      !record ||
      record.owner !== ownerRecord.owner ||
      record.root !== root ||
      record.evidence !== directory ||
      record.id !== item.name ||
      !dead(record.pid)
    )
      continue
    const result = await json(join(directory, 'report.json')).catch((cause) => {
      if (cause.code === 'ENOENT') return null
      throw cause
    })
    if (
      !result?.finishedAt ||
      result.id !== record.id ||
      result.evidence !== directory ||
      !Array.isArray(result.cleanup) ||
      result.cleanup.some((item) => item.status !== 'released') ||
      result.processes?.some((item) => item.status !== 'released')
    )
      continue
    const created = Date.parse(record.createdAt)
    assert.ok(
      Number.isFinite(created),
      `Invalid evidence ownership age: ${directory}`
    )
    inactive.push({ directory, record, created })
  }
  inactive.sort((left, right) => right.created - left.created)
  const retirementRequired = inactive.filter(
    (item, index) =>
      index >= 2 || Date.now() - item.created >= 14 * 24 * 60 * 60_000
  )
  assert.equal(
    retirementRequired.length,
    0,
    `Historical evidence requires operator retention: ${retirementRequired
      .map((item) => item.directory)
      .join(
        ', '
      )}. Verify a lossless archive before explicitly retiring owned originals; dead workers do not make unique evidence disposable.`
  )
}

async function bounded(action, milliseconds, label, signal) {
  let timer
  let cancel
  const stop = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: exceeded ${milliseconds}ms`)),
      milliseconds
    )
    if (signal) {
      cancel = () => reject(signal.reason)
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    }
  })
  try {
    return await Promise.race([Promise.resolve().then(action), stop])
  } finally {
    clearTimeout(timer)
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}

// Each launcher has a uniquely owned detached process group. The exact packed
// isolation arguments/env are preserved except redundant bwrap --new-session,
// and only in its option prefix: nested setsid otherwise escapes this group.
function start(
  name,
  launch,
  { service = false, echo = false, allowDuringFailure = false } = {}
) {
  if (!allowDuringFailure) abort.signal.throwIfAborted()
  const occurrence = (processNames.get(name) ?? 0) + 1
  processNames.set(name, occurrence)
  if (occurrence > 1) name = `${name}-${occurrence}`
  const args = [...launch.args]
  const separator = args.indexOf('--')
  const option = args.indexOf('--new-session')
  const removedNewSession =
    basename(launch.command) === 'bwrap' &&
    option >= 0 &&
    (separator < 0 || option < separator)
  if (removedNewSession) args.splice(option, 1)
  const record = {
    name,
    command: launch.command,
    declaredArgs: launch.args,
    args,
    cwd: launch.cwd,
    removedNewSession,
    log: join(evidence, `${name}.log`),
    signals: [],
    status: 'starting',
  }
  report.processes.push(record)
  const log = createWriteStream(record.log, { flags: 'wx' })
  let child
  let closed = false
  let stopping = false
  let error
  let output = ''
  let bytes = 0
  let finish
  let closePromise
  const completion = new Promise((accept) => {
    finish = accept
  })
  function send(signal) {
    if (!child?.pid) return
    try {
      process.kill(-child.pid, signal)
      record.signals.push(signal)
    } catch (cause) {
      if (cause.code !== 'ESRCH') throw cause
    }
  }
  function stop() {
    closePromise ??= (async () => {
      stopping = true
      try {
        if (child?.pid) {
          send('SIGTERM')
          try {
            await bounded(
              () => completion,
              8000,
              `${name}: graceful process/pipe shutdown`
            )
          } catch {
            send('SIGKILL')
            await bounded(
              () => completion,
              4000,
              `${name}: forced process/pipe shutdown`
            )
          }
          // The group may outlive its leader even after stdio drains.
          send('SIGKILL')
          await bounded(
            async () => {
              for (;;) {
                try {
                  process.kill(-child.pid, 0)
                } catch (cause) {
                  if (cause.code === 'ESRCH') return
                  throw cause
                }
                await delay(10)
              }
            },
            4000,
            `${name}: verify owned process group stopped`
          )
        }
        record.status = 'released'
      } finally {
        child?.stdout?.destroy()
        child?.stderr?.destroy()
        child?.unref()
        record.pipesDetached = true
        await bounded(
          () =>
            new Promise((accept, reject) => {
              if (log.closed) return accept()
              log.once('error', reject)
              log.end(accept)
            }),
          2000,
          `${name}: close log`
        )
      }
    })()
    return closePromise
  }
  const resource = {
    stop,
    interrupt: () => {
      if (!stopping) send('SIGTERM')
    },
  }
  resources.push(resource) // Register cleanup before acquiring the child.
  log.on('error', (cause) => {
    error = cause
    fail(cause)
  })
  try {
    child = spawn(launch.command, args, {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    record.pid = child.pid ?? null
    record.processGroup = child.pid ?? null
    record.status = 'running'
    const append = (chunk) => {
      bytes += chunk.length
      record.outputBytes = bytes
      output = (output + chunk.toString()).slice(-32768)
      if (bytes <= report.limits.logBytesPerProcess) log.write(chunk)
      else if (!error) {
        error = new Error(`${name}: 16 MiB log budget exceeded`)
        fail(error)
      }
      if (echo && bytes <= report.limits.logBytesPerProcess)
        process.stdout.write(chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (cause) => {
      error = cause
      closed = true
      finish()
      if (service && !stopping) fail(cause)
    })
    child.once('exit', (code, signal) => {
      record.exit = { code, signal }
      if (service && !stopping)
        fail(
          new Error(
            `${name}: unexpected server exit ${JSON.stringify(
              record.exit
            )}\n${output}`
          )
        )
    })
    child.once('close', (code, signal) => {
      closed = true
      record.exit ??= { code, signal }
      finish()
    })
  } catch (cause) {
    error = cause
    closed = true
    finish()
  }
  return {
    stop,
    completion,
    record,
    get output() {
      return output
    },
    assertRunning() {
      if (error) throw error
      assert.ok(
        !closed && child.exitCode === null && child.signalCode === null,
        `${name}: server stopped\n${output}`
      )
    },
    assertSuccess() {
      if (error) throw error
      assert.equal(
        record.exit?.code,
        0,
        `${name}: failed ${JSON.stringify(record.exit)}\n${output}`
      )
    },
  }
}
const pnpmLaunch = (args, env = {}) => ({
  command: process.execPath,
  args: [pnpm, ...args],
  cwd: root,
  env,
})
async function command(name, launch, timeout = 20 * 60_000) {
  const child = start(name, launch, { echo: true })
  try {
    await bounded(() => child.completion, timeout, name, abort.signal)
    child.assertSuccess()
    return child.output
  } finally {
    await child.stop()
  }
}
const run = (name, args, env) => command(name, pnpmLaunch(args, env))

async function assertFreePort(port) {
  const server = createServer()
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, accept)
    })
  } finally {
    if (server.listening)
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept()))
      )
  }
}
async function serve(name, port, launch, path = '/', { nuxtDev = false } = {}) {
  await assertFreePort(port) // Never silently reuse or kill an unknown service.
  const child = start(name, launch, { service: true })
  servers.push({ name, port, child })
  const readiness = {
    timeoutMs: 120_000,
    nuxtDev,
    attempts: 0,
    loading503Responses: 0,
    firstResponse: null,
    lastResponse: null,
  }
  child.record.readiness = readiness
  const deadline = Date.now() + readiness.timeoutMs
  while (Date.now() < deadline) {
    abort.signal.throwIfAborted()
    child.assertRunning()
    readiness.attempts++
    let interval = 100
    let receivedResponse = false
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        // Nuxt CLI eagerly listens before its application handler exists.
        // Negotiate its structured loading protocol, not an incidental phrase
        // in an HTML/error page. All other launchers retain ordinary readiness.
        ...(nuxtDev ? { headers: { accept: 'application/json' } } : {}),
        signal: AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(5000, deadline - Date.now()))
          ),
        ]),
      })
      receivedResponse = true
      const body = Buffer.from(await response.arrayBuffer())
      const observed = {
        at: new Date().toISOString(),
        status: response.status,
        headers: Object.fromEntries(response.headers),
        bytes: body.length,
        sha256: digest(body),
        bodyPrefix: body.subarray(0, 8192).toString(),
      }
      readiness.firstResponse ??= observed
      readiness.lastResponse = observed
      let loading = false
      if (
        nuxtDev &&
        response.status === 503 &&
        response.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase() === 'application/json' &&
        response.headers.get('retry-after') === '1' &&
        response.headers
          .get('cache-control')
          ?.split(',')
          .some((value) => value.trim().toLowerCase() === 'no-store')
      ) {
        // @nuxt/cli4.0.1 #renderLoadingScreen exposes these protocol fields.
        // Loading failures take its separate error-response branch. A generic
        // application 503, malformed loading response or any 500 fails below.
        const state = JSON.parse(body.toString())
        loading =
          state?.error === true &&
          state.status === 503 &&
          typeof state.phase === 'string' &&
          state.phase.length > 0 &&
          Number.isFinite(state.progress) &&
          state.progress >= 0 &&
          state.progress <= 1 &&
          Number.isFinite(state.elapsed) &&
          state.elapsed >= 0
      }
      if (loading) {
        readiness.loading503Responses++
        interval = 1000 // Honor the positively identified Retry-After:1.
      } else {
        assert.equal(
          response.status,
          200,
          `${name}: readiness HTTP ${
            response.status
          } is a real failure; ${JSON.stringify(observed)}`
        )
        child.record.readyAt = new Date().toISOString()
        return
      }
    } catch (cause) {
      abort.signal.throwIfAborted()
      if (
        cause.cause?.code !== 'ECONNREFUSED' &&
        (receivedResponse || cause.cause?.code !== 'ECONNRESET') &&
        cause.name !== 'TimeoutError'
      )
        throw cause
    }
    await delay(
      Math.min(interval, Math.max(0, deadline - Date.now())),
      undefined,
      { signal: abort.signal }
    )
  }
  throw new Error(
    `${name}: readiness deadline exceeded; last response ${JSON.stringify(
      readiness.lastResponse
    )}`
  )
}

// The support fixture itself rejects existing registrations. Reconcile only a
// verified dead registration + matching private marker; never signal that PID.
async function reconcileSupport() {
  const directory = join(
    root,
    'packages/shadergradient-svelte/.sprint-lifecycle-support'
  )
  const registration = `${directory}.owner.json`
  let record
  try {
    assert.ok(
      (await lstat(registration)).isFile(),
      'Support registration must be a regular file'
    )
    record = await json(registration)
  } catch (cause) {
    if (cause.code === 'ENOENT') return
    throw cause
  }
  assert.equal(record.root, directory)
  assert.equal(record.source, join(root, 'tests/svelte/lifecycle-support'))
  assert.equal(record.origin, 'http://127.0.0.1:3114')
  assert.ok(
    typeof record.owner === 'string' && /^[0-9a-f-]{36}$/.test(record.owner)
  )
  assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1)
  try {
    process.kill(record.pid, 0)
    throw new Error(
      `Support registration is active (PID ${record.pid}); preserve it`
    )
  } catch (cause) {
    if (cause.code !== 'ESRCH') throw cause
  }
  await assertFreePort(3114)
  const stat = await lstat(directory).catch((cause) => {
    if (cause.code !== 'ENOENT') throw cause
    return null
  })
  if (stat) {
    assert.ok(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'Refusing non-directory stale support root'
    )
    assert.deepEqual(
      await json(join(directory, '.owner.json')),
      record,
      'Stale support owner markers disagree'
    )
    // Re-read immediately before removal; an ownership change is not ours.
    assert.deepEqual(await json(registration), record)
    await rm(directory, { recursive: true })
  }
  assert.deepEqual(await json(registration), record)
  await rm(registration)
  report.cleanup.push({
    name: 'verified-dead-support-registration',
    owner: record.owner,
    pid: record.pid,
    status: 'released',
  })
}

async function prepareLegacy(core) {
  await run('vue-build', ['--filter', '@shadergradient/vue', 'build'])
  const vueManifest = await json(
    join(root, 'packages/shadergradient-vue/package.json')
  )
  const destination = join(evidence, 'legacy-packages')
  await mkdir(destination)
  await run('vue-pack', [
    '--dir',
    'packages/shadergradient-vue',
    'pack',
    '--pack-destination',
    destination,
  ])
  const vueTarball = join(
    destination,
    `shadergradient-vue-${vueManifest.version}.tgz`
  )
  report.legacyPackages = {
    core: { tarball: core.tarball, sha256: core.sha256 },
    vue: { tarball: vueTarball, sha256: digest(await readFile(vueTarball)) },
    consumers: [],
  }
  for (const name of ['example-vite-vue', 'example-nuxtjs']) {
    const directory = join(root, 'apps/examples', name)
    // Both existing independent starter overrides resolve exactly this newly
    // packed core, not a registry version which may not have been published.
    await copyFile(core.tarball, join(directory, 'shadergradient-core.tgz'))
    await copyFile(vueTarball, join(directory, basename(vueTarball)))
    await run(`${name}-install`, [
      '--dir',
      directory,
      'install',
      '--no-frozen-lockfile',
    ])
    const vueDirectory = await realpath(
      join(directory, 'node_modules/@shadergradient/vue')
    )
    const installed = {}
    for (const kind of ['core', 'vue']) {
      const packageDirectory =
        kind === 'vue'
          ? vueDirectory
          : await realpath(join(vueDirectory, '..', 'core'))
      installed[kind] = { root: packageDirectory, files: {} }
      for (const file of ['index.js', 'index.d.ts']) {
        const actual = await readFile(join(packageDirectory, 'dist', file))
        assert.deepEqual(
          actual,
          await readFile(
            join(root, `packages/shadergradient-${kind}/dist`, file)
          ),
          `${name}: installed ${kind}/${file} differs from the fresh build`
        )
        installed[kind].files[file] = digest(actual)
      }
    }
    report.legacyPackages.consumers.push({ name, installed })
    console.log(
      `${name}: installed core and Vue JavaScript/declarations match the fresh builds`
    )
  }
}

async function startServers(project) {
  const selected = project.metadata.integrationServer
  const native = project.metadata.nativeSvelte === true
  if (!native) {
    assert.notEqual(
      process.env.E2E_USE_DEV_SERVERS,
      '1',
      'Serial integration requires owned servers; external server mode is unsupported'
    )
    // Preserve all five legacy project identities; library + Vue dev share3105.
    for (const [name, port, args] of [
      [
        'vue-dev',
        3105,
        [
          '--filter',
          'example-vue-dev',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          '3105',
          '--strictPort',
        ],
      ],
      [
        'nuxt-dev',
        3106,
        [
          '--filter',
          'example-nuxtjs-dev',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          '3106',
        ],
      ],
      [
        'vue-standalone',
        3107,
        [
          '--dir',
          'apps/examples/example-vite-vue',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          '3107',
          '--strictPort',
        ],
      ],
      [
        'nuxt-standalone',
        3108,
        [
          '--dir',
          'apps/examples/example-nuxtjs',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          '3108',
        ],
      ],
    ].filter(([name]) => name === selected))
      await serve(name, port, pnpmLaunch(args), '/', {
        nuxtDev: name === 'nuxt-dev' || name === 'nuxt-standalone',
      })
    assert.ok(
      servers.some(({ name }) => name === selected),
      `Unknown integrationServer ${selected}`
    )
    return
  }
  await reconcileSupport()
  const fixture = { VITE_GRADIENT_FIXTURE: '1' }
  if (selected === 'native-plain')
    await serve(
      'native-plain',
      3110,
      pnpmLaunch(
        [
          '--filter',
          'example-svelte-dev',
          'dev',
          '--port',
          '3110',
          '--strictPort',
        ],
        fixture
      )
    )
  if (selected === 'native-kit')
    await serve('native-kit', 3111, {
      command: process.execPath,
      args: ['build/index.js'],
      cwd: join(root, 'apps/example-sveltekit-dev'),
      env: {
        HOST: '127.0.0.1',
        PORT: '3111',
        ORIGIN: 'http://127.0.0.1:3111',
        NODE_ENV: 'production',
        ...fixture,
      },
    })
  await serve(
    'native-support',
    3114,
    {
      command: process.execPath,
      args: ['tests/svelte/lifecycle-support/server.mjs', '--port', '3114'],
      cwd: root,
      env: fixture,
    },
    '/ownership'
  )
  for (const id of ['plain-current', 'kit-current']) {
    if (selected !== `native-packed-${id}`) continue
    const cell = prepared.consumers.find((consumer) => consumer.id === id)
    assert.ok(cell, `Missing prepared current consumer ${id}`)
    await serve(`native-packed-${id}`, cell.port, cell.launch)
  }
  assert.ok(
    servers.some(({ name }) => name === selected),
    `Unknown integrationServer ${selected}`
  )
}

// Record actual backend and natural headless Firefox fallback. Supported desktop
// and touch projects are never removed based on this probe. Only engine-specific
// trusted-touchMove cases have their existing explicit protocol applicability.
async function probeBackends(project, waveName) {
  const { chromium, firefox, webkit } = await import('@playwright/test')
  assert.ok(
    process.env.DISPLAY,
    'Headed Firefox requires actual DISPLAY; use xvfb-run -a -s "-screen 0 2560x2160x24 -nolisten tcp"'
  )
  const geometry = await command(
    'headed-display-geometry',
    { command: 'xrandr', args: ['--current'], cwd: root },
    10_000
  )
  const dimensions = geometry.match(/current\s+(\d+)\s+x\s+(\d+)/)
  assert.ok(
    dimensions,
    'Cannot establish actual headed display geometry from xrandr'
  )
  report.display = {
    display: process.env.DISPLAY,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
  }
  assert.ok(
    report.display.width >= 2560 && report.display.height >= 2160,
    'Full Firefox touch qualification requires an adequate display: xvfb-run -a -s "-screen 0 2560x2160x24 -nolisten tcp"'
  )
  report.capabilities ??= []
  for (const [engine, headed] of [
    ['chromium', false],
    ['firefox', true],
    ['webkit', false],
    ['firefox', false],
  ]) {
    abort.signal.throwIfAborted()
    const launching = { chromium, firefox, webkit }[engine].launch({
      headless: !headed,
      timeout: 30_000,
      ...(engine === 'chromium' ? chromiumLaunchOptions : {}),
      ...(engine === 'firefox'
        ? {
            env: {
              ...process.env,
              DISPLAY: process.env.DISPLAY,
              LIBGL_ALWAYS_SOFTWARE: '1',
            },
            firefoxUserPrefs: {
              'webgl.force-enabled': true,
              'webgl.disabled': false,
              'webgl.enable-webgl2': true,
            },
          }
        : {}),
    })
    let closing
    const resource = {
      interrupt() {
        void resource.stop().catch(() => {})
      },
      stop() {
        closing ??= bounded(
          async () => {
            const browser = await launching
            await browser.close()
            report.cleanup.push({
              name: `capability-browser-${engine}-${
                headed ? 'headed' : 'headless'
              }`,
              status: 'released',
            })
          },
          40_000,
          `${engine}: launch/cleanup`
        )
        return closing
      },
    }
    resources.push(resource)
    const browser = await launching
    let backendFailure
    try {
      const ports = {
        'native-plain': 3110,
        'native-kit': 3111,
        'native-packed-plain-current': 3112,
        'native-packed-kit-current': 3113,
      }
      for (const [name, port] of [
        [
          project.metadata.integrationServer,
          ports[project.metadata.integrationServer],
        ],
      ]) {
        abort.signal.throwIfAborted()
        const probe = {
          wave: waveName,
          name,
          engine,
          headless: !headed,
          browserVersion: browser.version(),
          requestURL: `http://127.0.0.1:${port}`,
          phase: 'create-context',
          status: 'running',
          console: [],
          pageErrors: [],
          requestFailures: [],
          responses: [],
          dropped: {},
          diagnosticErrors: [],
        }
        const remember = (kind, value) => {
          if (probe[kind].length === 100) {
            probe[kind].shift()
            probe.dropped[kind] = (probe.dropped[kind] ?? 0) + 1
          }
          probe[kind].push(value)
        }
        const short = (value) => String(value).slice(0, 4096)
        let context
        let page
        let probeFailure
        try {
          context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
          })
          probe.phase = 'create-page'
          page = await context.newPage()
          const errors = []
          page.on('pageerror', (error) => {
            errors.push(text(error))
            remember('pageErrors', short(text(error)))
          })
          page.on('console', (message) =>
            remember('console', {
              type: message.type(),
              text: short(message.text()),
              location: {
                ...message.location(),
                url: short(message.location().url),
              },
            })
          )
          page.on('requestfailed', (request) =>
            remember('requestFailures', {
              url: short(request.url()),
              resourceType: request.resourceType(),
              error: short(request.failure()?.errorText),
            })
          )
          page.on('response', (response) =>
            remember('responses', {
              url: short(response.url()),
              status: response.status(),
              resourceType: response.request().resourceType(),
            })
          )
          probe.phase = 'navigate'
          const response = await page.goto(probe.requestURL, {
            timeout: 30_000,
          })
          probe.navigationStatus = response?.status() ?? null
          probe.phase = 'fixture-ready'
          await page.waitForFunction(
            () => window.gradientFixture?.version === 1,
            undefined,
            { timeout: 30_000 }
          )
          probe.phase = 'scroll-wrapper'
          await page
            .locator(
              '[data-testid="gradient-wrapper"], [data-testid="managed-placement"]'
            )
            .first()
            .scrollIntoViewIfNeeded()
          probe.phase = 'webgl-observation'
          const gl = await page.evaluate(() => {
            const canvas = document.createElement('canvas')
            const gl = canvas.getContext('webgl2')
            if (!gl) return { webgl2: false }
            const ext = gl.getExtension('WEBGL_debug_renderer_info')
            const result = {
              webgl2: true,
              version: gl.getParameter(gl.VERSION),
              vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
              renderer: ext
                ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                : null,
            }
            gl.getExtension('WEBGL_lose_context')?.loseContext()
            return result
          })
          probe.phase = 'frame-ready'
          await page.waitForFunction(
            () => {
              const state = window.gradientFixture.snapshot()
              return (
                (state.canvas &&
                  state.scene &&
                  state.counters.completedFrames > 0) ||
                state.fallback === 'unsupported'
              )
            },
            undefined,
            { timeout: 30_000 }
          )
          probe.phase = 'fixture-snapshot'
          const state = await page.evaluate(() =>
            window.gradientFixture.snapshot()
          )
          const capability = {
            wave: waveName,
            name,
            engine,
            headless: !headed,
            browserVersion: browser.version(),
            display: headed ? process.env.DISPLAY : null,
            ...gl,
            fallback: state.fallback,
            completedFrames: state.counters.completedFrames,
            errors: state.errors,
            pageErrors: errors,
          }
          report.capabilities.push(capability)
          await putJSON(
            join(evidence, 'native-capabilities.json'),
            report.capabilities
          )
          probe.phase = 'capability-assertions'
          assert.deepEqual(
            errors,
            [],
            `${engine}/${name}: page errors during actual capability observation`
          )
          if (engine !== 'firefox' || headed || gl.webgl2) {
            assert.equal(
              gl.webgl2,
              true,
              `${engine}/${name}: supported project requires actual WebGL2, not a capability skip`
            )
            assert.equal(state.fallback, null)
            assert.ok(state.counters.completedFrames > 0)
          } else {
            assert.equal(
              state.fallback,
              'unsupported',
              'Natural headless Firefox missing-WebGL path must present honest fallback'
            )
            assert.equal(state.canvas, null)
            assert.ok(
              state.errors.some((error) => error.code === 'unsupported-webgl')
            )
            probe.phase = 'fallback-screenshot'
            await page.screenshot({
              path: join(
                evidence,
                `${waveName}-${name}-firefox-headless-fallback.png`
              ),
            })
          }
        } catch (cause) {
          probeFailure = cause
          probe.status = 'failed'
          probe.error = text(cause)
          probe.failedAt = new Date().toISOString()
          probe.actualURL = page?.url() ?? null
          const stem = `${waveName}-${name}-${engine}-${
            headed ? 'headed' : 'headless'
          }-probe-failure`
          const capture = async (label, action) => {
            try {
              await bounded(action, 2000, `Probe failure ${label}`)
            } catch (error) {
              probe.diagnosticErrors.push({ label, error: text(error) })
            }
          }
          // No readiness retries: observe the failed page once before teardown.
          // Independent bounded captures keep a broken page from hiding evidence.
          if (page) {
            await Promise.all([
              capture('DOM/fixture', async () => {
                probe.dom = await page.evaluate(() => {
                  const fixture = window.gradientFixture
                  const result = {
                    url: location.href,
                    readyState: document.readyState,
                    title: document.title.slice(0, 4096),
                    bodyText: document.body?.innerText.slice(0, 16384) ?? null,
                    canvases: document.querySelectorAll('canvas').length,
                    wrappers: document.querySelectorAll(
                      '[data-testid="gradient-wrapper"], [data-testid="managed-placement"]'
                    ).length,
                    fixturePresent: fixture != null,
                    fixtureType: typeof fixture,
                    fixtureVersion: String(fixture?.version).slice(0, 128),
                    snapshotAvailable: typeof fixture?.snapshot === 'function',
                  }
                  if (result.snapshotAvailable) {
                    try {
                      const snapshot = JSON.stringify(fixture.snapshot())
                      result.snapshotJSON = snapshot?.slice(0, 65536) ?? null
                      result.snapshotTruncated = snapshot?.length > 65536
                    } catch (error) {
                      result.snapshotError = String(error).slice(0, 4096)
                    }
                  }
                  return result
                })
              }),
              capture('HTML', async () => {
                const html = await page.evaluate(() => ({
                  content: document.documentElement.outerHTML.slice(0, 262144),
                  truncated: document.documentElement.outerHTML.length > 262144,
                }))
                const bytes = Buffer.from(html.content).subarray(0, 262144)
                const path = join(evidence, `${stem}.html`)
                await writeFile(path, bytes)
                probe.html = {
                  path,
                  bytes: bytes.length,
                  truncated:
                    html.truncated ||
                    Buffer.byteLength(html.content) > bytes.length,
                }
              }),
              capture('PNG', async () => {
                const png = await page.screenshot({
                  type: 'png',
                  fullPage: false,
                  timeout: 1500,
                })
                if (png.length > 8 * 1024 ** 2)
                  throw new Error(`Probe PNG exceeds 8 MiB: ${png.length}`)
                const path = join(evidence, `${stem}.png`)
                await writeFile(path, png)
                probe.png = { path, bytes: png.length }
              }),
            ])
          }
          report.probeFailures ??= []
          report.probeFailures.push(probe)
          await capture('failure report', () =>
            putJSON(
              join(evidence, 'native-probe-failures.json'),
              report.probeFailures
            )
          )
          throw cause
        } finally {
          if (context) {
            try {
              await context.close()
            } catch (cause) {
              if (!probeFailure) throw cause
              report.cleanup.push({
                name: `capability-context-${engine}-${name}`,
                status: 'failed',
                error: text(cause),
              })
            }
          }
        }
      }
      assert.equal(
        browser.contexts().length,
        0,
        `${engine}: capability contexts must be closed`
      )
    } catch (cause) {
      backendFailure = cause
      throw cause
    } finally {
      try {
        await resource.stop()
      } catch (cause) {
        if (!backendFailure) throw cause
        report.cleanup.push({
          name: `capability-browser-${engine}-${
            headed ? 'headed' : 'headless'
          }`,
          status: 'failed',
          error: text(cause),
        })
      }
    }
  }
}

function selectedCases(result) {
  const cases = []
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title]
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        const titlePath = [...titles.slice(1), spec.title]
        cases.push({
          representativeSpecId: spec.id,
          key: JSON.stringify([
            test.projectName,
            spec.file,
            spec.line,
            spec.column,
            titlePath,
          ]),
          projectName: test.projectName,
          file: spec.file,
          line: spec.line,
          column: spec.column,
          titlePath,
          expectedStatus: test.expectedStatus,
          results: test.results,
        })
      }
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of result.suites ?? []) visit(suite)
  return cases
}

function waveArguments(planning = false) {
  const args = []
  // Freeze supported selectors against the original full-config list.
  const resolved = new Set(['--project', '--test-list', '--test-list-invert'])
  const owned = new Set(['--reporter', '--add-reporter', '--output'])
  const withValue = new Set([
    '--grep',
    '-g',
    '--grep-invert',
    '-G',
    '--max-failures',
    '--tsconfig',
  ])
  const unsupported = new Set([
    '--list',
    '--help',
    '-h',
    '--ui',
    '--ui-host',
    '--ui-port',
    '--debug',
    '--config',
    '-c',
    '--browser',
    '--pass-with-no-tests',
    '--workers',
    '-j',
    '--retries',
    '--timeout',
    '--global-timeout',
    '--trace',
    '--repeat-each',
    '--fully-parallel',
    '--shard',
    '--last-failed',
    '--last-failed-file',
    '--only-changed',
  ])
  for (let index = 0; index < options.forwarded.length; index++) {
    const arg = options.forwarded[index]
    const flag = arg.split('=')[0]
    assert.ok(
      !unsupported.has(flag) && !/^-(?:j|c).+/.test(flag),
      `${flag} is unsupported by the bounded integration supervisor; selection filters remain supported`
    )
    if (
      (planning || !resolved.has(flag)) &&
      (!owned.has(flag) || (planning && flag === '--output'))
    ) {
      args.push(arg)
      if (withValue.has(flag) && !arg.includes('=')) {
        assert.ok(options.forwarded[index + 1], `Missing value for ${flag}`)
        args.push(options.forwarded[++index])
      }
      continue
    }
    if (flag === '--project') {
      assert.ok(
        arg.includes('=') ||
          (options.forwarded[index + 1] &&
            !options.forwarded[index + 1].startsWith('-')),
        'Missing --project selection'
      )
      while (
        options.forwarded[index + 1] &&
        !options.forwarded[index + 1].startsWith('-')
      )
        index++
    } else if (arg.includes('=')) continue
    else {
      assert.ok(
        options.forwarded[index + 1] &&
          !options.forwarded[index + 1].startsWith('-'),
        `Missing value for ${flag}`
      )
      index++
    }
  }
  return args
}

async function assertSupportReleased() {
  await reconcileSupport()
  for (const path of [
    '.sprint-lifecycle-support',
    '.sprint-lifecycle-support.owner.json',
  ])
    await assert.rejects(
      lstat(join(root, 'packages/shadergradient-svelte', path)),
      { code: 'ENOENT' }
    )
  report.cleanup.push({
    name: 'native-support-private-namespace',
    status: 'released',
  })
}

async function releaseWave(resourceIndex, serverIndex) {
  const errors = []
  const stopped = await Promise.allSettled(
    resources
      .slice(resourceIndex)
      .reverse()
      .map((resource) => resource.stop())
  )
  for (const result of stopped)
    if (result.status === 'rejected') errors.push(result.reason)
  const activeServers = servers.slice(serverIndex)
  for (const { name, port } of activeServers) {
    try {
      await assertFreePort(port)
      report.cleanup.push({ name, port, status: 'released' })
    } catch (cause) {
      errors.push(cause)
      report.cleanup.push({ name, port, status: 'failed', error: text(cause) })
    }
  }
  if (activeServers.some(({ name }) => name === 'native-support')) {
    try {
      await assertSupportReleased()
    } catch (cause) {
      errors.push(cause)
      report.cleanup.push({
        name: 'native-support-private-namespace',
        status: 'failed',
        error: text(cause),
      })
    }
  }
  if (errors.length) {
    for (const cause of errors)
      report.cleanup.push({ status: 'failed', error: text(cause) })
    throw new AggregateError(
      errors,
      'Project wave cleanup failed; no next wave'
    )
  }
}

function inside(directory, path) {
  const child = relative(directory, path)
  assert.ok(
    child && !isAbsolute(child) && child !== '..' && !child.startsWith('../'),
    `Evidence path escapes its owned directory: ${path}`
  )
  return child
}

async function evidenceFiles(directory) {
  assert.ok((await lstat(directory)).isDirectory())
  assert.equal(await realpath(directory), directory)
  const files = []
  async function visit(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name)
      const stat = await lstat(path)
      assert.ok(!stat.isSymbolicLink(), `Evidence symlink: ${path}`)
      if (stat.isDirectory()) await visit(path)
      else {
        assert.ok(stat.isFile(), `Non-file evidence: ${path}`)
        files.push({ path, relative: inside(directory, path), stat })
      }
    }
  }
  await visit(directory)
  return files
}

async function evidenceDigest(path) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}

async function attachmentEvidence(cases, directory) {
  const attachments = []
  const hashed = new Map()
  for (const test of cases)
    for (const [attempt, result] of test.results.entries())
      for (const attachment of result.attachments ?? []) {
        let retained
        if (attachment.path) {
          const path = resolve(attachment.path)
          const member = inside(directory, path)
          assert.equal(await realpath(path), path)
          assert.ok((await lstat(path)).isFile())
          if (!hashed.has(path)) hashed.set(path, await evidenceDigest(path))
          retained = { member, ...hashed.get(path) }
        } else {
          assert.equal(typeof attachment.body, 'string')
          const body = Buffer.from(attachment.body, 'base64')
          retained = { inline: true, bytes: body.length, sha256: digest(body) }
        }
        attachments.push({
          case: test.key,
          attempt,
          name: attachment.name,
          contentType: attachment.contentType,
          ...retained,
        })
      }
  return attachments
}

async function removeMergeExpansions(
  directory,
  originals,
  retained = new Set()
) {
  const generated = (await evidenceFiles(directory)).filter(
    (file) => !originals.has(file.relative) && !retained.has(file.relative)
  )
  // All boundaries and file identities are checked before removing anything.
  for (const file of generated) {
    const current = await lstat(file.path)
    assert.ok(current.isFile())
    assert.equal(current.dev, file.stat.dev)
    assert.equal(current.ino, file.stat.ino)
    assert.equal(current.size, file.stat.size)
    assert.equal(current.mtimeMs, file.stat.mtimeMs)
  }
  for (const file of generated) await unlink(file.path)
  return generated.map((file) => ({
    path: file.relative,
    bytes: file.stat.size,
  }))
}

async function collectWaveBlob(wave, blobs, transfer = false) {
  const canonical = join(blobs, `${wave.name}.zip`)
  assert.equal(wave.cleanupStatus, 'released', 'Producer cleanup is unverified')
  const source = await lstat(wave.blob)
  assert.ok(source.isFile(), 'Producer archive must be a regular file')
  assert.equal(await realpath(wave.blob), wave.blob)
  wave.canonicalArchive =
    wave.retention?.archive ?? (await evidenceDigest(wave.blob))
  assert.equal(source.size, wave.canonicalArchive.bytes)
  // link is exclusive and cannot copy payload or overwrite another wave.
  await link(wave.blob, canonical)
  wave.canonicalBlob = canonical
  wave.blobCollected = true
  if (transfer) {
    await unlink(wave.blob)
    wave.blobTransferred = true
  }
}

async function verifyWaveBlob(wave, blobs) {
  assert.ok(wave.blobCollected, 'Wave archive was never collected')
  assert.equal(wave.canonicalBlob, join(blobs, `${wave.name}.zip`))
  inside(blobs, wave.canonicalBlob)
  assert.equal(await realpath(wave.canonicalBlob), wave.canonicalBlob)
  const archive = await lstat(wave.canonicalBlob)
  assert.ok(archive.isFile(), 'Canonical archive must be a regular file')
  assert.ok(wave.canonicalArchive, 'Canonical archive fingerprint is missing')
  assert.equal(archive.size, wave.canonicalArchive.bytes)
  assert.deepEqual(
    await evidenceDigest(wave.canonicalBlob),
    wave.canonicalArchive,
    'Canonical archive changed after collection'
  )
  wave.blobVerification = {
    status: 'verified',
    path: wave.canonicalBlob,
    verifiedAt: new Date().toISOString(),
    ...wave.canonicalArchive,
  }
}

async function retainPassedWave(wave, cases, blobs, deadline) {
  abort.signal.throwIfAborted()
  assert.ok(
    Date.now() < deadline,
    'Playwright shared matrix deadline exhausted before retention'
  )
  const producer = dirname(wave.blob)
  const proof = join(evidence, `${wave.name}-retention.json`)
  const originals = new Set(
    (await evidenceFiles(producer)).map((file) => file.relative)
  )
  assert.deepEqual([...originals], ['report.zip'])
  wave.retention = {
    status: 'validating',
    producer: wave.blob,
    rawOutput: wave.output,
    proof,
    method: 'official-playwright-merge-reports-json/sha256',
  }
  try {
    const remaining = deadline - Date.now()
    assert.ok(
      remaining > 0,
      'Playwright shared matrix deadline exhausted before archive validation'
    )
    const validator = start(
      `${wave.name}-retention`,
      pnpmLaunch(
        ['exec', 'playwright', 'merge-reports', '--reporter=json', producer],
        { PLAYWRIGHT_JSON_OUTPUT_FILE: proof }
      )
    )
    let validationFailure
    try {
      await bounded(
        () => validator.completion,
        Math.min(5 * 60_000, remaining),
        `${wave.name}: validate canonical browser evidence`,
        abort.signal
      )
      validator.assertSuccess()
    } catch (cause) {
      validationFailure = cause
    } finally {
      try {
        await validator.stop()
      } catch (cause) {
        validationFailure ??= cause
      }
    }
    if (validationFailure) throw validationFailure
    abort.signal.throwIfAborted()
    const official = await json(proof)
    assert.deepEqual(official.errors, [], 'Wave report contains global errors')
    const actual = selectedCases(official)
    assert.deepEqual(
      actual.map((test) => test.key).sort(),
      cases.map((test) => test.key).sort(),
      'Canonical wave must cover its exact original plan'
    )
    assert.ok(actual.every((test) => test.results.length))
    const attachments = await attachmentEvidence(actual, producer)
    const retained = new Set(
      attachments.map((item) => `${item.bytes}:${item.sha256}`)
    )
    const rawFiles = []
    for (const file of await evidenceFiles(wave.output)) {
      if (file.relative === '.last-run.json') {
        rawFiles.push({
          path: file.relative,
          contents: await readFile(file.path, 'utf8'),
        })
        continue
      }
      const fingerprint = await evidenceDigest(file.path)
      assert.ok(
        retained.has(`${fingerprint.bytes}:${fingerprint.sha256}`),
        `Raw evidence is absent from the official archive: ${file.path}`
      )
      rawFiles.push({ path: file.relative, ...fingerprint })
    }
    wave.retention.attachments = attachments
    wave.retention.rawFiles = rawFiles
    wave.retention.validatedAt = new Date().toISOString()
    wave.retention.archive = await evidenceDigest(wave.blob)
    abort.signal.throwIfAborted()
    assert.ok(
      Date.now() < deadline,
      'Playwright shared matrix deadline exhausted during archive validation'
    )
    await collectWaveBlob(wave, blobs, true)
    wave.retention.canonical = wave.canonicalBlob
    await putJSON(join(evidence, 'report.json'), report)
    abort.signal.throwIfAborted()
    // Both the producer and official validator have fully released their PGIDs.
    // Every raw payload is now verified in the canonical archive.
    await rm(wave.output, { recursive: true })
    wave.retention.rawOutputRemoved = true
    wave.retention.removedExpansions = await removeMergeExpansions(
      producer,
      new Set(['report.zip'])
    )
    await unlink(proof)
    wave.retention.proofRemoved = true
    assert.ok(
      Date.now() < deadline,
      'Playwright shared matrix deadline exhausted during retention'
    )
    wave.retention.status = 'retained'
  } catch (cause) {
    wave.retention.status = 'failed'
    wave.retention.error = text(cause)
    throw cause
  }
}

async function runProjectWaves(runtime) {
  const forwarded = waveArguments()
  const env = {
    E2E_MANAGED_SERVERS: '1',
    E2E_SCOPE: options.scope,
    E2E_NATIVE_MANIFEST: prepared.manifestPath,
    E2E_NATIVE_RUNTIME_REPORT: runtime.reportPath,
    E2E_INTEGRATION_REPORT: join(evidence, 'report.json'),
  }
  const planPath = join(evidence, 'playwright-plan.json')
  // JSON is written directly by the official reporter, never read from the
  // process's bounded diagnostic tail.
  await command(
    'playwright-plan',
    pnpmLaunch(
      [
        'exec',
        'playwright',
        'test',
        ...waveArguments(true),
        '--list',
        '--reporter=json',
      ],
      { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: planPath }
    )
  )
  const listed = await json(planPath)
  assert.deepEqual(listed.errors, [], 'Playwright collection failed')
  const planned = selectedCases(listed)
  assert.ok(planned.length, 'No browser cases selected; not a passing matrix')
  const projects = listed.config.projects.filter((project) =>
    planned.some((test) => test.projectName === project.name)
  )
  assert.equal(
    new Set(projects.map((project) => project.name)).size,
    projects.length
  )
  for (const project of projects)
    assert.equal(typeof project.metadata?.integrationServer, 'string')
  report.plan = {
    path: planPath,
    cases: planned.map(({ results, ...test }) => test),
    projectCount: projects.length,
    caseCount: planned.length,
    forwarded: options.forwarded,
    reporterPolicy: 'Supervisor-owned blob waves and official JSON/HTML merge',
  }
  report.waves = []
  report.executionMembership = 'unknown-until-official-report-merge'
  report.unexecutedCases = null
  const blobs = join(evidence, 'blobs')
  await mkdir(blobs)
  const deadline = Date.now() + 5 * 60 * 60_000
  report.matrixDeadline = new Date(deadline).toISOString()
  let matrixFailure
  try {
    for (const [index, project] of projects.entries()) {
      abort.signal.throwIfAborted()
      assert.ok(
        Date.now() < deadline,
        'Playwright shared matrix deadline exhausted'
      )
      const waveName = `wave-${String(index + 1).padStart(2, '0')}`
      const cases = planned.filter((test) => test.projectName === project.name)
      const testList = join(evidence, `${waveName}-tests.txt`)
      await writeFile(
        testList,
        cases
          .map(
            (test) =>
              `[${project.name}] › ${test.file}:${test.line}:${
                test.column
              } › ${test.titlePath.join(' › ')}`
          )
          .join('\n') + '\n',
        { flag: 'wx' }
      )
      const wave = {
        name: waveName,
        project: project.name,
        integrationServer: project.metadata.integrationServer,
        plannedCases: cases.length,
        status: 'running',
        startedAt: new Date().toISOString(),
        // Blob reporter clears its output parent, even with OUTPUT_FILE.
        // Each wave therefore owns a separate directory, never merge input.
        blob: join(evidence, `${waveName}-blob`, 'report.zip'),
        output: join(root, 'test-results', id, waveName),
      }
      report.waves.push(wave)
      await putJSON(join(evidence, 'report.json'), report)
      const resourceIndex = resources.length
      const serverIndex = servers.length
      let waveFailure
      try {
        await bounded(
          async () => {
            await startServers(project)
            if (project.metadata.nativeSvelte === true)
              await bounded(
                () => probeBackends(project, waveName),
                12 * 60_000,
                'Actual native backend probes',
                abort.signal
              )
            wave.browserStartedAt = new Date().toISOString()
            const browser = start(
              waveName,
              pnpmLaunch(
                [
                  'exec',
                  'playwright',
                  'test',
                  ...forwarded,
                  `--project=${project.name}`,
                  `--test-list=${testList}`,
                  '--reporter=list,blob',
                  `--output=${wave.output}`,
                ],
                { ...env, PLAYWRIGHT_BLOB_OUTPUT_FILE: wave.blob }
              ),
              { echo: true }
            )
            let browserFailure
            try {
              await browser.completion
              browser.assertSuccess()
            } catch (cause) {
              browserFailure = cause
            } finally {
              try {
                await browser.stop()
              } catch (cause) {
                browserFailure ??= cause
              }
            }
            if (browserFailure) throw browserFailure
          },
          Math.max(1, deadline - Date.now()),
          'Playwright shared matrix deadline',
          abort.signal
        )
        wave.status = 'passed'
      } catch (cause) {
        wave.status = 'failed'
        wave.error = text(cause)
        waveFailure = cause
      } finally {
        // Interrupt pending launch/readiness/browser work before waiting for
        // cleanup. A timed-out action must not acquire the next resource.
        if (wave.status !== 'passed') fail(new Error(`${waveName} stopped`))
        try {
          await releaseWave(resourceIndex, serverIndex)
          wave.cleanupStatus = 'released'
        } catch (cause) {
          wave.cleanupStatus = 'failed'
          wave.status = 'failed'
          wave.cleanupError = text(cause)
          waveFailure ??= cause
        } finally {
          wave.finishedAt = new Date().toISOString()
          await putJSON(join(evidence, 'report.json'), report)
        }
      }
      if (!waveFailure) {
        try {
          await retainPassedWave(wave, cases, blobs, deadline)
          assert.ok(
            Date.now() < deadline,
            'Playwright shared matrix deadline exhausted after retention'
          )
        } catch (cause) {
          wave.status = 'failed'
          wave.retentionError = text(cause)
          waveFailure = cause
        } finally {
          await putJSON(join(evidence, 'report.json'), report)
        }
      }
      if (waveFailure) throw waveFailure
    }
  } catch (cause) {
    matrixFailure = cause
  } finally {
    for (const wave of report.waves) {
      try {
        if (!wave.blobCollected) {
          if (wave.cleanupStatus !== 'released') continue
          // Failed/unverified wave output is never compacted. Its producer ZIP
          // remains untouched; an exclusive link supplies final official merge.
          await collectWaveBlob(wave, blobs)
        }
        // Collection is historical, not proof that an archive still exists or
        // retains its recorded bytes when the official final merge begins.
        await verifyWaveBlob(wave, blobs)
      } catch (cause) {
        wave.blobVerification = {
          status: 'failed',
          path: wave.canonicalBlob,
          error: text(cause),
        }
        report.blobErrors ??= []
        report.blobErrors.push({ wave: wave.name, error: text(cause) })
        matrixFailure ??= cause
      }
    }
    const completed = (await readdir(blobs)).filter((name) =>
      name.endsWith('.zip')
    )
    report.unknownStartedWaves = report.waves
      .filter(
        (wave) =>
          wave.browserStartedAt && wave.blobVerification?.status !== 'verified'
      )
      .map((wave) => wave.name)
    if (report.unknownStartedWaves.length) {
      report.executionMembership = 'partial-missing-started-wave-reports'
      matrixFailure ??= new Error(
        'Started browser waves lack official reports; their execution membership is unknown'
      )
    }
    if (completed.length) {
      const originalMergeFiles = new Set(
        (await evidenceFiles(blobs)).map((file) => file.relative)
      )
      // Merging remains possible after cancellation, with no consumer alive.
      // Never synthesize skipped/passing results for waves that never ran.
      const mergeSignal = abort.signal.aborted ? undefined : abort.signal
      const merge = start(
        'playwright-merge',
        pnpmLaunch(
          [
            'exec',
            'playwright',
            'merge-reports',
            '--reporter=json,html',
            blobs,
          ],
          {
            PLAYWRIGHT_JSON_OUTPUT_FILE: join(
              root,
              'test-results/results.json'
            ),
            PLAYWRIGHT_HTML_OUTPUT_DIR: join(root, 'playwright-report'),
            PLAYWRIGHT_HTML_OPEN: 'never',
          }
        ),
        { echo: true, allowDuringFailure: true }
      )
      try {
        await bounded(
          () => merge.completion,
          5 * 60_000,
          'Merge completed browser evidence',
          mergeSignal
        )
        merge.assertSuccess()
        await merge.stop()
        const merged = await json(join(root, 'test-results/results.json'))
        const actual = selectedCases(merged)
        const executed = new Set(
          actual
            .filter((test) =>
              test.results.some(
                (result) =>
                  result.status !== 'skipped' ||
                  result.workerIndex >= 0 ||
                  test.expectedStatus === 'skipped'
              )
            )
            .map((test) => test.key)
        )
        if (!report.unknownStartedWaves.length) {
          report.unexecutedCases = report.plan.cases.filter(
            (test) => !executed.has(test.key)
          )
          report.executionMembership = 'established-by-official-report-merge'
        }
        const plannedKeys = new Set(planned.map((test) => test.key))
        assert.ok(
          actual.every((test) => plannedKeys.has(test.key)),
          'Wave executed cases outside the original plan'
        )
        const attachments = await attachmentEvidence(actual, blobs)
        const html = join(root, 'playwright-report')
        const htmlFiles = await evidenceFiles(html)
        assert.ok(
          htmlFiles.some(
            (file) => file.relative === 'index.html' && file.stat.size > 0
          ),
          'Official HTML report is missing'
        )
        const htmlPayloads = new Set()
        for (const file of htmlFiles) {
          if (!file.relative.startsWith('data/')) continue
          const fingerprint = await evidenceDigest(file.path)
          htmlPayloads.add(`${fingerprint.bytes}:${fingerprint.sha256}`)
        }
        assert.ok(
          attachments.every(
            (item) =>
              item.inline || htmlPayloads.has(`${item.bytes}:${item.sha256}`)
          ),
          'Official HTML report is missing attachment payloads'
        )
        report.mergedReports = {
          json: join(root, 'test-results/results.json'),
          html: join(root, 'playwright-report'),
          blobs: completed,
          observedCases: actual.length,
          attachments,
          canonicalBlobs: report.waves
            .filter((wave) => wave.blobCollected)
            .map((wave) => ({
              wave: wave.name,
              path: wave.canonicalBlob,
              archive: wave.canonicalArchive,
              verification: wave.blobVerification,
            })),
        }
        if (!matrixFailure) {
          assert.equal(
            actual.length,
            planned.length,
            'Merged report must cover the exact original plan'
          )
          assert.equal(
            report.unexecutedCases.length,
            0,
            'Successful matrix left planned cases unexecuted'
          )
        }
        report.mergedReports.removedExpansions = await removeMergeExpansions(
          blobs,
          originalMergeFiles,
          new Set(
            attachments.filter((item) => item.member).map((item) => item.member)
          )
        )
        report.mergedReports.expansionPolicy =
          'Canonical ZIPs and official JSON-referenced assets retained; verified nonattachment merge expansions removed after valid official JSON/HTML'
      } catch (cause) {
        report.mergeError = text(cause)
        matrixFailure ??= mergeSignal?.aborted ? mergeSignal.reason : cause
      } finally {
        try {
          await merge.stop()
        } catch (cause) {
          report.mergeCleanupError = text(cause)
          matrixFailure ??= cause
        }
      }
    } else if (!matrixFailure) {
      matrixFailure = new Error(
        'Browser matrix produced no official blob evidence'
      )
    }
  }
  if (matrixFailure) throw matrixFailure
}

async function directoryBytes(directory) {
  let bytes = 0
  for (const item of await readdir(directory, { withFileTypes: true }).catch(
    (cause) => {
      if (cause.code === 'ENOENT') return []
      throw cause
    }
  )) {
    const path = join(directory, item.name)
    if (item.isDirectory()) bytes += await directoryBytes(path)
    else if (item.isFile())
      bytes += await lstat(path)
        .then((stat) => stat.size)
        .catch((cause) => {
          if (cause.code === 'ENOENT') return 0
          throw cause
        })
  }
  return bytes
}
async function saveNativeEvidence() {
  if (!prepared && !ownsArtifacts) return
  const namespace = prepared?.artifactRoot ?? artifactRoot
  if (!namespace) return
  if (prepared)
    await copyFile(
      prepared.manifestPath,
      join(evidence, 'prepared-native-consumers.json')
    )
  else {
    const path = join(namespace, 'preparation-failure.json')
    await copyFile(
      path,
      join(evidence, 'native-preparation-failure.json')
    ).catch((cause) => {
      if (cause.code !== 'ENOENT') throw cause
    })
  }
  // Runtime report references retain their exact original paths. Copy compact
  // observed evidence/logs before removing the disposable install/build roots.
  let copied = 0
  async function copyReports(directory, prefix) {
    for (const item of await readdir(directory, { withFileTypes: true }).catch(
      (cause) => {
        if (cause.code === 'ENOENT') return []
        throw cause
      }
    )) {
      const path = join(directory, item.name)
      const target = join(prefix, item.name)
      if (item.isDirectory()) await copyReports(path, target)
      else if (item.isFile() && /\.(?:json|log|png|html)$/.test(item.name)) {
        copied += (await lstat(path)).size
        assert.ok(
          copied <= 256 * 1024 ** 2,
          'Native retained report/log/capture budget exceeds 256 MiB'
        )
        await mkdir(resolve(target, '..'), { recursive: true })
        await copyFile(path, target)
      }
    }
  }
  await copyReports(
    join(namespace, 'logs'),
    join(evidence, 'native-preparation-logs')
  )
  if (report.native?.runtimeReport) {
    await copyReports(
      dirname(report.native.runtimeReport),
      join(evidence, 'native-runtime')
    )
    report.native.retainedRuntimeReport = join(
      evidence,
      'native-runtime',
      basename(report.native.runtimeReport)
    )
  }
  report.retainedNativeBytes = copied
}

try {
  await claimIntegration()
  abort.signal.throwIfAborted()
  if (artifactRoot) {
    // Exclusive creation means a failed fresh preparation can never reclaim an
    // older caller-owned namespace with the same generic F26 owner string.
    await mkdir(artifactRoot)
    ownsArtifacts = true
  }
  nativeOperation = 'preparation'
  prepared = await prepareNativeConsumers({
    signal: abort.signal,
    ...(options.reuseManifest ? { reuseManifest: options.reuseManifest } : {}),
    ...(options.artifactRoot ?? artifactRoot
      ? { artifactRoot: options.artifactRoot ?? artifactRoot }
      : {}),
    ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
  })
  nativeOperation = undefined
  abort.signal.throwIfAborted()
  report.native = {
    manifestPath: prepared.manifestPath,
    candidate: prepared.candidate,
    packages: prepared.packages,
  }
  await command('native-contracts', {
    command: process.execPath,
    args: [
      '--test',
      ...['settings', 'time'].map(
        (name) => `tests/svelte/contracts/${name}.test.mjs`
      ),
    ],
    cwd: root,
  })
  await command('native-public-types', {
    command: process.execPath,
    args: [
      'tests/svelte/types/run.mjs',
      '--report',
      join(evidence, 'workspace-public-types.json'),
    ],
    cwd: root,
  })
  await prepareLegacy(prepared.packages.core)
  await run(
    'workspace-kit-build',
    ['--filter', 'example-sveltekit-dev', 'build'],
    { VITE_GRADIENT_FIXTURE: '1' }
  )
  abort.signal.throwIfAborted()
  if (options.test) {
    // Importing or calling the default package CLI again would duplicate packs,
    // installs and compiler work. This verifier consumes these exact four roots.
    nativeOperation = 'verification'
    const runtime = await verifyPreparedNativeConsumers(prepared, {
      signal: abort.signal,
      launchOptions: chromiumLaunchOptions,
    })
    nativeOperation = undefined
    report.native.runtimeReport = runtime.reportPath
    abort.signal.throwIfAborted()
    // Revalidate immutable package/consumer identity, never retag stale evidence.
    prepared = await loadPreparedNativeConsumers(prepared.manifestPath, {
      signal: abort.signal,
    })
    outputMonitor = setInterval(() => {
      if (budgetRunning) return
      budgetRunning = true
      budgetTask = Promise.all(
        [
          join(root, 'test-results'),
          join(root, 'playwright-report'),
          evidence,
        ].map(directoryBytes)
      )
        .then((counts) =>
          assert.ok(
            counts.reduce((sum, count) => sum + count, 0) <=
              report.limits.browserOutputBytes,
            'Root browser logs/captures exceed 3 GiB; inspect retained evidence'
          )
        )
        .catch(fail)
        .finally(() => {
          budgetRunning = false
        })
    }, 15_000)
    await runProjectWaves(runtime)
  }
  report.status = 'passed'
} catch (cause) {
  failure = cause
  fail(cause)
  report.status = 'failed'
  report.error = text(cause)
  if (cause.reportPath && report.native)
    report.native.runtimeReport = cause.reportPath
  if (
    cause.report?.resources?.cleanup?.some((item) => item.status === 'failed')
  ) {
    report.cleanup.push({
      name: 'F26-owned-runtime-resources',
      status: 'failed',
      resources: cause.report.resources.cleanup,
    })
  }
} finally {
  clearInterval(outputMonitor)
  await budgetTask
  // Stop all owned groups concurrently so cancellation doesn't accumulate one
  // timeout per server. Support receives SIGTERM and closes its private copy.
  const cleanup = await Promise.allSettled(
    [...resources].reverse().map((resource) => resource.stop())
  )
  for (const result of cleanup)
    if (result.status === 'rejected') {
      report.cleanup.push({ status: 'failed', error: text(result.reason) })
      failure ??= result.reason
    }
  for (const { name, port } of servers) {
    try {
      await assertFreePort(port)
      report.cleanup.push({ name, port, status: 'released' })
    } catch (cause) {
      report.cleanup.push({ name, port, status: 'failed', error: text(cause) })
      failure ??= cause
    }
  }
  if (servers.some(({ name }) => name === 'native-support')) {
    try {
      // Normally absent after graceful close. Only matching verified dead
      // ownership is reconciled if a forced shutdown was needed.
      await assertSupportReleased()
    } catch (cause) {
      failure ??= cause
      report.cleanup.push({
        name: 'native-support-private-namespace',
        status: 'failed',
        error: text(cause),
      })
    }
  }
  let nativeEvidenceSaved = false
  try {
    await saveNativeEvidence()
    nativeEvidenceSaved = true
  } catch (cause) {
    failure ??= cause
    report.evidenceError = text(cause)
  }
  if (options.test && ownsLease) {
    try {
      const counts = await Promise.all(
        [
          join(root, 'test-results'),
          join(root, 'playwright-report'),
          evidence,
        ].map(directoryBytes)
      )
      report.browserOutputBytes = counts.reduce((sum, count) => sum + count, 0)
      assert.ok(
        report.browserOutputBytes <= report.limits.browserOutputBytes,
        'Final root browser evidence exceeds its 1 GiB budget'
      )
    } catch (cause) {
      failure ??= cause
      report.evidenceError = text(cause)
    }
  }
  if (
    ownsArtifacts &&
    artifactRoot &&
    (options.test || failure) &&
    !options.keep &&
    nativeEvidenceSaved &&
    !report.evidenceError
  ) {
    try {
      const registration = await json(
        join(artifactRoot, '.shadergradient-native-consumers-owner.json')
      ).catch((cause) => {
        if (cause.code === 'ENOENT') return null
        throw cause
      })
      if (registration) {
        assert.equal(
          registration.owner,
          'shadergradient-a0q.26/package-consumers/schema-1'
        )
        assert.equal(registration.artifactRoot, artifactRoot)
        assert.equal(registration.manifestPath, manifestPath)
        assert.ok(
          !report.cleanup.some((item) => item.status === 'failed'),
          'Preserve artifacts while an owned cleanup failure needs investigation'
        )
        const manifestRelative = relative(artifactRoot, manifestPath)
        if (
          isAbsolute(manifestRelative) ||
          manifestRelative === '..' ||
          manifestRelative.startsWith('../')
        ) {
          // This invocation alone created this optional external manifest.
          await rm(manifestPath, { force: true })
        }
        await rm(artifactRoot, { recursive: true })
        report.cleanup.push({
          name: 'native-disposable-install-build-roots',
          root: artifactRoot,
          status: 'released',
        })
      } else {
        assert.equal(
          (await readdir(artifactRoot)).length,
          0,
          'Unregistered nonempty namespace must be preserved'
        )
        await rm(artifactRoot, { recursive: true })
      }
    } catch (cause) {
      failure ??= cause
      report.cleanup.push({
        name: 'native-disposable-install-build-roots',
        status: 'failed',
        error: text(cause),
      })
    }
  } else if (prepared || ownsArtifacts) {
    report.retainedArtifacts = {
      root: prepared?.artifactRoot ?? artifactRoot,
      owner: ownsArtifacts ? 'this preparation' : 'caller of --reuse-manifest',
      reason: report.evidenceError
        ? 'Evidence preservation failed; original artifacts retained'
        : options.test
        ? 'Explicit retention/reuse; no shared owner cleanup'
        : 'prepare:e2e exposes the prepared manifest for an explicit --reuse-manifest run',
      suggestedExpiry: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    }
  }
  if (nativeOperation)
    report.cleanup.push({
      name: 'native-operation-cleanup',
      operation: nativeOperation,
      status: 'unverified',
      reason: 'The imported operation did not return cleanup-complete evidence',
    })
  if (ownsLease && report.cleanup.some((item) => item.status !== 'released')) {
    report.cleanup.push({
      name: 'root-integration-lease',
      status: 'retained-unverified',
      path: leasePath,
      reason:
        'Verify owned workers and namespaces before operator reconciliation',
    })
  } else if (ownsLease) {
    try {
      assert.deepEqual(
        await json(leasePath),
        ownerRecord,
        'Root integration lease changed; preserving it'
      )
      await rm(leasePath)
      report.cleanup.push({
        name: 'root-integration-lease',
        status: 'released',
      })
    } catch (cause) {
      failure ??= cause
      report.cleanup.push({
        name: 'root-integration-lease',
        status: 'failed',
        error: text(cause),
      })
    }
  }
  process.removeListener('SIGINT', onINT)
  process.removeListener('SIGTERM', onTERM)
  report.finishedAt = new Date().toISOString()
  if (abort.signal.aborted) failure ??= abort.signal.reason
  if (failure) {
    report.status = 'failed'
    report.error ??= text(failure)
  }
  await putJSON(join(evidence, 'report.json'), report)
  console.log(
    JSON.stringify({
      status: report.status,
      mode: report.mode,
      report: join(evidence, 'report.json'),
      manifestPath: prepared?.manifestPath,
      candidateFingerprint: prepared?.candidate.fingerprint,
    })
  )
}
if (failure) {
  console.error(failure)
  process.exitCode = signalFailure?.exitCode ?? failure.exitCode ?? 1
}
