// Fresh public-artifact qualification (no import-time work).
// node tests/svelte/package-consumers.mjs [--prepare-only] [--artifact-root /var/tmp/owned]
// Reuse only unchanged, fully validated evidence: --reuse-manifest /absolute/manifest.json.
// Preparation deliberately finishes every compiler probe before any browser/server starts.
// Imported preparation/loading accept options.signal; direct CLI signals span preparation and verification.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import {
  access,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  delimiter,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finished } from 'node:stream/promises'

const checkout = fileURLToPath(new URL('../../', import.meta.url))
const owner = 'shadergradient-a0q.26/package-consumers/schema-1'
const budgetBytes = 4 * 1024 ** 3
const marker = '.shadergradient-native-consumers-owner.json'
const excluded = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  '.sprint-lifecycle-support',
])
const cells = [
  { id: 'plain-current', kind: 'plain', svelteVersion: '5.57.3', port: 3112 },
  { id: 'kit-current', kind: 'kit', svelteVersion: '5.57.3', port: 3113 },
  { id: 'plain-lower', kind: 'plain', svelteVersion: '5.40.0', port: 3115 },
  { id: 'kit-lower', kind: 'kit', svelteVersion: '5.57.1', port: 3116 },
]
const pins = {
  '@threlte/core': '8.6.1',
  three: '0.186.1',
  '@types/three': '0.186.0',
  typescript: '6.0.3',
  'svelte-check': '4.7.7',
  vite: '8.2.1',
  '@sveltejs/vite-plugin-svelte': '7.3.0',
}
// SDK's native lower compiler remains 5.40; Kit 3.1's own peer floor is 5.57.1.
const consumerPins = (cell) =>
  cell.id === 'plain-lower'
    ? { ...pins, vite: '7.1.4', '@sveltejs/vite-plugin-svelte': '6.2.1' }
    : cell.kind === 'kit'
    ? { ...pins, '@sveltejs/kit': '3.1.0', '@sveltejs/adapter-node': '6.0.0' }
    : pins
const forbidden =
  /(?:^|[/\\])(?:react(?:-dom)?|react-reconciler|@react-three)(?:[/\\]|$)|@shadergradient\/(?:react|vue)|shadergradient\/src|packages\/shadergradient\/src/
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const rawFilesystem = {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
}
const json = async (path, cancellation) =>
  JSON.parse(await (cancellation?.fs ?? rawFilesystem).readFile(path, 'utf8'))
const putJSON = (path, value, cancellation, options) =>
  (cancellation?.fs ?? rawFilesystem).writeFile(
    path,
    JSON.stringify(value, null, 2) + '\n',
    options
  )
function interruption(signal) {
  const error = new Error(
    `Native consumer qualification interrupted by ${signal}`
  )
  error.signal = signal
  error.exitCode = signal === 'SIGINT' ? 130 : 143
  return error
}
function preparationCancellation(signal) {
  signal?.throwIfAborted()
  const abort = new AbortController()
  let failed = false
  let failure
  const cleanupErrors = []
  const fail = (error) => {
    if (!failed) {
      failed = true
      failure = error
    }
    return failure
  }
  const cleanupFailure = (error) => {
    cleanupErrors.push(error?.stack ?? String(error))
    fail(error)
  }
  const onAbort = () => {
    fail(signal.reason)
    abort.abort(signal.reason)
  }
  const onSIGINT = () => {
    const error = interruption('SIGINT')
    fail(error)
    abort.abort(error)
  }
  const onSIGTERM = () => {
    const error = interruption('SIGTERM')
    fail(error)
    abort.abort(error)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  process.on('SIGINT', onSIGINT)
  process.on('SIGTERM', onSIGTERM)
  const check = () => {
    if (signal?.aborted) onAbort()
    if (failed) throw failure
  }
  const cancellation = {
    signal: abort.signal,
    fail,
    check,
    cleanupErrors,
    cleanupFailure,
    async cleanup(release) {
      try {
        await release()
      } catch (error) {
        cleanupFailure(error)
      }
    },
    async step(acquire) {
      check()
      let result
      try {
        result = await acquire()
      } catch (error) {
        throw fail(error)
      }
      check()
      return result
    },
    dispose() {
      signal?.removeEventListener('abort', onAbort)
      process.removeListener('SIGINT', onSIGINT)
      process.removeListener('SIGTERM', onSIGTERM)
    },
  }
  cancellation.fs = Object.fromEntries(
    Object.entries(rawFilesystem).map(([name, operation]) => [
      name,
      (...args) => cancellation.step(() => operation(...args)),
    ])
  )
  return cancellation
}
function inside(root, path) {
  const part = relative(root, path)
  return (
    part === '' ||
    (!part.startsWith('..' + '/') && part !== '..' && !isAbsolute(part))
  )
}
function absolute(path, name) {
  assert.ok(isAbsolute(path), `${name} must be absolute`)
  return resolve(path)
}
async function exists(path, cancellation) {
  cancellation?.check()
  try {
    await access(path)
    cancellation?.check()
    return true
  } catch (error) {
    cancellation?.check()
    if (error.code === 'ENOENT') return false
    throw cancellation ? cancellation.fail(error) : error
  }
}
async function inventory(root, filter = () => true, cancellation) {
  const { readdir, readFile } = cancellation?.fs ?? rawFilesystem
  const result = []
  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    )) {
      const path = join(directory, item.name)
      const rel = relative(root, path)
      if (!filter(rel, item)) continue
      assert.ok(
        !item.isSymbolicLink(),
        `Unexpected symlink in hashed/copy input: ${path}`
      )
      if (item.isDirectory()) await visit(path)
      else if (item.isFile())
        result.push({ path: rel, sha256: sha(await readFile(path)) })
    }
  }
  await visit(root)
  return result
}
async function dependencyLinks(root, cancellation) {
  const { readdir, realpath } = cancellation?.fs ?? rawFilesystem
  const links = []
  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    )) {
      const path = join(directory, item.name)
      if (item.isSymbolicLink()) {
        const target = await realpath(path)
        assert.ok(
          inside(dirname(root), target),
          `Installed dependency link escapes consumer: ${path} -> ${target}`
        )
        assert.ok(
          !forbidden.test(path) && !forbidden.test(target),
          `Forbidden installed dependency link: ${path}`
        )
        links.push({ path: relative(root, path), target })
      } else if (item.isDirectory()) await visit(path)
    }
  }
  await visit(root)
  return links
}
const sourceFilter = (path) =>
  !path
    .split('/')
    .some(
      (name) =>
        excluded.has(name) ||
        name.startsWith('.shadergradient-') ||
        name.startsWith('.sprint-')
    ) && !/\.tgz$/.test(path)
