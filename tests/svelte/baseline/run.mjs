import { readFile, writeFile, mkdir, readdir, open } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { scenarios, adapters, commandScenarios, consumerScenarios, policy } from './scenarios.mjs'
import { directory, repository, packageInfo, startFixture } from './server.mjs'

const options = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]
  if (!['--out', '--phase', '--reference', '--only', '--adapter', '--commands', '--consumers',
    '--react-root', '--vue-root', '--launch-args', '--observed', '--host-evidence'].includes(flag) || !process.argv[i + 1])
    throw new Error(`Unknown or missing argument: ${flag}`)
  options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[i + 1]
}
if (!options.out || !['pre', 'post'].includes(options.phase))
  throw new Error('Usage: node tests/svelte/baseline/run.mjs --out NEW_DIRECTORY --phase pre|post [--reference PRE/evidence-index.json]')
if (options.phase === 'post' && !options.reference) throw new Error('Post extraction requires --reference')
if (options.adapter && !adapters.includes(options.adapter)) throw new Error('Invalid adapter')
options.out = resolve(options.out)
await mkdir(options.out, { recursive: true })
if ((await readdir(options.out)).length) throw new Error('Evidence directory must be empty; references are never overwritten')
await mkdir(join(options.out, 'artifacts'))
const indexPath = join(options.out, 'evidence-index.json')
const indexHandle = await open(indexPath, 'wx')
await indexHandle.close()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
const inputHashes = {}
for (const path of ['scenarios.mjs', 'run.mjs', 'server.mjs', 'evidence.schema.json', 'fixture/index.html',
  'fixture/fixture.mjs', 'fixture/react.mjs', 'fixture/vue.mjs'])
  inputHashes[path] = hash(await readFile(join(directory, path)))
inputHashes['pnpm-lock.yaml'] = hash(await readFile(join(repository, 'pnpm-lock.yaml')))
async function hashTree(folder) {
  let entries
  try { entries = await readdir(join(repository, folder), { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) await hashTree(path)
    else if (entry.isFile()) inputHashes[path] = hash(await readFile(join(repository, path)))
  }
}
for (const folder of ['packages/shadergradient/src', 'packages/shadergradient-vue/src', 'packages/shadergradient-core/src'])
  await hashTree(folder)
const rootManifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
const packageManager = { declared: rootManifest.packageManager, observed: null }
try { packageManager.observed = execFileSync('pnpm', ['--version'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
catch (error) { packageManager.observationError = String(error.message) }
const result = (id, kind, extra = {}) => ({ id, kind, status: 'unexercised', reason: 'Not exercised in this run', artifacts: [], ...extra })
const index = {
  schemaVersion: 1, phase: options.phase, createdAt: new Date().toISOString(),
  reference: options.reference ? resolve(options.reference) : null, policy,
  provenance: { commit: git('rev-parse', 'HEAD'), worktree: git('status', '--porcelain=v1'),
    node: process.version, platform: process.platform, arch: process.arch,
    argv: process.argv, cwd: process.cwd(), inputHashes, browser: null, adapters: {},
    packageManager },
  results: [
    ...adapters.flatMap((adapter) => scenarios.map((scenario) => result(`${adapter}/${scenario.id}`, scenario.kind, { adapter }))),
    ...commandScenarios.map((scenario) => result(scenario.id, 'command', { command: scenario.argv })),
    ...consumerScenarios.map((scenario) => result(scenario.id, scenario.hostOnly ? 'host' : 'consumer', { adapter: scenario.adapter })),
  ],
}
const save = () => writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
await save()
const referenceBytes = options.reference ? await readFile(resolve(options.reference)) : null
const reference = referenceBytes ? JSON.parse(referenceBytes) : null
if (reference && (reference.phase !== 'pre' || reference.schemaVersion !== 1 ||
  ['scenarios.mjs', 'run.mjs', 'server.mjs', 'evidence.schema.json', 'fixture/index.html',
    'fixture/fixture.mjs', 'fixture/react.mjs', 'fixture/vue.mjs']
    .some((path) => reference.provenance.inputHashes[path] !== inputHashes[path]) ||
  JSON.stringify(reference.policy) !== JSON.stringify(policy)))
  throw new Error('Reference requires identical version-1 frozen scenarios, harness, fixtures and comparison policy')
if (referenceBytes) index.provenance.referenceSha256 = hash(referenceBytes)
const artifact = async (row, role, extension, bytes) => {
  const path = join('artifacts', `${row.id.replaceAll('/', '--')}.${extension}`)
  await writeFile(join(options.out, path), bytes)
  row.artifacts.push({ role, path, sha256: hash(bytes) })
  return path
}
const importedEvidence = options.observed ? JSON.parse(await readFile(resolve(options.observed), 'utf8')) : []
for (const evidence of importedEvidence) {
  const row = index.results.find((item) => item.id === evidence.id && item.kind === 'command')
  if (!row || !Array.isArray(evidence.command) ||
    JSON.stringify(row.command.slice(1)) !== JSON.stringify(evidence.command.slice(-row.command.length + 1)) || !evidence.commit ||
    !Number.isInteger(evidence.exitCode) || !evidence.log || !evidence.startedAt)
    throw new Error(`Incomplete observed command evidence: ${evidence.id}`)
  row.observedProvenance = { commit: evidence.commit, startedAt: evidence.startedAt,
    cwd: evidence.cwd, versions: evidence.versions, source: evidence.source }
  row.exitCode = evidence.exitCode
  row.command = evidence.command
  row.status = evidence.exitCode === 0 ? 'passed' : 'failed'
  row.reason = `Imported observed command exit ${evidence.exitCode}; see original raw output`
  await artifact(row, 'command-log', 'command.log', await readFile(resolve(evidence.log)))
}
const hostEvidence = options.hostEvidence ? JSON.parse(await readFile(resolve(options.hostEvidence), 'utf8')) : []
for (const evidence of hostEvidence) {
  const row = index.results.find((item) => item.id === evidence.id && item.kind === 'host')
  if (!row || !['passed', 'failed', 'unsupported'].includes(evidence.status) || !evidence.reason ||
    !evidence.hostVersion || !evidence.startedAt || !evidence.commit || !evidence.steps ||
    !Array.isArray(evidence.artifacts) || !evidence.artifacts.some((item) => item.role === 'host-log') ||
    !evidence.artifacts.some((item) => item.role === 'host-image'))
    throw new Error(`Host evidence requires exact provenance, steps, raw log and screenshot: ${evidence.id}`)
  row.status = evidence.status
  row.reason = evidence.reason
  row.startedAt = evidence.startedAt
  row.observedProvenance = { hostVersion: evidence.hostVersion, commit: evidence.commit,
    steps: evidence.steps, remoteAssets: evidence.remoteAssets }
  for (let i = 0; i < evidence.artifacts.length; i++) {
    const item = evidence.artifacts[i]
    await artifact(row, item.role, `host-${i}.${item.role === 'host-image' ? 'png' : 'log'}`, await readFile(resolve(item.path)))
  }
}
const selectedCommands = options.commands === 'all' ? commandScenarios.map((item) => item.id)
  : (options.commands || '').split(',').filter(Boolean)
for (const id of selectedCommands)
  if (!commandScenarios.some((item) => item.id === id)) throw new Error(`Unknown command: ${id}`)
// Framer's clean dist output must precede the ordinary React package build.
const commandOrder = [...commandScenarios].sort((a, b) =>
  (a.id === 'build-framer-bundle' ? -1 : b.id === 'build-framer-bundle' ? 1 : 0))
for (const scenario of commandOrder.filter((item) => selectedCommands.includes(item.id))) {
  const row = index.results.find((item) => item.id === scenario.id)
  if (row.status !== 'unexercised') throw new Error(`Refusing to rerun imported command: ${row.id}`)
  row.startedAt = new Date().toISOString()
  const start = Date.now()
  const logPath = join('artifacts', `${row.id}.command.log`)
  const stream = createWriteStream(join(options.out, logPath), { flags: 'wx' })
  const child = spawn(scenario.argv[0], scenario.argv.slice(1), { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false })
  let spawnError
  const outcome = await new Promise((done) => {
    child.on('error', (error) => { spawnError = String(error); done({ code: null, signal: null }) })
    child.on('close', (code, signal) => done({ code, signal }))
  })
  await new Promise((done) => stream.end(done))
  row.exitCode = outcome.code; row.signal = outcome.signal; row.durationMs = Date.now() - start
  row.status = outcome.code === 0 ? 'passed' : 'failed'
  row.reason = spawnError || `Process exit ${outcome.code}, signal ${outcome.signal || 'none'}`
  row.artifacts.push({ role: 'command-log', path: logPath, sha256: hash(await readFile(join(options.out, logPath))) })
  await save()
}
const consumers = options.consumers ? JSON.parse(await readFile(resolve(options.consumers), 'utf8')) : {}
const launchArgs = options.launchArgs ? JSON.parse(options.launchArgs) : []
let browser
const servers = []
const selected = (id) => !options.only || new RegExp(options.only).test(id)
const syntheticHDR = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n'),
  Buffer.from([128,64,32,129,32,128,64,129,64,32,128,129,128,128,128,129]),
])
function inspectPixels(bytes) {
  const png = PNG.sync.read(bytes)
  const colors = new Set()
  for (let offset = 0; offset < png.data.length; offset += 400)
    colors.add(png.data.subarray(offset, offset + 3).toString('hex'))
  return { width: png.width, height: png.height, sampledColors: colors.size }
}
function comparePixels(before, after) {
  const a = PNG.sync.read(before), b = PNG.sync.read(after)
  if (a.width !== b.width || a.height !== b.height) return { comparable: true, passed: false, reason: 'Image dimensions changed' }
  let changed = 0, maximumChannelDelta = 0
  for (let offset = 0; offset < a.data.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a.data[offset + channel] - b.data[offset + channel])
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
      if (delta > policy.pixelComparison.channelThreshold) pixelChanged = true
    }
    if (pixelChanged) changed++
  }
  const changedFraction = changed / (a.width * a.height)
  return { comparable: true, passed: changedFraction <= policy.pixelComparison.maximumChangedFraction,
    changedFraction, maximumChannelDelta, ...policy.pixelComparison }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
function staticSemantics(snapshot, kind) {
  const latest = snapshot.latest
  return canonical({ uniforms: latest.uniforms, geometry: latest.geometry, material: latest.material,
    transform: latest.transform, camera: latest.camera, environment: latest.environment,
    exports: kind === 'exports' ? snapshot.exports : undefined,
    cameraPayload: kind === 'camera' ? snapshot.camera.at(-1)?.value : undefined })
}
async function compare(row, scenario, bytes) {
  if (!reference) return
  const previous = reference.results.find((item) => item.id === row.id)
  if (!previous || previous.status !== 'passed') {
    row.comparison = { comparable: false, reason: 'No successful pre reference; original failure/unexercised status remains in reference' }
    return
  }
  if (row.status !== 'passed') {
    row.comparison = { comparable: true, passed: false, reason: 'Successful pre case now fails' }
    return
  }
  const a = previous.observation?.latest?.renderer, b = row.observation?.latest?.renderer
  const sameEngine = JSON.stringify(reference.provenance.browser) === JSON.stringify(index.provenance.browser)
    && a?.revision === b?.revision && a?.device === b?.device && a?.backend === b?.backend
    && JSON.stringify(reference.provenance.adapters[row.adapter]?.packages) === JSON.stringify(index.provenance.adapters[row.adapter]?.packages)
  const staticFrame = ['visual', 'paused', 'seek', 'exports', 'hdr', 'camera'].includes(scenario.kind)
    && scenario.hdrMode !== 'live'
  if (!sameEngine || !staticFrame) {
    row.comparison = { comparable: false, reason: !sameEngine ? 'Engine/browser/dependency tuple differs; never compare cross-engine pixels'
      : 'Dynamic time/interaction/live-network capture; use recorded assertions and observations' }
    return
  }
  const image = previous.artifacts.find((item) => item.role === 'canvas')
  if (!image) throw new Error(`Successful reference lacks canvas: ${row.id}`)
  const original = await readFile(resolve(dirname(resolve(options.reference)), image.path))
  if (hash(original) !== image.sha256) throw new Error(`Reference artifact changed: ${image.path}`)
  row.comparison = comparePixels(original, bytes)
  row.comparison.semanticMatch = JSON.stringify(staticSemantics(previous.observation, scenario.kind))
    === JSON.stringify(staticSemantics(row.observation, scenario.kind))
  if (!row.comparison.semanticMatch) {
    row.comparison.passed = false
    row.comparison.reason = 'Static uniforms/topology/material/transform/camera/environment/public payload changed'
  }
  if (!row.comparison.passed) { row.status = 'failed'; row.reason = 'Post-extraction static semantics or pixels differ from frozen reference' }
}
async function runBrowserScenario(adapter, scenario, fixture) {
  const row = index.results.find((item) => item.id === `${adapter}/${scenario.id}`)
  row.startedAt = new Date().toISOString()
  row.url = `${fixture.url}?adapter=${adapter}`
  const start = Date.now()
  const context = await browser.newContext({ viewport: policy.viewport, deviceScaleFactor: 1,
    hasTouch: scenario.kind === 'touch', isMobile: scenario.kind === 'touch', reducedMotion: 'no-preference' })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const page = await context.newPage()
  page.setDefaultTimeout(policy.timeoutMs)
  const logs = { console: [], pageErrors: [], moduleFailures: [], requests: [], responses: [], requestFailures: [], actions: [] }
  let fixtureReady = false
  let rejectInitialization
  const initializationFailure = new Promise((_, reject) => { rejectInitialization = reject })
  const failInitialization = (message) => {
    if (!fixtureReady)
      rejectInitialization(Object.assign(new Error(message), { fixtureInfrastructure: true }))
  }
  page.on('console', (message) => logs.console.push({ type: message.type(), text: message.text() }))
  page.on('pageerror', (error) => {
    logs.pageErrors.push(String(error.stack || error))
    failInitialization(`Page error before fixture initialization: ${error.stack || error}`)
  })
  page.on('request', (request) => { if (/\.hdr(?:\?|$)/.test(request.url())) logs.requests.push(request.url()) })
  page.on('response', (response) => {
    if (/\.hdr(?:\?|$)/.test(response.url())) logs.responses.push({ url: response.url(), status: response.status() })
    if (!fixtureReady && response.status() >= 400 && response.request().resourceType() === 'script') {
      logs.moduleFailures.push({ url: response.url(), status: response.status() })
      failInitialization(`Fixture module load failed: HTTP ${response.status()} ${response.url()}`)
    }
  })
  page.on('requestfailed', (request) => logs.requestFailures.push({ url: request.url(), error: request.failure() }))
  if (scenario.hdrMode !== 'live') await page.route('**/*.hdr', (route) => route.fulfill(scenario.hdrMode === 'failure'
    ? { status: 404, body: 'Baseline intentional HDR 404' }
    : { status: 200, contentType: 'application/octet-stream', body: syntheticHDR }))
  let bytes
  try {
    await Promise.race([
      (async () => {
        await page.goto(row.url)
        await page.waitForFunction(() => Boolean(window.baselineFixture))
        fixtureReady = true
      })(),
      initializationFailure,
    ])
    await page.evaluate((value) => window.baselineFixture.configure(value), scenario)
    await page.waitForFunction(() => Boolean(window.baselineFixture.observations.latest))
    const canvas = page.locator('canvas').first()
    await canvas.waitFor({ state: 'visible' })
    await page.waitForTimeout(policy.settleMs)
    const snap = () => page.evaluate(() => window.baselineFixture.snapshot())
    const before = await snap()
    if (['mouse', 'touch'].includes(scenario.kind)) {
      const box = await canvas.boundingBox()
      if (!box) throw new Error('Canvas has no bounds')
      if (scenario.kind === 'mouse') {
        await page.mouse.move(box.x + 160, box.y + 120); await page.mouse.down()
        await page.mouse.move(box.x + 290, box.y + 175, { steps: 12 }); await page.mouse.up()
      } else {
        const session = await context.newCDPSession(page)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 160, y: box.y + 120 }] })
        for (let i = 1; i <= 12; i++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 160 + i * 10, y: box.y + 120 + i * 4 }] })
          await page.waitForTimeout(16)
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await session.detach()
      }
      logs.actions.push({ type: scenario.kind, start: [160, 120], end: [290, 175], steps: 12 })
    }
    if (scenario.kind === 'seek') await page.evaluate(() => window.baselineFixture.update({ uTime: -3 }))
    await page.waitForTimeout(policy.sampleMs)
    if (scenario.kind === 'resume') {
      await page.evaluate(() => window.baselineFixture.update({ animate: 'off' }))
      await page.waitForTimeout(100)
      row.pauseStart = await snap()
      await page.waitForTimeout(policy.sampleMs)
      row.pauseEnd = await snap()
      await page.evaluate(() => window.baselineFixture.update({ animate: 'on' }))
      await page.waitForTimeout(policy.sampleMs)
    }
    row.observation = await snap()
    row.observation.before = before
    bytes = await canvas.screenshot()
    row.observation.pixels = inspectPixels(bytes)
    await artifact(row, 'canvas', 'png', bytes)
    const failures = []
    if (row.observation.pixels.sampledColors <= policy.minimumSampledColors) failures.push('Canvas lacks >20 sampled RGB colors')
    if (logs.pageErrors.length || logs.console.some((item) => item.type === 'error') || row.observation.errors.length)
      failures.push('Browser/adapter errors recorded verbatim')
    if (scenario.kind === 'paused' && before.latest.uniforms.uTime !== row.observation.latest.uniforms.uTime)
      failures.push('Paused time advanced')
    if (scenario.kind === 'resume') {
      if (row.pauseStart.latest.uniforms.uTime !== row.pauseEnd.latest.uniforms.uTime) failures.push('Pause did not freeze time')
      if (row.observation.latest.uniforms.uTime === row.pauseEnd.latest.uniforms.uTime) failures.push('Resume did not advance time')
    }
    if (scenario.kind === 'seek' && row.observation.latest.uniforms.uTime !== -3) failures.push('Explicit negative paused seek not reflected')
    if (scenario.kind === 'time') {
      const values = row.observation.samples.filter((sample) => sample.at >= before.latest.time).map((sample) => sample.uTime)
      const low = scenario.props.loop === 'on' ? 0 : scenario.props.rangeStart
      const high = scenario.props.loop === 'on' ? scenario.props.loopDuration : scenario.props.rangeEnd
      if (values.length < 2 || values.some((value) => !Number.isFinite(value) || value < low || value >= high)) failures.push(`Time samples outside [${low}, ${high})`)
    }
    if (['mouse', 'touch'].includes(scenario.kind)) {
      if (row.observation.camera.length <= before.camera.length) failures.push('No new camera interaction payload')
      if (JSON.stringify(row.observation.latest.camera) === JSON.stringify(before.latest.camera)) failures.push('Camera pose did not change')
    }
    if (scenario.kind === 'camera' && !row.observation.camera.length) failures.push('No camera callback payload')
    if (scenario.kind === 'exports') {
      const required = adapter === 'react'
        ? ['ShaderGradient', 'ShaderGradientCanvas', 'presets', 'propertyControls', 'formatUrlString', 'formatFramerProps', 'mergeCanvasProps']
        : ['ShaderGradient', 'ShaderGradientCanvas', 'ShaderGradientSource', 'ShaderGradientView', 'presets']
      for (const name of required) if (!row.observation.exports.includes(name)) failures.push(`Missing public runtime export ${name}`)
    }
    if (scenario.kind === 'hdr' && scenario.hdrMode !== 'failure' && !row.observation.latest.environment)
      failures.push('No assigned scene environment after HDR load')
    if (scenario.kind === 'hdr' && !logs.requests.length) failures.push('No HDR request observed')
    row.status = failures.length ? 'failed' : 'passed'
    row.reason = failures.join('; ') || 'Actual adapter rendered; scenario assertions exercised; observed semantics retained'
    await compare(row, scenario, bytes)
  } catch (error) {
    row.status = 'failed'; row.reason = String(error.stack || error)
    if (error.fixtureInfrastructure)
      row.infrastructureFailure = { phase: 'fixture-initialization', reason: String(error.message) }
    if (!row.observation) row.observation = await page.evaluate(() => window.baselineFixture?.snapshot()).catch(() => undefined)
    await artifact(row, 'failure-page', 'failure.png', await page.screenshot()).catch(() => {})
    if (reference?.results.some((item) => item.id === row.id && item.status === 'passed'))
      row.comparison = { comparable: true, passed: false, reason: 'Successful pre case now fails' }
  } finally {
    row.durationMs = Date.now() - start
    await artifact(row, 'browser-log', 'browser.json', `${JSON.stringify(logs, null, 2)}\n`)
    const trace = join('artifacts', `${row.id.replaceAll('/', '--')}.trace.zip`)
    await context.tracing.stop({ path: join(options.out, trace) })
    row.artifacts.push({ role: 'trace', path: trace, sha256: hash(await readFile(join(options.out, trace))) })
    await context.close()
    await save()
  }
  return row
}
try {
  browser = await chromium.launch({ headless: true, args: launchArgs })
  const playwright = await packageInfo('@playwright/test', repository)
  index.provenance.browser = { name: 'chromium', version: browser.version(), playwright: playwright.version,
    executable: chromium.executablePath(), launchArgs, headless: true }
  for (const adapter of adapters.filter((name) => !options.adapter || options.adapter === name)) {
    const chosen = scenarios.filter((scenario) => selected(`${adapter}/${scenario.id}`))
    if (!chosen.length) continue
    let fixture
    try {
      fixture = await startFixture(adapter, options)
      servers.push(fixture.server)
      index.provenance.adapters[adapter] = { packages: fixture.packages, version: fixture.adapterVersion,
        entry: fixture.adapterEntry, entrySha256: hash(await readFile(fixture.adapterEntry)), dependencyRoot: fixture.dependencyRoot }
    } catch (error) {
      const first = index.results.find((item) => item.id === `${adapter}/${chosen[0].id}`)
      first.status = 'failed'; first.reason = `Fixture startup failed: ${error.stack || error}`
      first.infrastructureFailure = { phase: 'server-startup', reason: first.reason }
      for (const scenario of chosen.slice(1)) {
        const row = index.results.find((item) => item.id === `${adapter}/${scenario.id}`)
        row.blockedBy = first.id
        row.reason = `Unexercised: fixture startup failed in ${first.id}; see original failure evidence`
      }
      await save(); continue
    }
    for (const scenario of chosen) {
      const row = await runBrowserScenario(adapter, scenario, fixture)
      if (!row.infrastructureFailure) continue
      for (const pending of chosen.slice(chosen.indexOf(scenario) + 1)) {
        const blocked = index.results.find((item) => item.id === `${adapter}/${pending.id}`)
        blocked.blockedBy = row.id
        blocked.reason = `Unexercised: fixture initialization failed in ${row.id}; see its raw browser log and trace`
      }
      await save()
      break
    }
    await fixture.server.close()
    servers.splice(servers.indexOf(fixture.server), 1)
  }
  for (const scenario of consumerScenarios.filter((item) => selected(item.id))) {
    const row = index.results.find((item) => item.id === scenario.id)
    if (scenario.hostOnly) {
      if (row.status === 'unexercised') row.reason = 'Requires real authorized Framer/Figma host session; local plugin build is not host-runtime proof'
      continue
    }
    const consumer = consumers[scenario.id]
    if (!consumer) { row.reason = 'No externally served consumer URL supplied via --consumers'; continue }
    if (!consumer.url || !Array.isArray(consumer.command) || !consumer.command.length)
      throw new Error(`Consumer requires exact server command and URL: ${scenario.id}`)
    row.url = consumer.url; row.command = consumer.command
    row.startedAt = new Date().toISOString()
    const start = Date.now()
    const context = await browser.newContext({ viewport: policy.viewport, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.setDefaultTimeout(policy.timeoutMs)
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error.stack || error)))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      const root = resolve(repository, scenario.root)
      row.consumerProvenance = { root, packages: [] }
      for (const name of [scenario.adapter === 'react' ? 'react' : 'vue', 'three',
        scenario.adapter === 'react' ? '@react-three/fiber' : '@tresjs/core',
        scenario.adapter === 'react' ? '@shadergradient/react' : '@shadergradient/vue']) {
        const info = await packageInfo(name, root)
        row.consumerProvenance.packages.push({ name, version: info.version, entry: info.entry,
          entrySha256: hash(await readFile(info.entry)) })
      }
      for (const name of ['package.json', 'pnpm-lock.yaml', 'package-lock.json']) {
        try { row.consumerProvenance[name] = hash(await readFile(join(root, name))) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const response = await page.goto(consumer.url)
      row.httpStatus = response?.status()
      await page.locator('canvas').first().waitFor({ state: 'visible' })
      await page.waitForTimeout(policy.settleMs)
      const bytes = await page.locator('canvas').first().screenshot()
      const backend = await page.locator('canvas').first().evaluate((canvas) => {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
        if (!gl) return { backend: 'no-webgl-context' }
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        return { backend: gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
          device: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
          version: gl.getParameter(gl.VERSION) }
      })
      row.observation = { pixels: inspectPixels(bytes), title: await page.title(), finalURL: page.url(), backend }
      await artifact(row, 'consumer-canvas', 'png', bytes)
      if (scenario.navigation) {
        await page.locator('a[href="/away"]').first().click()
        await page.waitForURL(/\/away$/)
        if (await page.locator('canvas').count()) throw new Error('Canvas retained on away page')
        await page.locator('a[href="/"]').first().click()
        await page.locator('canvas').first().waitFor({ state: 'visible' })
        row.observation.navigation = 'away canvas removed; back canvas recreated'
      }
      if (errors.length) throw new Error('Consumer emitted browser errors')
      if (row.httpStatus >= 400) throw new Error(`Consumer HTTP ${row.httpStatus}`)
      if (row.observation.pixels.sampledColors <= policy.minimumSampledColors) throw new Error('Consumer canvas lacks >20 sampled RGB colors')
      row.status = 'passed'; row.reason = 'Real existing consumer rendered; not a claim of the isolated feature matrix in this host'
    } catch (error) { row.status = 'failed'; row.reason = String(error.stack || error) }
    finally {
      row.durationMs = Date.now() - start
      await artifact(row, 'consumer-log', 'browser.json', `${JSON.stringify({ errors, command: consumer.command, url: consumer.url }, null, 2)}\n`)
      await context.close(); await save()
    }
  }
  index.relationships = []
  for (const adapter of adapters) {
    for (const [left, right] of [['query-props', 'query-full'], ['grain-off', 'grain-on'],
      ['grain-blend-zero', 'grain-blend-one'], ['wireframe-off', 'wireframe-declared']]) {
      const a = index.results.find((row) => row.id === `${adapter}/${left}`)
      const b = index.results.find((row) => row.id === `${adapter}/${right}`)
      const imageA = a.artifacts.find((item) => item.role === 'canvas')
      const imageB = b.artifacts.find((item) => item.role === 'canvas')
      if (!imageA || !imageB) {
        index.relationships.push({ adapter, left, right, status: 'unexercised', reason: 'Both image captures required' })
        continue
      }
      const bytesA = await readFile(join(options.out, imageA.path))
      const bytesB = await readFile(join(options.out, imageB.path))
      index.relationships.push({ adapter, left, right, status: 'observed',
        byteIdentical: bytesA.equals(bytesB), pixels: comparePixels(bytesA, bytesB),
        reason: 'Characterization only: equal images may document a declared no-op; no cross-adapter expectation imposed' })
    }
  }
} catch (error) {
  index.infrastructureError = String(error.stack || error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await Promise.all(servers.map((server) => server.close()))
  await save()
}
const counts = Object.fromEntries(['passed', 'failed', 'unexercised', 'unsupported'].map((status) =>
  [status, index.results.filter((row) => row.status === status).length]))
console.log(JSON.stringify({ index: indexPath, counts, infrastructureError: index.infrastructureError || null }, null, 2))
if (counts.failed) process.exitCode = 1