async function assertFiles(root, files, cancellation) {
  const { readFile } = cancellation?.fs ?? rawFilesystem
  for (const item of files) {
    assert.ok(
      inside(root, resolve(root, item.path)),
      `Manifest path escapes root: ${item.path}`
    )
    assert.equal(
      sha(await readFile(join(root, item.path))),
      item.sha256,
      `Stale/missing file: ${join(root, item.path)}`
    )
  }
}
// This is preparation identity, not final integrated qualification identity.
// Runtime-only verifier fixes must reuse unchanged real artifacts rather than
// duplicate builds/installs. F31 must separately fingerprint the integrated
// verifier and browser specifications along with this prepared candidate.
async function inputIdentity(cancellation) {
  const { readFile } = cancellation?.fs ?? rawFilesystem
  const inputs = []
  const directories = [
    'packages/shadergradient-core',
    'packages/shadergradient-svelte',
    'apps/examples/example-vite-svelte',
    'apps/examples/example-sveltekit',
    'apps/example-svelte-dev',
    'apps/example-sveltekit-dev',
    'packages/ui/assets/hdr',
    'tests/svelte/types',
  ]
  for (const directory of directories) {
    for (const item of await inventory(
      join(checkout, directory),
      sourceFilter,
      cancellation
    ))
      inputs.push({ path: directory + '/' + item.path, sha256: item.sha256 })
  }
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'apps/demo-studio.css',
    'apps/demo-query.ts',
    'tests/svelte/package-consumers.mjs',
  ]) {
    inputs.push({ path, sha256: sha(await readFile(join(checkout, path))) })
  }
  inputs.sort((a, b) => a.path.localeCompare(b.path))
  return { fingerprint: sha(JSON.stringify(inputs)), inputs }
}
async function executable(name, cancellation) {
  const { realpath } = cancellation?.fs ?? rawFilesystem
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = resolve(directory, name)
    if (await exists(candidate, cancellation)) return realpath(candidate)
  }
  throw new Error(
    `Required executable ${name} is unavailable; Linux bubblewrap checkout denial is mandatory, not a copy-only fallback`
  )
}
async function tools(cancellation) {
  const { realpath, readFile } = cancellation?.fs ?? rawFilesystem
  assert.equal(
    process.platform,
    'linux',
    'Independent qualification requires Linux bubblewrap'
  )
  const bwrap = await executable('bwrap', cancellation)
  const pnpmPath =
    process.env.npm_execpath && /pnpm/.test(process.env.npm_execpath)
      ? await realpath(process.env.npm_execpath)
      : await executable('pnpm', cancellation)
  assert.ok(
    !inside(checkout, pnpmPath),
    'pnpm must be installed outside the checkout hidden from consumers'
  )
  const node = await realpath(process.execPath)
  return {
    bwrap,
    bwrapSha256: sha(await readFile(bwrap)),
    pnpmPath,
    node,
    nodeVersion: process.version,
    nodeSha256: sha(await readFile(node)),
    pnpmSha256: sha(await readFile(pnpmPath)),
  }
}
async function usage(root, cancellation) {
  const { readdir, lstat } = cancellation?.fs ?? rawFilesystem
  let bytes = 0
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.isFile()) bytes += (await lstat(path)).size
      assert.ok(
        bytes <= budgetBytes,
        `Owned preparation exceeds ${budgetBytes} bytes: ${root}`
      )
    }
  }
  await visit(root)
  return bytes
}
async function context(root, toolchain, cancellation) {
  const caches = [
    join(homedir(), '.cache'),
    join(homedir(), '.local/share/pnpm'),
    join(homedir(), '.local/state/pnpm'),
  ]
  await cancellation.step(() => mkdir(join(root, 'tmp'), { recursive: true }))
  for (const path of caches)
    await cancellation.step(() => mkdir(path, { recursive: true }))
  const prefix = [
    '--die-with-parent',
    '--new-session',
    '--ro-bind',
    '/',
    '/',
    '--dev-bind',
    '/dev',
    '/dev',
    '--proc',
    '/proc',
    '--bind',
    root,
    root,
  ]
  for (const path of caches) prefix.push('--bind', path, path)
  prefix.push('--tmpfs', checkout)
  cancellation.check()
  return { root, toolchain, prefix, serial: 0, caches, cancellation }
}
function sandbox(ctx, cwd, command, args) {
  assert.ok(
    inside(ctx.root, cwd),
    `Sandbox working directory must be owned: ${cwd}`
  )
  return {
    command: ctx.toolchain.bwrap,
    args: [...ctx.prefix, '--chdir', cwd, '--', command, ...args],
    cwd,
  }
}
async function run(
  ctx,
  label,
  command,
  args,
  { cwd = checkout, isolated = false, env = {}, expectedFailure = false } = {}
) {
  const cancellation = ctx.cancellation
  cancellation.check()
  const number = ++ctx.serial
  const log = join(
    ctx.root,
    'logs',
    `${String(number).padStart(3, '0')}-${label.replace(
      /[^a-zA-Z0-9_-]/g,
      '-'
    )}.log`
  )
  const invocation = isolated
    ? sandbox(ctx, cwd, command, args)
    : { command, args, cwd }
  if (isolated) {
    // The exact owned child gets its own session below. A second bwrap setsid
    // would let its descendants escape the group we must drain on cancellation.
    invocation.args.splice(invocation.args.indexOf('--new-session'), 1)
  }
  const childEnv = {
    ...process.env,
    NODE_OPTIONS: '',
    NODE_PATH: '',
    TMPDIR: join(ctx.root, 'tmp'),
    PWD: cwd,
    ...env,
  }
  if (isolated) {
    for (const key of Object.keys(childEnv)) {
      if (
        /^npm_(?:package_|lifecycle_|config_(?:workspace|prefix|local_prefix|userconfig|globalconfig|node_options))/i.test(
          key
        ) ||
        ['INIT_CWD', 'PNPM_SCRIPT_SRC_DIR', 'PNPM_WORKSPACE_DIR'].includes(key)
      )
        delete childEnv[key]
    }
  }
  let child, stream, logClosed, timer, monitor, monitoring, stopping
  let output = '',
    bytes = 0,
    code,
    signal,
    exited = false,
    closed = false
  let finish, finishStopping
  const completion = new Promise((accept) => {
    finish = accept
  })
  const stopped = new Promise((accept) => {
    finishStopping = accept
  })
  const send = (sentSignal) => {
    if (!child?.pid) return
    try {
      process.kill(-child.pid, sentSignal)
    } catch (error) {
      if (error.code !== 'ESRCH') cancellation.cleanupFailure(error)
      else if (
        !exited &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          child.kill(sentSignal)
        } catch (fallbackError) {
          cancellation.cleanupFailure(fallbackError)
        }
      }
    }
  }
  const drain = async () => {
    let deadline
    try {
      return await Promise.race([
        completion.then(() => true),
        new Promise((accept) => {
          deadline = setTimeout(() => accept(false), 4000)
        }),
      ])
    } finally {
      clearTimeout(deadline)
    }
  }
  const stop = (force = false) => {
    if (!child) return Promise.resolve()
    if (!stopping) {
      stopping = (async () => {
        try {
          // Signal the owned group even after its leader exits: descendants may
          // retain pipes, or survive without them. Never search shared PIDs.
          send(force ? 'SIGKILL' : 'SIGTERM')
          await drain()
          send('SIGKILL')
          if (!(await drain()))
            cancellation.cleanupFailure(
              new Error(
                `${label}: owned process group ${
                  child.pid ?? 'unavailable'
                }/stdio did not close after SIGKILL`
              )
            )
        } finally {
          if (!closed) {
            child.stdout?.destroy()
            child.stderr?.destroy()
            child.unref()
          }
          finishStopping()
        }
      })()
    } else if (force) send('SIGKILL')
    return stopping
  }
  const fail = (error, force = false) => {
    cancellation.fail(error)
    void stop(force)
  }
  const onAbort = () => fail(cancellation.signal.reason)
  const onSpawn = () => {
    if (stopping || cancellation.signal.aborted) send('SIGTERM')
  }
  const onError = (error) => fail(error)
  const onExit = (exitCode, exitSignal) => {
    code = exitCode
    signal = exitSignal
    exited = true
    try {
      assert.equal(
        signal,
        null,
        `${label} terminated (${signal}); evidence ${log}`
      )
      if (expectedFailure)
        assert.notEqual(code, 0, `${label} unexpectedly succeeded; ${log}`)
      else assert.equal(code, 0, `${label} failed (${code}); ${log}\n${output}`)
    } catch (error) {
      fail(error)
    }
  }
  const onClose = (exitCode, exitSignal) => {
    code = exitCode
    signal = exitSignal
    closed = true
    finish()
  }
  const consume = (chunk) => {
    bytes += chunk.length
    if (bytes <= 16 * 1024 ** 2 && !stream.destroyed && !stream.writableEnded)
      stream.write(chunk)
    output = (output + chunk.toString()).slice(-256 * 1024)
    if (bytes > 16 * 1024 ** 2)
      fail(new Error(`${label} exceeded 16MiB output budget`), true)
  }
  cancellation.signal.addEventListener('abort', onAbort, { once: true })
  try {
    cancellation.check()
    stream = createWriteStream(log, { flags: 'wx' })
    logClosed = finished(stream, { cleanup: true }).catch((error) =>
      fail(error)
    )
    // Opening the log is asynchronous; cancellation here must not spawn a child.
    await once(stream, 'open')
    cancellation.check()
    child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: childEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.once('spawn', onSpawn)
    child.once('error', onError)
    child.once('exit', onExit)
    child.once('close', onClose)
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    // An abort during acquisition still owns and must stop the returned child.
    cancellation.check()
    timer = setTimeout(
      () =>
        fail(new Error(`${label} exceeded 20 minute command deadline`), true),
      20 * 60 * 1000
    )
    monitor = setInterval(() => {
      if (monitoring) return
      monitoring = usage(ctx.root, cancellation)
        .catch((error) => fail(error, true))
        .finally(() => {
          monitoring = undefined
        })
    }, 15000)
    await Promise.race([completion, stopped])
    cancellation.check()
  } catch (error) {
    cancellation.fail(error)
  } finally {
    clearTimeout(timer)
    clearInterval(monitor)
    await stop()
    await monitoring
    cancellation.signal.removeEventListener('abort', onAbort)
    child?.removeListener('spawn', onSpawn)
    child?.removeListener('error', onError)
    child?.removeListener('exit', onExit)
    child?.removeListener('close', onClose)
    child?.stdout?.removeListener('data', consume)
    child?.stderr?.removeListener('data', consume)
    if (stream && !stream.destroyed) stream.end()
    await logClosed
  }
  cancellation.check()
  await cancellation.step(() => usage(ctx.root, cancellation))
  return {
    command: invocation.command,
    args: invocation.args,
    cwd,
    exitCode: code,
    log,
    output,
  }
}
function pnpmCommand(toolchain, args) {
  return /\.(?:c?js|mjs)$/.test(toolchain.pnpmPath)
    ? [toolchain.node, [toolchain.pnpmPath, ...args]]
    : [toolchain.pnpmPath, args]
}
async function pnpm(ctx, label, args, options) {
  return run(ctx, label, ...pnpmCommand(ctx.toolchain, args), options)
}
async function pack(ctx, kind) {
  ctx.cancellation.check()
  const { cancellation } = ctx
  const { mkdir, readdir, readFile } = cancellation.fs
  const directory = join(
    checkout,
    'packages',
    `shadergradient-${kind === 'native' ? 'svelte' : 'core'}`
  )
  const manifest = await json(join(directory, 'package.json'), cancellation)
  const built = await pnpm(ctx, `${kind}-build`, ['--dir', directory, 'build'])
  const destination = join(ctx.root, 'packages', kind)
  await mkdir(destination, { recursive: true })
  const packed = await pnpm(ctx, `${kind}-pack`, [
    '--dir',
    directory,
    'pack',
    '--pack-destination',
    destination,
  ])
  const tarballs = (await readdir(destination)).filter((path) =>
    path.endsWith('.tgz')
  )
  assert.equal(
    tarballs.length,
    1,
    `${kind}: pack must produce exactly one actual tarball`
  )
  const tarball = join(destination, tarballs[0])
  const listing = await run(ctx, `${kind}-archive-list`, 'tar', [
    '-tzf',
    tarball,
  ])
  for (const path of listing.output.trim().split('\n'))
    assert.ok(
      path.startsWith('package/') && !path.split('/').includes('..'),
      `Unsafe tar member ${path}`
    )
  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  await run(ctx, `${kind}-archive-extract`, 'tar', [
    '-xzf',
    tarball,
    '--no-same-owner',
    '--no-same-permissions',
    '-C',
    unpacked,
  ])
  const packageRoot = join(unpacked, 'package')
  const shipped = await json(join(packageRoot, 'package.json'), cancellation)
  assert.equal(shipped.name, manifest.name)
  assert.equal(shipped.version, manifest.version)
  const files = await inventory(packageRoot, undefined, cancellation)
  assert.ok(
    files.some((item) => item.path.endsWith('.d.ts')),
    `${kind}: no generated declarations shipped`
  )
  assert.ok(
    files.some((item) => item.path.endsWith('.js')),
    `${kind}: no JavaScript shipped`
  )
  if (kind === 'native')
    assert.ok(
      files.some((item) => item.path.endsWith('.svelte')),
      'No compiled-consumable Svelte components shipped'
    )
  for (const item of files.filter((file) => file.path.startsWith('dist/'))) {
    assert.equal(
      sha(await readFile(join(directory, item.path))),
      item.sha256,
      `${kind}: packed dist differs from fresh public build: ${item.path}`
    )
  }
  for (const [name, version] of Object.entries(shipped.dependencies ?? {})) {
    assert.ok(
      !version.startsWith('workspace:'),
      `${kind} shipped an unresolved workspace dependency ${name}`
    )
    assert.ok(
      !forbidden.test(name),
      `${kind} shipped forbidden dependency ${name}`
    )
  }
  return {
    name: shipped.name,
    version: shipped.version,
    tarball,
    sha256: sha(await readFile(tarball)),
    files,
    unpacked: packageRoot,
    buildLog: built.log,
    packLog: packed.log,
  }
}
async function copySources(source, destination, cancellation) {
  const { cp } = cancellation?.fs ?? rawFilesystem
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      cancellation?.check()
      return sourceFilter(relative(source, path))
    },
  })
  await inventory(destination, sourceFilter, cancellation)
}
async function installedPackage(root, name, cancellation) {
  const { realpath } = cancellation?.fs ?? rawFilesystem
  const directory = await realpath(join(root, 'node_modules', name))
  assert.ok(
    inside(root, directory),
    `${name} resolves outside independent consumer: ${directory}`
  )
  return directory
}
async function installedEvidence(root, packages, cancellation) {
  const result = {}
  for (const [kind, artifact] of Object.entries(packages)) {
    const directory = await installedPackage(root, artifact.name, cancellation)
    await assertFiles(directory, artifact.files, cancellation)
    const files = await inventory(directory, undefined, cancellation)
    assert.deepEqual(
      files,
      artifact.files,
      `${root}: installed ${kind} inventory differs from fresh tarball`
    )
    result[kind] = { root: directory, files }
  }
  return result
}

// This controller is copied into every independent consumer. All framework,
// compiler, bundler and package resolution below therefore occurs in that copy.
// Export only the generated bytes so failed-before artifacts can be audited with
// a separately named copy, without rebuilding or replacing their old reports.
export const qualificationDriver = String.raw`
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, createBuilder } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import qualificationSvelteOptions from './svelte-options.mjs'
const root = process.cwd()
const [mode, reportPath, expectedSvelte] = process.argv.slice(2)
const forbidden = /(?:^|[/\\])(?:react(?:-dom)?|react-reconciler|@react-three)(?:[/\\]|$)|@shadergradient\/(?:react|vue)|shadergradient\/src|packages\/shadergradient\/src/
const within = (path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel)) }
async function info(name, parent = pathToFileURL(join(root, '.qualification/context.mjs')).href) {
  // A real file parent (not require.resolve) honors import and Svelte conditions.
  const resolver = join(dirname(fileURLToPath(parent)), '.shadergradient-resolve-' + process.pid + '.mjs')
  // Native/checker parents are inside owned installed trees. Restore in finally.
  const { unlink } = await import('node:fs/promises')
  await writeFile(resolver, "export default (name) => { try { return import.meta.resolve(name + '/package.json') } catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; return import.meta.resolve(name) } }\n", { flag: 'wx' })
  let url
  try { url = (await import(pathToFileURL(resolver).href + '?n=' + encodeURIComponent(name))).default(name) }
  finally { await unlink(resolver) }
  let directory = dirname(await realpath(fileURLToPath(url)))
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (manifest.name === name) {
        assert.ok(within(directory), name + ' escapes isolated consumer: ' + directory)
        return { name, version: manifest.version, root: directory, entry: url, manifest }
      }
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
    const next = dirname(directory); assert.notEqual(next, directory, 'Cannot identify ' + name); directory = next
  }
}
async function context() {
  const names = ['@shadergradient/core', '@shadergradient/svelte', 'svelte', '@threlte/core', 'three', '@types/three', 'typescript', 'svelte-check', 'vite', '@sveltejs/vite-plugin-svelte']
  const consumerManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (consumerManifest.devDependencies?.['@sveltejs/kit']) names.push('@sveltejs/kit', '@sveltejs/adapter-node')
  const packages = {}
  for (const name of names) packages[name] = await info(name)
  assert.equal(packages.svelte.version, expectedSvelte)
  const compiler = await import('svelte/compiler')
  assert.equal(compiler.VERSION, expectedSvelte)
  const dependencyContexts = {}
  for (const owner of ['@shadergradient/svelte', 'svelte-check']) {
    dependencyContexts[owner] = {}
    const dependencies = owner === 'svelte-check' ? ['svelte', 'typescript'] : ['svelte', '@threlte/core', 'three', '@shadergradient/core']
    for (const dependency of dependencies) {
      const actual = await info(dependency, pathToFileURL(join(packages[owner].root, 'context.mjs')).href)
      assert.equal(actual.version, packages[dependency].version, owner + ' has different ' + dependency)
      dependencyContexts[owner][dependency] = { version: actual.version, root: actual.root, entry: actual.entry }
    }
  }
  const graph = [], seen = new Set()
  async function visit(item) {
    if (seen.has(item.root)) return
    seen.add(item.root)
    assert.ok(!forbidden.test(item.name), 'Forbidden installed runtime package: ' + item.name)
    assert.ok(!forbidden.test(item.root), 'Forbidden installed runtime path: ' + item.root)
    const dependencies = {}
    for (const dependency of Object.keys(item.manifest.dependencies ?? {})) {
      assert.ok(!forbidden.test(dependency), 'Forbidden runtime dependency ' + dependency)
      const actual = await info(dependency, pathToFileURL(join(item.root, 'context.mjs')).href)
      dependencies[dependency] = actual.root
      await visit(actual)
    }
    graph.push({ name: item.name, version: item.version, root: item.root, dependencies })
  }
  for (const name of ['@shadergradient/svelte', 'svelte', '@threlte/core', 'three']) await visit(packages[name])
  const nativeExport = packages['@shadergradient/svelte'].manifest.exports['.']
  assert.ok(nativeExport.types && nativeExport.svelte && nativeExport.default, 'Missing supported public export conditions')
  for (const condition of ['types', 'svelte', 'default']) await readFile(resolve(packages['@shadergradient/svelte'].root, nativeExport[condition]))
  return { packages, compiler: { version: compiler.VERSION, entry: import.meta.resolve('svelte/compiler') }, dependencyContexts, graph }
}
const graph = []
function graphPlugin() {
  return { name: 'actual-isolated-artifact-graph',
    async generateBundle(_options, bundle) {
      const modules = []
      for (const id of this.getModuleIds()) {
        const item = this.getModuleInfo(id)
        assert.ok(!forbidden.test(id), 'Forbidden compiled import ' + id)
        const file = id.split('?')[0]
        if (isAbsolute(file)) assert.ok(within(await realpath(file)), 'Build module escapes isolated consumer ' + file)
        for (const dependency of [...(item.importedIds ?? []), ...(item.dynamicallyImportedIds ?? [])]) assert.ok(!forbidden.test(dependency), 'Forbidden compiled dependency ' + dependency)
        modules.push({ id, external: item.isExternal, importedIds: item.importedIds, dynamicallyImportedIds: item.dynamicallyImportedIds })
      }
      const chunks = Object.values(bundle).map((output) => output.type === 'chunk'
        ? { fileName: output.fileName, type: 'chunk', bytes: Buffer.byteLength(output.code), modules: Object.entries(output.modules).map(([id, item]) => ({ id, renderedLength: item.renderedLength, removedExports: item.removedExports, renderedExports: item.renderedExports })) }
        : { fileName: output.fileName, type: 'asset', bytes: Buffer.byteLength(output.source) })
      graph.push({ modules, chunks })
    }
  }
}
// Compare consumer-visible public asset values with decoded expressions in the
// actual emitted files. Namespace helper names and module byte sizes are not an
// asset oracle; neither comments nor escaped source spellings establish data.
async function unusedShaderAssets() {
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const corePackage = await info('@shadergradient/core')
  const typescriptPackage = await info('typescript')
  const coreEntry = import.meta.resolve('@shadergradient/core')
  const typescriptEntry = import.meta.resolve('typescript')
  for (const entry of [coreEntry, typescriptEntry]) {
    assert.ok(within(await realpath(fileURLToPath(entry))), 'Asset oracle dependency escapes isolated consumer: ' + entry)
  }
  const { shaders } = await import(coreEntry)
  const { default: ts } = await import(typescriptEntry)
  assert.match(ts.version, /^6\./, 'Asset oracle must use the consumer TypeScript 6 compiler')
  assert.equal(ts.version, typescriptPackage.version)
  const assets = new Map()
  let publicAssetCount = 0
  assert.equal(Object.keys(shaders).length, 4, 'Incomplete installed public shader families')
  for (const [family, geometries] of Object.entries(shaders)) {
    assert.equal(Object.keys(geometries).length, 3, 'Incomplete installed public shader geometries: ' + family)
    for (const [geometry, stages] of Object.entries(geometries)) {
      for (const stage of ['vertex', 'fragment']) {
        const value = stages[stage]
        assert.equal(typeof value, 'string', 'Missing public shader asset: ' + family + '.' + geometry + '.' + stage)
        assert.ok(value.length, 'Empty public shader asset: ' + family + '.' + geometry + '.' + stage)
        const sha256 = hash(value)
        if (!assets.has(sha256)) assets.set(sha256, { sha256, bytes: Buffer.byteLength(value), publicPaths: [] })
        assets.get(sha256).publicPaths.push('shaders.' + family + '.' + geometry + '.' + stage)
        publicAssetCount++
      }
    }
  }
  const outputRoot = resolve('.qualification/minimal-build')
  const files = []
  async function visit(directory) {
    assert.ok(within(await realpath(directory)), 'Minimal output escapes isolated consumer: ' + directory)
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await visit(path)
      else {
        assert.ok(!item.isSymbolicLink(), 'Symlink in minimal output: ' + path)
        if (/\.(?:mjs|cjs|js)$/.test(item.name)) files.push(path)
      }
    }
  }
  await visit(outputRoot)
  files.sort()
  assert.ok(files.includes(join(outputRoot, 'minimal.mjs')), 'Missing actual emitted minimal entry')
  const chunks = [], retained = new Map()
  for (const path of files) {
    const code = await readFile(path, 'utf8')
    const chunk = { fileName: relative(outputRoot, path), sha256: hash(code), bytes: Buffer.byteLength(code), decodedStringExpressions: 0, matchedAssetHashes: [] }
    const parsed = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    assert.equal(parsed.parseDiagnostics.length, 0, 'Cannot parse actual emitted chunk: ' + chunk.fileName)
    const values = new WeakMap()
    function stringValue(node) {
      if (values.has(node)) return values.get(node)
      let value
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text
      else if (ts.isParenthesizedExpression(node)) value = stringValue(node.expression)
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = stringValue(node.left), right = stringValue(node.right)
        if (left !== undefined && right !== undefined) value = left + right
      } else if (ts.isTemplateExpression(node) && !ts.isTaggedTemplateExpression(node.parent)) {
        value = node.head.text
        for (const span of node.templateSpans) {
          const expression = stringValue(span.expression)
          if (expression === undefined) { value = undefined; break }
          value += expression + span.literal.text
        }
      }
      if (ts.isNoSubstitutionTemplateLiteral(node) && ts.isTaggedTemplateExpression(node.parent)) value = undefined
      values.set(node, value)
      return value
    }
    function inspect(node) {
      const value = stringValue(node)
      if (value !== undefined) {
        chunk.decodedStringExpressions++
        const sha256 = hash(value)
        if (assets.has(sha256)) {
          if (!retained.has(sha256)) retained.set(sha256, { ...assets.get(sha256), occurrences: [] })
          const start = node.getStart(parsed)
          const { line, character } = parsed.getLineAndCharacterOfPosition(start)
          retained.get(sha256).occurrences.push({ chunk: chunk.fileName, chunkSha256: chunk.sha256, start, end: node.end, line: line + 1, column: character + 1, expressionKind: ts.SyntaxKind[node.kind] })
          if (!chunk.matchedAssetHashes.includes(sha256)) chunk.matchedAssetHashes.push(sha256)
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(parsed)
    chunks.push(chunk)
  }
  return {
    method: 'typescript-decoded-emitted-string-sha256',
    core: { version: corePackage.version, entry: coreEntry, entrySha256: hash(await readFile(fileURLToPath(coreEntry))) },
    compiler: { version: ts.version, entry: typescriptEntry, entrySha256: hash(await readFile(fileURLToPath(typescriptEntry))) },
    publicAssetCount,
    uniqueAssetCount: assets.size,
    publicAssets: [...assets.values()],
    chunks,
    retainedAssetCount: retained.size,
    retainedAssets: [...retained.values()],
    passed: retained.size === 0,
  }
}
let report
if (mode === 'context') report = await context()
else if (mode === 'production') {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.devDependencies?.['@sveltejs/kit']) {
    // Kit 3's adapter and SSR/client environments run through the real app
    // builder lifecycle, not Vite's legacy client-only build() shortcut.
    const builder = await createBuilder({ plugins: [graphPlugin()], mode: 'production' })
    await builder.buildApp()
  } else await build({ plugins: [graphPlugin()], mode: 'production' })
  assert.ok(graph.length, 'Production build emitted no real module graph')
  report = { graph }
} else if (mode === 'ssr') {
  // rollupOptions is supported by both the genuine lower Vite 7 build and Vite 8.
  await build({ configFile: false, plugins: [svelte({ ...qualificationSvelteOptions, configFile: false }), graphPlugin()], ssr: { noExternal: true }, build: { ssr: '.qualification/ssr-entry.mjs', outDir: '.qualification/ssr', emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } } })
  report = { graph, entry: resolve('.qualification/ssr/entry.mjs') }
} else if (mode === 'minimal') {
  await build({ configFile: false, plugins: [svelte({ ...qualificationSvelteOptions, configFile: false }), graphPlugin()], build: { lib: { entry: '.qualification/minimal.mjs', formats: ['es'], fileName: () => 'minimal.mjs' }, outDir: '.qualification/minimal-build', emptyOutDir: true, minify: false } })
  const chunks = graph.flatMap((part) => part.chunks).filter((part) => part.type === 'chunk')
  const rendered = chunks.flatMap((chunk) => chunk.modules).filter((item) => item.renderedLength > 0)
  assert.ok(rendered.some((item) => /source\.svelte\.js/.test(item.id)), 'Minimal public handle entry was not emitted')
  assert.ok(!rendered.some((item) => /(?:Canvas|ShaderGradient|ShaderGradientSource|ShaderGradientView)\.svelte|node_modules\/.*three\//.test(item.id)), 'Unused renderer/component implementation survived minimal public entry')
  const module = await import(pathToFileURL(resolve('.qualification/minimal-build/minimal.mjs')).href)
  assert.equal(Object.keys(module.publicPresets).length, 10)
  assert.equal(module.publicPresetsArray.length, 10)
  const source = module.makeSource()
  try { assert.equal(source.state.status, 'absent') } finally { source.dispose() }
  report = { graph, executed: true, excludedUnusedComponentsAndThree: true, shaderAssets: await unusedShaderAssets() }
} else if (mode === 'minimal-assets') {
  // Artifact-only failed-before proof. No build, execution claim or old-report
  // replacement; the normal minimal mode always retains all qualification.
  report = { artifactOnly: true, shaderAssets: await unusedShaderAssets() }
} else if (mode === 'probe') {
  try {
    await build({ configFile: false, publicDir: false, plugins: [svelte({ ...qualificationSvelteOptions, configFile: false })], build: { lib: { entry: '.qualification/probe.mjs', formats: ['es'] }, outDir: '.qualification/probe-build', emptyOutDir: true } })
  } catch (error) {
    await writeFile(reportPath, JSON.stringify({ rejected: true, code: error.code, message: error.message, stack: error.stack }, null, 2))
    process.exitCode = 1
  }
  if (!process.exitCode) { await writeFile(reportPath, JSON.stringify({ rejected: false })); process.exitCode = 0 }
} else throw new Error('Unknown qualification mode ' + mode)
if (report) {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', mode === 'minimal-assets' ? { flag: 'wx' } : undefined)
  if (report.shaderAssets) assert.equal(report.shaderAssets.retainedAssetCount, 0, 'Unused public shader ASSET payload survived minimal public entry; see ' + reportPath)
}
`

async function driver(ctx, cell, mode, expectedFailure = false) {
  ctx.cancellation.check()
  const report = join(cell.root, '.qualification', `${mode}-report.json`)
  const result = await run(
    ctx,
    `${cell.id}-${mode}`,
    ctx.toolchain.node,
    [
      '--conditions=svelte',
      join(cell.root, '.qualification/driver.mjs'),
      mode,
      report,
      cell.svelteVersion,
    ],
    {
      cwd: cell.root,
      isolated: true,
      env: { VITE_GRADIENT_FIXTURE: '1' },
      expectedFailure,
    }
  )
  return { ...(await json(report, ctx.cancellation)), report, log: result.log }
}
async function packageProbes(ctx, cell, packages, installed) {
  ctx.cancellation.check()
  const { cancellation } = ctx
  const { readFile, writeFile, rm } = cancellation.fs
  const native = installed.native.root
  const entry = (await json(join(native, 'package.json'), cancellation))
    .exports['.'].svelte
  const probe = join(cell.root, '.qualification/probe.mjs')
  const results = []
  async function rejectProbe(id, source, meaning) {
    ctx.cancellation.check()
    await writeFile(probe, source)
    const result = await driver(ctx, cell, 'probe', true)
    assert.equal(
      result.rejected,
      true,
      `${id} failed without a meaningful bundler error`
    )
    assert.match(
      result.message,
      meaning,
      `${id} rejected for an unrelated reason`
    )
    const report = join(cell.root, '.qualification', `${id}-failure.json`)
    await putJSON(report, result, cancellation)
    results.push({ id, report, code: result.code, message: result.message })
  }
  try {
    await rejectProbe(
      'unavailable-public-export',
      `import { __unavailable_shadergradient_public_export__ } from '${packages.native.name}'; console.log(__unavailable_shadergradient_public_export__);`,
      /__unavailable_shadergradient_public_export__/
    )
    await rejectProbe(
      'private-subpath',
      `import '${packages.native.name}/src/lib/Canvas.svelte';`,
      /(?:exports|export|specifier|subpath|src\/lib\/Canvas)/i
    )
    const target = resolve(native, entry)
    const original = await readFile(target)
    try {
      await rm(target)
      await rejectProbe(
        'missing-public-file',
        `import { createGradientSource } from '${packages.native.name}'; console.log(createGradientSource());`,
        /(?:resolve|load|entry|ENOENT|index\.js)/i
      )
    } catch (error) {
      ctx.cancellation.fail(error)
      throw error
    } finally {
      await ctx.cancellation.cleanup(() =>
        rawFilesystem.writeFile(target, original)
      )
    }
    const manifestPath = join(native, 'package.json')
    const originalManifest = await readFile(manifestPath)
    try {
      const unavailableConditions = JSON.parse(originalManifest)
      unavailableConditions.exports['.'] = {
        types: unavailableConditions.exports['.'].types,
      }
      // The declaration exists, but no runtime export condition can resolve.
      // Detach a possible pnpm-store hardlink before mutating only this copy.
      await rm(manifestPath)
      await putJSON(manifestPath, unavailableConditions, cancellation)
      await rejectProbe(
        'missing-runtime-export-condition',
        `import { createGradientSource } from '${packages.native.name}'; console.log(createGradientSource());`,
        /(?:condition|export|resolve|entry|specifier)/i
      )
    } catch (error) {
      ctx.cancellation.fail(error)
      throw error
    } finally {
      await ctx.cancellation.cleanup(() =>
        rawFilesystem.writeFile(manifestPath, originalManifest)
      )
    }
    await assertFiles(native, packages.native.files, cancellation)
  } catch (error) {
    ctx.cancellation.fail(error)
    throw error
  } finally {
    await ctx.cancellation.cleanup(() =>
      rawFilesystem.rm(probe, { force: true })
    )
    await ctx.cancellation.cleanup(() =>
      rawFilesystem.rm(join(cell.root, '.qualification/probe-build'), {
        recursive: true,
        force: true,
      })
    )
  }
  return results
}
async function pureNodeCore(ctx, artifact) {
  ctx.cancellation.check()
  const { cancellation } = ctx
  const { mkdir, cp, writeFile } = cancellation.fs
  const root = join(ctx.root, 'pure-node-core')
  await mkdir(join(root, 'node_modules/@shadergradient'), { recursive: true })
  await cp(artifact.unpacked, join(root, 'node_modules/@shadergradient/core'), {
    recursive: true,
    filter: () => {
      cancellation.check()
      return true
    },
  })
  await assertFiles(
    join(root, 'node_modules/@shadergradient/core'),
    artifact.files,
    cancellation
  )
  await putJSON(
    join(root, 'package.json'),
    { private: true, type: 'module' },
    cancellation
  )
  const loader = join(root, 'deny-runtime-dependencies.mjs')
  await writeFile(
    loader,
    `import { fileURLToPath } from 'node:url'; import { relative, isAbsolute } from 'node:path';\nexport async function resolve(specifier, context, nextResolve) { if (!specifier.startsWith('.') && !specifier.startsWith('file:') && !specifier.startsWith('node:') && specifier !== '@shadergradient/core') throw new Error('Pure core attempted runtime dependency: ' + specifier); const result = await nextResolve(specifier, context); if (result.url.startsWith('file:')) { const rel = relative(${JSON.stringify(
      root
    )}, fileURLToPath(result.url)); if (rel.startsWith('../') || isAbsolute(rel)) throw new Error('Pure core escaped isolated root: ' + result.url); } return result; }\n`
  )
  await writeFile(
    join(root, 'probe.mjs'),
    `import assert from 'node:assert/strict'; import * as core from '@shadergradient/core';\nassert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined'); assert.equal(typeof WebGLRenderingContext, 'undefined');\nassert.equal(Object.keys(core.presets).length, 10); assert.equal(core.presetsArray.length, 10); assert.equal(typeof core.compatibleShader, 'function'); assert.equal(typeof core.shaders, 'object'); assert.equal(typeof core.HalftoneShader.fragmentShader, 'string'); assert.deepEqual(Object.keys(core.environmentManifest).sort(), ['city','dawn','lobby']); assert.equal(typeof core.defaultEnvBasePath, 'string');\nprocess.stdout.write(JSON.stringify({exports:Object.keys(core).sort(),presets:core.presetsArray.length,domAbsent:true,frameworkAndThreeDenied:true}));\n`
  )
  const result = await run(
    ctx,
    'pure-node-core',
    ctx.toolchain.node,
    ['--experimental-loader', loader, join(root, 'probe.mjs')],
    { cwd: root, isolated: true }
  )
  // Loader warnings remain in the retained log; parse only the probe's JSON line.
  const match = result.output.match(/\{"exports":.*\}/)
  assert.ok(match, 'Pure core did not report actual public data import')
  return {
    ...JSON.parse(match[0]),
    root,
    log: result.log,
    files: await inventory(root, undefined, cancellation),
  }
}
async function assetProbe(ctx, cell) {
  ctx.cancellation.check()
  const { cancellation } = ctx
  const { readFile, writeFile, rm } = cancellation.fs
  const target = join(
    cell.root,
    cell.kind === 'plain' ? 'public' : 'static',
    'native-feature-hdr/city.hdr'
  )
  const original = await readFile(target)
  const source = join(cell.root, '.qualification/probe.mjs')
  try {
    await writeFile(
      source,
      `import hdr from '../${
        cell.kind === 'plain' ? 'public' : 'static'
      }/native-feature-hdr/city.hdr?url'; console.log(hdr);`
    )
    const baseline = await driver(ctx, cell, 'probe')
    assert.equal(
      baseline.rejected,
      false,
      'Intact public runtime asset could not actually build'
    )
    await putJSON(
      join(cell.root, '.qualification/runtime-asset-baseline.json'),
      baseline,
      cancellation
    )
    await rm(target)
    const result = await driver(ctx, cell, 'probe', true)
    assert.equal(result.rejected, true)
    assert.match(result.message, /(?:city\.hdr|resolve|load|ENOENT)/i)
    const report = join(
      cell.root,
      '.qualification/missing-runtime-asset-failure.json'
    )
    await putJSON(report, result, cancellation)
    return { report, code: result.code, message: result.message }
  } catch (error) {
    ctx.cancellation.fail(error)
    throw error
  } finally {
    await ctx.cancellation.cleanup(() =>
      rawFilesystem.writeFile(target, original)
    )
    await ctx.cancellation.cleanup(() =>
      rawFilesystem.rm(source, { force: true })
    )
    await ctx.cancellation.cleanup(() =>
      rawFilesystem.rm(join(cell.root, '.qualification/probe-build'), {
        recursive: true,
        force: true,
      })
    )
  }
}
async function prepareCell(ctx, spec, packages, typesRoot) {
  ctx.cancellation.check()
  const { cancellation } = ctx
  const { readFile, writeFile, mkdir, cp, rm } = cancellation.fs
  const cell = {
    ...spec,
    root: join(ctx.root, 'consumers', spec.id),
    mode: 'production',
    baseURL: `http://127.0.0.1:${spec.port}`,
  }
  const starter = join(
    checkout,
    'apps/examples',
    spec.kind === 'plain' ? 'example-vite-svelte' : 'example-sveltekit'
  )
  await copySources(starter, cell.root, cancellation)
  const manifest = await json(join(cell.root, 'package.json'), cancellation)
  manifest.dependencies[packages.core.name] = `file:${packages.core.tarball}`
  manifest.dependencies[
    packages.native.name
  ] = `file:${packages.native.tarball}`
  manifest.dependencies.svelte = spec.svelteVersion
  const expectedPins = consumerPins(spec)
  for (const [name, version] of Object.entries(expectedPins)) {
    if (name in (manifest.dependencies ?? {}))
      manifest.dependencies[name] = version
    else (manifest.devDependencies ??= {})[name] = version
  }
  await putJSON(join(cell.root, 'package.json'), manifest, cancellation)
  // Preserve the independent starter's approval boundary, replacing only its
  // local tarball override with this actual newly packed core artifact.
  const workspacePath = join(cell.root, 'pnpm-workspace.yaml')
  const workspace = await readFile(workspacePath, 'utf8')
  assert.match(workspace, /'@shadergradient\/core':[^\n]+/)
  await writeFile(
    workspacePath,
    workspace.replace(
      /'@shadergradient\/core':[^\n]+/,
      `'@shadergradient/core': ${JSON.stringify(
        `file:${packages.core.tarball}`
      )}`
    )
  )
  await mkdir(join(cell.root, '.qualification'), { recursive: true })
  // Shared by all qualification compilers, including configFile:false SSR and
  // the Kit 3 inline plugin (which deliberately does not load svelte.config.js).
  // https://svelte.dev/docs/svelte/typescript#Preprocessor-setup
  await writeFile(
    join(cell.root, '.qualification/svelte-options.mjs'),
    "import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'\nexport default { preprocess: vitePreprocess({ script: true }) }\n"
  )
  await writeFile(
    join(cell.root, '.qualification/driver.mjs'),
    qualificationDriver
  )
  const isolation = { cwd: cell.root, isolated: true }
  const install = await pnpm(
    ctx,
    `${cell.id}-install`,
    ['install', '--no-frozen-lockfile', '--strict-peer-dependencies'],
    isolation
  )
  // Qualify the original independent starter before replacing only OWNED src.
  const starterInputs = await inventory(cell.root, sourceFilter, cancellation)
  const starterCheck = await pnpm(
    ctx,
    `${cell.id}-starter-check`,
    ['check'],
    isolation
  )
  const starterBuild = await pnpm(
    ctx,
    `${cell.id}-starter-build`,
    ['build'],
    isolation
  )
  const starterOutput = join(
    cell.root,
    spec.kind === 'plain' ? 'dist' : 'build'
  )
  const starterArtifacts = {
    root: starterOutput,
    files: await inventory(starterOutput, undefined, cancellation),
  }
  await putJSON(
    join(cell.root, '.qualification/starter-evidence.json'),
    {
      inputs: starterInputs,
      artifacts: starterArtifacts,
      check: starterCheck.log,
      build: starterBuild.log,
    },
    cancellation
  )
  const starterSnapshot = join(cell.root, '.qualification/starter-build')
  await cp(starterOutput, starterSnapshot, { recursive: true })
  await rm(join(cell.root, 'src'), { recursive: true })
  await copySources(
    join(
      checkout,
      'apps',
      spec.kind === 'plain'
        ? 'example-svelte-dev/src'
        : 'example-sveltekit-dev/src'
    ),
    join(cell.root, 'src'),
    cancellation
  )
  // Feature sources share app-only presentation files outside each workspace
  // app. Relocate those files inside this independently installed consumer;
  // checkout denial must remain effective during compilation and runtime.
  for (const name of ['demo-studio.css', 'demo-query.ts']) {
    await writeFile(
      join(cell.root, 'src', name),
      await readFile(join(checkout, 'apps', name))
    )
  }
  const presentationImports =
    spec.kind === 'plain'
      ? {
          'App.svelte': { '../../demo-query': './demo-query' },
          'style.css': { '../../demo-studio.css': './demo-studio.css' },
        }
      : {
          'routes/+page.svelte': {
            '../../../demo-query': '../demo-query',
            '../../../demo-studio.css': '../demo-studio.css',
          },
          'routes/away/+page.svelte': {
            '../../../../demo-studio.css': '../../demo-studio.css',
          },
        }
  for (const [file, imports] of Object.entries(presentationImports)) {
    const path = join(cell.root, 'src', file)
    let source = await readFile(path, 'utf8')
    for (const [from, to] of Object.entries(imports))
      source = source.replaceAll(from, to)
    await writeFile(path, source)
  }
  // Preserve the original starter's preceding check/build evidence; only the
  // owned full-feature qualification copy needs explicit script transpilation.
  if (spec.kind === 'plain') {
    const configPath = join(cell.root, 'svelte.config.js')
    await writeFile(
      join(cell.root, '.qualification/starter-svelte.config.js'),
      await readFile(configPath)
    )
    await writeFile(
      configPath,
      "import options from './.qualification/svelte-options.mjs'\nexport default options\n"
    )
  } else {
    const configPath = join(cell.root, 'vite.config.js')
    const original = await readFile(configPath, 'utf8')
    const constructor = 'sveltekit({ adapter: adapter() })'
    assert.equal(
      original.split(constructor).length,
      2,
      'Independent Kit starter configuration changed; qualification must preserve its actual plugin options'
    )
    await writeFile(
      join(cell.root, '.qualification/starter-vite.config.js'),
      original
    )
    await writeFile(
      configPath,
      "import qualificationSvelteOptions from './.qualification/svelte-options.mjs'\n" +
        original.replace(
          constructor,
          'sveltekit({ ...qualificationSvelteOptions, adapter: adapter() })'
        )
    )
  }
  if (spec.kind === 'plain') {
    const tsconfigPath = join(cell.root, 'tsconfig.json')
    const tsconfig = await json(tsconfigPath, cancellation)
    tsconfig.compilerOptions.lib = ['ES2024', 'DOM', 'DOM.Iterable']
    await putJSON(tsconfigPath, tsconfig, cancellation)
  }
  const publicRoot = join(
    cell.root,
    spec.kind === 'plain' ? 'public' : 'static'
  )
  await mkdir(publicRoot, { recursive: true })
  const featureRoot = join(
    checkout,
    'apps',
    spec.kind === 'plain' ? 'example-svelte-dev' : 'example-sveltekit-dev'
  )
  for (const assetDirectory of ['public', 'static']) {
    const source = join(featureRoot, assetDirectory)
    if (await exists(source, cancellation))
      await copySources(source, publicRoot, cancellation)
  }
  await copySources(
    join(checkout, 'packages/ui/assets/hdr'),
    join(publicRoot, 'native-feature-hdr'),
    cancellation
  )
  const installed = await installedEvidence(cell.root, packages, cancellation)
  const toolchain = await driver(ctx, cell, 'context')
  for (const [name, expected] of Object.entries(expectedPins))
    assert.equal(
      toolchain.packages[name].version,
      expected,
      `${cell.id}: actual ${name} mismatch`
    )
  const check = await pnpm(
    ctx,
    `${cell.id}-feature-check`,
    ['check'],
    isolation
  )
  const typeReport = join(cell.root, '.qualification/public-types.json')
  await run(
    ctx,
    `${cell.id}-public-types`,
    ctx.toolchain.node,
    [
      join(typesRoot, 'run.mjs'),
      '--consumer-root',
      cell.root,
      '--expect-svelte',
      spec.svelteVersion,
      '--case',
      'all',
      '--artifact-id',
      `core=${packages.core.sha256},native=${packages.native.sha256}`,
      '--report',
      typeReport,
    ],
    isolation
  )
  const types = await json(typeReport, cancellation)
  assert.equal(types.passed, true)
  assert.equal(
    types.cases.length,
    38,
    `${cell.id}: incomplete public positive/37-negative matrix`
  )
  const probes = await packageProbes(ctx, cell, packages, installed)
  probes.push({ id: 'missing-runtime-asset', ...(await assetProbe(ctx, cell)) })
  await writeFile(
    join(cell.root, '.qualification/minimal.mjs'),
    `import { createGradientSource, presets, presetsArray } from '@shadergradient/svelte';\nexport const makeSource = () => createGradientSource();\nexport { presets as publicPresets, presetsArray as publicPresetsArray };\n`
  )
  const treeShaking = await driver(ctx, cell, 'minimal')
  let ssr
  if (spec.kind === 'plain') {
    await writeFile(
      join(cell.root, '.qualification/ssr-entry.mjs'),
      "export { render } from 'svelte/server'; export { default as App } from '../src/App.svelte';\n"
    )
    const compiled = await driver(ctx, cell, 'ssr')
    ssr = {
      root: join(cell.root, '.qualification/ssr'),
      entry: compiled.entry,
      files: await inventory(
        join(cell.root, '.qualification/ssr'),
        undefined,
        cancellation
      ),
      report: compiled.report,
    }
  }
  const production = await driver(ctx, cell, 'production')
  const minimalBytes = treeShaking.graph
    .flatMap((part) => part.chunks)
    .filter((item) => item.type === 'chunk')
    .reduce((sum, item) => sum + item.bytes, 0)
  const fullBytes = production.graph
    .flatMap((part) => part.chunks)
    .filter((item) => item.type === 'chunk')
    .reduce((sum, item) => sum + item.bytes, 0)
  assert.ok(
    fullBytes > minimalBytes,
    'A real minimal public entry did not remove output relative to the complete feature consumer'
  )
  assert.ok(
    production.graph
      .flatMap((part) => part.chunks)
      .some(
        (item) =>
          item.type === 'asset' &&
          item.fileName.endsWith('.css') &&
          item.bytes > 0
      ),
    'Complete feature consumer lost CSS side effects'
  )
  treeShaking.outputBytes = {
    minimal: minimalBytes,
    completeFeatureConsumer: fullBytes,
  }
  await installedEvidence(cell.root, packages, cancellation)
  const productionRoot = join(
    cell.root,
    spec.kind === 'plain' ? 'dist' : 'build'
  )
  const command =
    spec.kind === 'plain'
      ? join(toolchain.packages.vite.root, 'bin/vite.js')
      : join(cell.root, 'build/index.js')
  assert.ok(
    await exists(command, cancellation),
    `Production launch entry is missing: ${command}`
  )
  const args =
    spec.kind === 'plain'
      ? [
          command,
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          String(spec.port),
          '--strictPort',
        ]
      : [command]
  cell.launch = {
    ...sandbox(ctx, cell.root, ctx.toolchain.node, args),
    env: {
      HOST: '127.0.0.1',
      PORT: String(spec.port),
      ORIGIN: cell.baseURL,
      NODE_ENV: 'production',
      NODE_PATH: '',
      TMPDIR: join(ctx.root, 'tmp'),
      VITE_GRADIENT_FIXTURE: '1',
    },
  }
  cell.artifacts = {
    starter: {
      root: starterSnapshot,
      files: await inventory(starterSnapshot, undefined, cancellation),
      evidence: join(cell.root, '.qualification/starter-evidence.json'),
    },
    production: {
      root: productionRoot,
      files: await inventory(productionRoot, undefined, cancellation),
    },
    installed,
    publicAssets: {
      root: publicRoot,
      files: await inventory(publicRoot, undefined, cancellation),
    },
    ...(ssr ? { ssr } : {}),
    typeReport,
    qualificationReport: join(cell.root, '.qualification/qualification.json'),
  }
  cell.evidence = {
    isolation: {
      kind: 'bubblewrap-checkout-hidden',
      checkoutHidden: checkout,
      prefix: ctx.prefix,
      node: ctx.toolchain.node,
    },
    toolchainQualification: {
      sdkCompilerFloor: '5.40.0',
      applicationCompilerFloor: spec.kind === 'kit' ? '5.57.1' : '5.40.0',
      expectedPins,
      peerContracts: Object.fromEntries(
        Object.entries(toolchain.packages).map(([name, item]) => [
          name,
          {
            root: item.root,
            version: item.version,
            peerDependencies: item.manifest.peerDependencies ?? {},
          },
        ])
      ),
    },
    install: install.log,
    starter: { check: starterCheck.log, build: starterBuild.log },
    check: check.log,
    toolchain,
    types: {
      report: typeReport,
      cases: types.cases.length,
      passed: types.passed,
      context: types.context,
    },
    graph: production,
    probes,
    treeShaking,
  }
  await putJSON(cell.artifacts.qualificationReport, cell.evidence, cancellation)
  // Every own config/source/output/report and every installed dependency is part
  // of reuse identity, not just two hand-picked package entry files.
  cell.artifacts.inputs = {
    root: cell.root,
    files: await inventory(
      cell.root,
      (path) =>
        !path
          .split('/')
          .some((name) =>
            ['node_modules', 'dist', 'build', '.svelte-kit'].includes(name)
          ),
      cancellation
    ),
  }
  const dependencyRoot = join(cell.root, 'node_modules')
  cell.artifacts.dependencies = {
    root: dependencyRoot,
    files: await inventory(
      dependencyRoot,
      (_path, item) => !item.isSymbolicLink(),
      cancellation
    ),
    links: await dependencyLinks(dependencyRoot, cancellation),
  }
  return cell
}

export async function loadPreparedNativeConsumers(manifestPath, options = {}) {
  const cancellation = preparationCancellation(options.signal)
  try {
    const prepared = await loadWithCancellation(manifestPath, cancellation)
    cancellation.check()
    return prepared
  } catch (error) {
    throw cancellation.fail(error)
  } finally {
    cancellation.dispose()
  }
}

async function loadWithCancellation(manifestPath, cancellation) {
  const { readFile } = cancellation.fs
  const path = absolute(manifestPath, 'manifestPath')
  const prepared = await json(path, cancellation)
  assert.equal(
    prepared.schemaVersion,
    1,
    'Unsupported prepared native manifest schema'
  )
  assert.equal(
    prepared.manifestPath,
    path,
    'Manifest was relocated without its identity'
  )
  const root = absolute(prepared.artifactRoot, 'artifactRoot')
  assert.ok(
    !inside(checkout, root) && !inside(root, checkout),
    'Artifact root must be disjoint from checkout'
  )
  assert.equal(
    (await json(join(root, marker), cancellation)).owner,
    owner,
    'Artifact ownership marker mismatch'
  )
  assert.equal(prepared.resources.owner, owner)
  assert.deepEqual(
    prepared.candidate,
    await inputIdentity(cancellation),
    'Prepared artifacts are stale: candidate/package/fixture/controller inputs changed'
  )
  assert.deepEqual(
    prepared.evidence.controller,
    await tools(cancellation),
    'Prepared artifacts use a different Node/pnpm/bubblewrap toolchain'
  )
  for (const artifact of Object.values(prepared.packages)) {
    assert.ok(
      inside(root, artifact.tarball) && inside(root, artifact.unpacked),
      'Tarball/extraction must remain owned'
    )
    assert.equal(
      sha(await readFile(artifact.tarball)),
      artifact.sha256,
      'Packed tarball changed after preparation'
    )
    assert.deepEqual(
      await inventory(artifact.unpacked, undefined, cancellation),
      artifact.files,
      'Packed extraction no longer matches original file inventory'
    )
    const directory = join(
      checkout,
      'packages',
      artifact.name === prepared.packages.core.name
        ? 'shadergradient-core'
        : 'shadergradient-svelte',
      'dist'
    )
    const shippedDist = artifact.files
      .filter((file) => file.path.startsWith('dist/'))
      .map((file) => ({ ...file, path: file.path.slice('dist/'.length) }))
    assert.deepEqual(
      await inventory(directory, undefined, cancellation),
      shippedDist,
      'Current complete public build differs from packed candidate; prepare fresh artifacts'
    )
  }
  assert.equal(prepared.consumers.length, cells.length)
  for (const spec of cells) {
    const cell = prepared.consumers.find((item) => item.id === spec.id)
    assert.ok(cell, `Missing independent consumer ${spec.id}`)
    for (const [key, value] of Object.entries(spec))
      assert.equal(cell[key], value)
    assert.equal(cell.mode, 'production')
    assert.equal(cell.baseURL, `http://127.0.0.1:${spec.port}`)
    assert.equal(cell.launch.cwd, cell.root)
    assert.ok(
      inside(root, cell.root),
      `Consumer escaped owned artifact root: ${cell.root}`
    )
    await installedEvidence(cell.root, prepared.packages, cancellation)
    for (const [name, item] of Object.entries(cell.artifacts)) {
      if (
        !item ||
        typeof item !== 'object' ||
        !item.root ||
        !item.files ||
        name === 'dependencies'
      )
        continue
      assert.ok(inside(root, item.root))
      const filter =
        name === 'inputs'
          ? (path) =>
              !path
                .split('/')
                .some((part) =>
                  ['node_modules', 'dist', 'build', '.svelte-kit'].includes(
                    part
                  )
                )
          : () => true
      assert.deepEqual(
        await inventory(item.root, filter, cancellation),
        item.files,
        `Prepared ${cell.id}/${name} inventory changed`
      )
    }
    assert.deepEqual(
      await inventory(
        cell.artifacts.dependencies.root,
        (_path, item) => !item.isSymbolicLink(),
        cancellation
      ),
      cell.artifacts.dependencies.files,
      'Installed dependency inventory changed'
    )
    assert.deepEqual(
      await dependencyLinks(cell.artifacts.dependencies.root, cancellation),
      cell.artifacts.dependencies.links,
      'Installed dependency resolution links changed'
    )
    for (const artifact of Object.values(cell.artifacts.installed))
      await assertFiles(artifact.root, artifact.files, cancellation)
    assert.equal(
      (await json(cell.artifacts.typeReport, cancellation)).passed,
      true,
      'Stored public compiler matrix did not pass'
    )
    assert.equal(cell.launch.command, prepared.evidence.controller.bwrap)
    assert.ok(
      cell.launch.args.includes(checkout) &&
        cell.launch.args.includes('--tmpfs'),
      'Production launch lost checkout-denial sandbox'
    )
  }
  assert.deepEqual(
    await inventory(
      prepared.evidence.pureNodeCore.root,
      undefined,
      cancellation
    ),
    prepared.evidence.pureNodeCore.files,
    'Pure Node proof inputs changed'
  )
  assert.deepEqual(
    await inventory(
      prepared.evidence.controllers.root,
      undefined,
      cancellation
    ),
    prepared.evidence.controllers.files,
    'Copied qualification controllers changed'
  )
  await usage(root, cancellation)
  return prepared
}

export async function prepareNativeConsumers(options = {}) {
  const cancellation = preparationCancellation(options.signal)
  let prepared
  try {
    prepared = await prepareWithCancellation(options, cancellation)
    cancellation.check()
    return prepared
  } catch (error) {
    const failure = cancellation.fail(error)
    if (prepared && !options.reuseManifest) {
      // Cover cancellation in the final async return hand-off as well as the
      // manifest write itself. Reused artifacts are never this call's to delete.
      await cancellation.cleanup(() => rm(prepared.manifestPath))
      await cancellation.cleanup(() =>
        putJSON(join(prepared.artifactRoot, 'preparation-failure.json'), {
          failedAt: new Date().toISOString(),
          message: failure?.message ?? String(failure),
          stack: failure?.stack,
          artifactRoot: prepared.artifactRoot,
          manifestPath: prepared.manifestPath,
          resources: prepared.resources,
          cleanupErrors: cancellation.cleanupErrors,
        })
      )
    }
    throw failure
  } finally {
    cancellation.dispose()
  }
}

async function prepareWithCancellation(options, cancellation) {
  if (options.reuseManifest) {
    const prepared = await cancellation.step(() =>
      loadWithCancellation(options.reuseManifest, cancellation)
    )
    if (options.artifactRoot)
      assert.equal(
        absolute(options.artifactRoot, 'artifactRoot'),
        prepared.artifactRoot
      )
    if (options.manifestPath)
      assert.equal(
        absolute(options.manifestPath, 'manifestPath'),
        prepared.manifestPath
      )
    cancellation.check()
    return prepared
  }
  const artifactRoot = options.artifactRoot
    ? absolute(options.artifactRoot, 'artifactRoot')
    : join('/var/tmp', 'shadergradient-native-f26-' + randomUUID())
  assert.ok(
    !inside(checkout, artifactRoot) && !inside(artifactRoot, checkout),
    'Artifact root must be outside checkout discovery'
  )
  assert.ok(
    !['/', '/tmp', '/var/tmp', homedir()].includes(artifactRoot),
    'Refusing unscoped artifact root'
  )
  await cancellation.step(() => mkdir(artifactRoot, { recursive: true }))
  assert.equal(
    await cancellation.step(() => realpath(artifactRoot)),
    artifactRoot,
    'Use a canonical artifact root, not a symlink into another ownership boundary'
  )
  assert.equal(
    (await cancellation.step(() => readdir(artifactRoot))).length,
    0,
    'Fresh preparation requires an empty owned artifact root; use --reuse-manifest for prepared artifacts'
  )
  const manifestPath = options.manifestPath
    ? absolute(options.manifestPath, 'manifestPath')
    : join(artifactRoot, 'prepared-native-consumers.json')
  assert.ok(
    !inside(checkout, manifestPath),
    'Do not write preparation evidence over checkout files'
  )
  assert.ok(
    !(await exists(manifestPath, cancellation)),
    'Refusing to overwrite an existing manifest; use --reuse-manifest or a fresh owned destination'
  )
  const resources = {
    owner,
    cleanup: `Remove only the owned directory ${artifactRoot}${
      inside(artifactRoot, manifestPath)
        ? ''
        : ` and owned manifest ${manifestPath}`
    } after all declared production servers have stopped; retain shared pnpm/browser caches.`,
    budgetBytes,
  }
  // Register ownership and exact cleanup before acquiring packages or consumers.
  cancellation.check()
  await writeFile(
    join(artifactRoot, marker),
    JSON.stringify(
      {
        ...resources,
        artifactRoot,
        manifestPath,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  )
  cancellation.check()
  const filesystem = await cancellation.step(() => statfs(artifactRoot))
  assert.notEqual(
    Number(filesystem.type),
    0x01021994,
    'Artifact root must be disk-backed, not tmpfs'
  )
  await cancellation.step(() => mkdir(join(artifactRoot, 'logs')))
  let manifestOwned = false
  try {
    const controller = await cancellation.step(() => tools(cancellation))
    const ctx = await cancellation.step(() =>
      context(artifactRoot, controller, cancellation)
    )
    const version = await pnpm(ctx, 'pnpm-version', ['--version'])
    const candidate = await cancellation.step(() => inputIdentity(cancellation))
    const core = await cancellation.step(() => pack(ctx, 'core'))
    const native = await cancellation.step(() => pack(ctx, 'native'))
    const nativeManifest = await cancellation.step(() =>
      json(join(native.unpacked, 'package.json'), cancellation)
    )
    assert.equal(
      nativeManifest.dependencies?.[core.name],
      `^${core.version}`,
      'Native artifact must resolve its public workspace:^ dependency to the actual packed core version'
    )
    assert.equal(
      Object.keys(
        (
          await cancellation.step(() =>
            json(join(core.unpacked, 'package.json'), cancellation)
          )
        ).dependencies ?? {}
      ).length,
      0,
      'Pure core acquired runtime dependencies'
    )
    const packages = { core, native }
    const pure = await cancellation.step(() => pureNodeCore(ctx, core))
    const typesRoot = join(artifactRoot, 'controllers/public-types')
    await cancellation.step(() =>
      copySources(join(checkout, 'tests/svelte/types'), typesRoot, cancellation)
    )
    const consumers = []
    for (const spec of cells)
      consumers.push(
        await cancellation.step(() =>
          prepareCell(ctx, spec, packages, typesRoot)
        )
      )
    assert.deepEqual(
      candidate,
      await cancellation.step(() => inputIdentity(cancellation)),
      'Candidate changed during preparation; discard partial evidence and prepare again'
    )
    const prepared = {
      schemaVersion: 1,
      artifactRoot,
      manifestPath,
      candidate,
      packages,
      consumers,
      evidence: {
        createdAt: new Date().toISOString(),
        controller,
        identityScope:
          'Preparation candidate only: runtime-only verifier changes may reuse validated unchanged artifacts. Final F31 integrated qualification must separately fingerprint the runtime verifier and browser specifications together with this candidate.',
        pnpmVersion: version.output.trim(),
        pureNodeCore: pure,
        controllers: {
          root: typesRoot,
          files: await cancellation.step(() =>
            inventory(typesRoot, undefined, cancellation)
          ),
        },
        isolation:
          'Actual install/check/build/probes in bubblewrap with the entire checkout hidden',
        budgetUsedBytes: await cancellation.step(() =>
          usage(artifactRoot, cancellation)
        ),
      },
      resources,
    }
    await cancellation.step(() =>
      mkdir(dirname(manifestPath), { recursive: true })
    )
    const serialized = JSON.stringify(prepared, null, 2) + '\n'
    cancellation.check()
    // Do not put open() behind a post-acquisition checkpoint: even a late abort
    // must first receive the handle and record this exact file's ownership.
    const manifest = await open(manifestPath, 'wx')
    manifestOwned = true
    try {
      cancellation.check()
      await cancellation.step(() => manifest.writeFile(serialized))
    } finally {
      // Closing is unconditional, including abort/write failure, and cannot
      // replace the first failure (even a falsy/primitive/frozen reason).
      await cancellation.cleanup(() => manifest.close())
    }
    cancellation.check()
    // Fresh and reused callers receive the same persisted JSON representation;
    // optional diagnostic fields must not survive only as in-memory undefined.
    return JSON.parse(serialized)
  } catch (error) {
    const failure = cancellation.fail(error)
    // Exclusive open establishes ownership before write/close can fail.
    // EEXIST never sets this flag and must never remove the caller's file.
    if (manifestOwned) {
      try {
        await rm(manifestPath)
      } catch (cleanupError) {
        cancellation.cleanupFailure(cleanupError)
      }
    }
    try {
      const diagnostic = join(artifactRoot, 'preparation-failure.json')
      await putJSON(
        manifestPath === diagnostic
          ? join(artifactRoot, 'preparation-failure-details.json')
          : diagnostic,
        {
          failedAt: new Date().toISOString(),
          message: failure?.message ?? String(failure),
          stack: failure?.stack,
          artifactRoot,
          manifestPath,
          resources,
          cleanupErrors: cancellation.cleanupErrors,
        },
        undefined,
        { flag: 'wx' }
      )
    } catch (diagnosticError) {
      // Failed diagnostics must never replace an Error, DOMException, or
      // primitive abort reason supplied by the caller.
      cancellation.cleanupFailure(diagnosticError)
    }
    throw failure
  }
}

async function main() {
  const abort = new AbortController()
  const onSignal = (signal) => {
    if (abort.signal.aborted) return
    const error = interruption(signal)
    process.exitCode = error.exitCode
    abort.abort(error)
  }
  const onSIGINT = () => onSignal('SIGINT')
  const onSIGTERM = () => onSignal('SIGTERM')
  process.on('SIGINT', onSIGINT)
  process.on('SIGTERM', onSIGTERM)
  try {
    await executeMain(abort.signal)
  } finally {
    process.removeListener('SIGINT', onSIGINT)
    process.removeListener('SIGTERM', onSIGTERM)
  }
}

async function executeMain(signal) {
  const options = { signal }
  let prepareOnly = false
  const flags = new Map([
    ['--artifact-root', 'artifactRoot'],
    ['--manifest', 'manifestPath'],
    ['--reuse-manifest', 'reuseManifest'],
  ])
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index]
    if (flag === '--prepare-only') {
      prepareOnly = true
      continue
    }
    if (flag === '--help') {
      console.log(
        'node tests/svelte/package-consumers.mjs [--prepare-only] [--artifact-root ABSOLUTE] [--manifest ABSOLUTE] [--reuse-manifest ABSOLUTE]\nDefault: fresh core/native builds + packs; four checkout-hidden independent starter/feature installs, checks, F22 public-type matrices, production/SSR/minimal builds, meaningful restored failure probes; then production browser/SSR verification. --prepare-only never starts servers or browsers. Reuse rejects changed candidates, tarballs, installed files, output/config/report hashes or toolchains. Artifacts are owned and retained for F28; cleanup instructions are in the manifest.'
      )
      console.log(
        '\nPreparation identity excludes the runtime-only verifier, so verifier fixes can reuse strictly validated unchanged artifacts. Final F31 integrated qualification must separately fingerprint the verifier and browser specifications together with this prepared candidate.'
      )
      return
    }
    const key = flags.get(flag)
    assert.ok(key, `Unknown option ${flag}; use --help`)
    const value = process.argv[++index]
    assert.ok(value && !value.startsWith('--'), `Missing value for ${flag}`)
    options[key] = absolute(value, flag)
  }
  const prepared = await prepareNativeConsumers(options)
  signal.throwIfAborted()
  let verification
  if (!prepareOnly) {
    // Deliberately dynamic: browser facade imports this module without a TLA cycle.
    const { verifyPreparedNativeConsumers } = await import(
      '../browser/prepare-svelte.mjs'
    )
    signal.throwIfAborted()
    verification = await verifyPreparedNativeConsumers(prepared, { signal })
  }
  signal.throwIfAborted()
  process.stdout.write(
    JSON.stringify(
      {
        manifestPath: prepared.manifestPath,
        candidate: prepared.candidate.fingerprint,
        packages: Object.fromEntries(
          Object.entries(prepared.packages).map(([kind, value]) => [
            kind,
            {
              name: value.name,
              version: value.version,
              tarball: value.tarball,
              sha256: value.sha256,
            },
          ])
        ),
        consumers: prepared.consumers.map(({ id, root, baseURL, launch }) => ({
          id,
          root,
          baseURL,
          launch,
        })),
        ...(verification ? { verification } : {}),
      },
      null,
      2
    ) + '\n'
  )
}

function printFailure(
  error,
  label = 'Native consumer verification failed',
  seen = new Set()
) {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return
    seen.add(error)
  }
  console.error(`${label}: ${error?.stack ?? error}`)
  if (error?.reportPath)
    console.error(`Actual packed runtime failure evidence: ${error.reportPath}`)
  const report = error?.report
  if (report?.error)
    console.error(`Original verification report error: ${report.error}`)
  if (report?.interruptedFailure)
    console.error(
      `Verification failure before interruption: ${report.interruptedFailure}`
    )
  for (const consumer of report?.consumers ?? []) {
    if (consumer.error)
      console.error(
        `Original consumer failure (${consumer.id ?? 'unidentified'}): ${
          consumer.error
        }`
      )
  }
  if (error?.cause) printFailure(error.cause, 'Caused by', seen)
  if (Array.isArray(error?.errors)) {
    for (const [index, nested] of error.errors.entries())
      printFailure(nested, `Aggregate failure ${index + 1}`, seen)
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    printFailure(error)
    process.exitCode ||= error?.exitCode ?? 1
  })
}
