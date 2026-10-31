import { chromium } from '@playwright/test'
import { chromiumLaunchOptions } from '../browser/chromium.mjs'
import {
  captureAllocationWindow,
  createSourcePositionIndex,
} from './allocation-capture.mjs'
import { prepareAllocationMetadata } from './allocation-metadata.mjs'
import {
  assessAllocationSourceEvidence,
  assessAllocationSourceAdmission,
} from './allocation-source-evidence.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

// F27 is intentionally independent of preparation and of Playwright's test runner.
// Only public consumer APIs, public Three objects and passthrough browser probes
// are used. The parent owns servers and all other GPU work must be stopped.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 2) {
  if (
    ![
      '--native-url',
      '--vue-url',
      '--manifest',
      '--output-dir',
      '--cycles',
    ].includes(args[i]) ||
    !args[i + 1]
  )
    throw new Error(
      'Usage: node tests/svelte/performance.mjs --native-url URL --vue-url URL --manifest PATH --output-dir PATH --cycles 100'
    )
  if (options[args[i]]) throw new Error(`Duplicate argument ${args[i]}`)
  options[args[i]] = args[i + 1]
}
for (const key of [
  '--native-url',
  '--vue-url',
  '--manifest',
  '--output-dir',
  '--cycles',
])
  if (!options[key]) throw new Error(`Missing ${key}`)
if (Number(options['--cycles']) !== 100)
  throw new Error(
    'F27 requires exactly 100 measured complete cycles after warm-up'
  )
for (const key of ['--native-url', '--vue-url']) {
  const url = new URL(options[key])
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error(`Invalid ${key}`)
}
const outputRoot = resolve(options['--output-dir'])
await mkdir(outputRoot, { recursive: true })
if (Number((await statfs(outputRoot)).type) === 0x01021994)
  throw new Error('Evidence must reside on disk, not tmpfs')
const run = join(outputRoot, `native-performance-${Date.now()}-${randomUUID()}`)
let browser
let launchingBrowser
const contexts = new Set()
const activeHeapCaptures = new Set()
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  run,
  command: { ...options },
  status: 'running',
  measurementStatus: 'running',
  qualificationStatus: 'pending-allocation-review',
  allocationReview: {
    required: true,
    status: 'pending',
    basis:
      'Parent source adjudication against the frozen avoidable-hot-allocation rubric is required independently of sampled SDK byte count.',
    candidates: [],
  },
  checks: [],
  scenarios: [],
  profiles: [],
  heapSnapshots: [],
  heapReview: {
    required: true,
    status: 'pending-retainer-analysis',
    basis:
      'Heap snapshots require concrete retaining-path comparison; collection alone does not explain post-GC growth or establish a heap plateau.',
  },
  cycles: [],
  provenance: {},
  limits: [
    'No configured language server was available for this assignment.',
    'Chromium Poisson byte samples are not exact allocation counts; no samples is not proof of zero allocation.',
    'GL handles, renderer.info, disposal calls and JS heap are scoped observations, not driver/GPU leak absence.',
    'Controls and grain pass JS objects are not exposed by the public fixture; their constructor/dispose identities are unavailable. GL targets and DOM listener/observer lifetimes are observed separately.',
    'Three resources are first-use observations, not interception of every JS constructor. Transient constructor callsites are sampled by CDP.',
    'Independent example Canvas trees are explicitly unmounted through the fixture lifecycle API before measurement. Total native GPU/renderer memory still includes framework and diagnostic overhead and is not an interchangeable Vue metric.',
    'Environment textures may be owned by unexposed PMREM targets: Texture.dispose balance alone is not a live-resource count. Texture calls and GL lifetime evidence are reported separately.',
    'Once listeners whose callbacks are not exposed have unknown automatic-removal status, separate from explicit registration/removal balances.',
    'Fixture diagnostic frame subscriptions and wrappers are measured overhead, not an invented SDK subscription count. Independent example trees are removed before profiling.',
  ],
  cleanup: {},
}
let bytesWritten = 0
let filesWritten = 0
const browserLog = []
let browserLogBytes = 0
let browserLogDropped = 0
function diagnostic(consumer, type, text, location = null) {
  const line =
    JSON.stringify({
      at: new Date().toISOString(),
      consumer,
      type,
      text,
      location,
    }) + '\n'
  const bytes = Buffer.byteLength(line)
  if (browserLogBytes + bytes > 4 * 1024 * 1024) {
    browserLogDropped++
    return
  }
  browserLog.push(line)
  browserLogBytes += bytes
}
async function save(name, value) {
  const bytes =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (
    Buffer.byteLength(bytes) > 64 * 1024 * 1024 ||
    bytesWritten + Buffer.byteLength(bytes) > 256 * 1024 * 1024 ||
    filesWritten >= 80
  )
    throw new Error(
      'Evidence budget exceeded: 64MiB/file, 256MiB/run, 80 files'
    )
  await writeFile(join(run, name), bytes, { flag: 'wx' })
  bytesWritten += Buffer.byteLength(bytes)
  filesWritten++
  return name
}
async function bounded(action, milliseconds, label) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
let closing
async function cleanup() {
  if (closing) return closing
  closing = (async () => {
    report.cleanup.errors = []
    for (const stop of activeHeapCaptures) {
      try {
        await bounded(
          () => stop(new Error('Run cleanup interrupted heap capture')),
          5000,
          'close owned heap capture'
        )
      } catch (error) {
        report.cleanup.errors.push(String(error))
      }
    }
    for (const context of contexts) {
      try {
        await bounded(() => context.close(), 5000, 'close owned context')
      } catch (error) {
        report.cleanup.errors.push(String(error))
      }
    }
    contexts.clear()
    const server = await launchingBrowser?.catch(() => null)
    if (server) {
      const child = server.process()
      report.cleanup.pid = child.pid
      try {
        await bounded(() => server.close(), 5000, 'close owned Chromium')
      } catch (error) {
        report.cleanup.forced = true
        report.cleanup.gracefulError = String(error)
        try {
          await bounded(() => server.kill(), 5000, 'kill owned Chromium')
        } catch (killError) {
          report.cleanup.errors.push(String(killError))
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL')
          await bounded(
            () =>
              new Promise((accept) => {
                if (child.exitCode !== null || child.signalCode !== null)
                  accept()
                else child.once('exit', accept)
              }),
            3000,
            'reap exact owned Chromium'
          ).catch((reapError) => report.cleanup.errors.push(String(reapError)))
        }
      }
      report.cleanup.exitCode = child.exitCode
      report.cleanup.signalCode = child.signalCode
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.unref()
    }
    report.cleanup.browserClosed = !browser?.isConnected()
  })()
  return closing
}
// Cleanup is installed before acquiring the directory/browser/profile resources.
const signalHandlers = new Map()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  const handler = () => {
    report.interruption = signal
    void cleanup().finally(() => {
      process.exitCode = 1
    })
  }
  signalHandlers.set(signal, handler)
  process.once(signal, handler)
}
const deadline = setTimeout(() => {
  report.interruption = '20-minute characterization deadline'
  void cleanup().finally(() => {
    process.exitCode = 1
  })
}, 20 * 60 * 1000)
deadline.unref()
function check(name, pass, observed, owner) {
  report.checks.push({
    name,
    pass: !!pass,
    observed,
    ...(owner ? { owner } : {}),
  })
}
const workload = {
  control: 'props',
  urlString: '',
  shader: 'defaults',
  type: 'waterPlane',
  animate: 'on',
  grain: 'off',
  grainBlending: 0.5,
  lightType: '3d',
  envPreset: 'city',
  color1: '#94ffd1',
  color2: '#6bf5ff',
  color3: '#ffffff',
  brightness: 1.2,
  cAzimuthAngle: 170,
  cDistance: 4.4,
  cPolarAngle: 70,
  cameraZoom: 1,
  positionX: 0,
  positionY: 0.9,
  positionZ: -0.3,
  rotationX: 45,
  rotationY: 0,
  rotationZ: 0,
  reflection: 0.1,
  uAmplitude: 0,
  uDensity: 1.2,
  uFrequency: 0,
  uSpeed: 0.2,
  uStrength: 3.4,
  uTime: 0,
  wireframe: false,
  loop: 'off',
  range: 'disabled',
  enableTransition: false,
  zoomOut: false,
  toggleAxis: false,
  pixelDensity: 1,
  fov: 45,
}

function installProbe() {
  const ids = new WeakMap()
  let nextId = 0
  const identity = (object) => {
    if (!object || (typeof object !== 'object' && typeof object !== 'function'))
      return null
    let id = ids.get(object)
    if (id === undefined) {
      id = ++nextId
      ids.set(object, id)
    }
    return id
  }
  const resources = Object.create(null)
  const perContextResources = new Map()
  const resourceIds = new WeakMap()
  const contexts = [] // WeakRefs only: no old Three/GL object is retained by the probe.
  const glRecords = new WeakMap()
  const observerRecords = []
  const listenerRecords = []
  const listeners = new WeakMap()
  const threeRecords = []
  const threeIds = new WeakMap()
  let sampling = false
  let rasterRequested = false
  const drawTraceCapacity = 32768
  const drawTraceEpochs = new Float64Array(drawTraceCapacity)
  const drawTraceValues = new Uint32Array(drawTraceCapacity * 4)
  const drawTraceScopes = new Map()
  let drawTraceActive = false,
    drawTraceCount = 0,
    drawTraceOverflow = 0
  function scopeIdentity(value) {
    let id = drawTraceScopes.get(value)
    if (id === undefined) {
      id = drawTraceScopes.size + 1
      drawTraceScopes.set(value, id)
    }
    return id
  }
  const counters = {
    rafRequests: 0,
    rafCallbacks: 0,
    sceneRenders: 0,
    fullscreenRenders: 0,
  }
  const originalRAF = window.requestAnimationFrame
  window.requestAnimationFrame = function (callback) {
    counters.rafRequests++
    if (sampling) return originalRAF.call(window, callback)
    return originalRAF.call(window, function (time) {
      counters.rafCallbacks++
      callback(time)
    })
  }
  const scope = (canvas) =>
    canvas
      ?.closest?.(
        '[data-testid^="mirror-source"], [data-gradient-main], [data-testid="independent-a"], [data-testid="independent-b"], [data-testid="external-host"]'
      )
      ?.getAttribute('data-testid') ||
    (canvas?.closest?.('[data-gradient-main]') ? 'main' : 'other')
  function resource(kind, object, gl) {
    if (!object) return
    const record = {
      kind,
      id: identity(object),
      gl: identity(gl),
      scope: scope(gl.canvas),
      deletes: 0,
    }
    resourceIds.set(object, record)
    const totals = (resources[kind] ??= {
      created: 0,
      deleted: 0,
      live: 0,
      duplicateDeletes: 0,
    })
    totals.created++
    totals.live++
    let owned = perContextResources.get(record.gl)
    if (!owned) {
      owned = Object.create(null)
      perContextResources.set(record.gl, owned)
    }
    owned[kind] = (owned[kind] ?? 0) + 1
  }
  const originalContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function () {
    const result = Reflect.apply(originalContext, this, arguments)
    if (
      result &&
      /^(webgl2?|experimental-webgl)$/.test(arguments[0]) &&
      !glRecords.has(result)
    ) {
      const debug = result.getExtension('WEBGL_debug_renderer_info')
      const record = {
        id: identity(result),
        scope: scope(this),
        weak: new WeakRef(result),
        draws: 0,
        gradientDraws: 0,
        fullscreenDraws: 0,
        time: null,
        raster: null,
        backend: {
          version: result.getParameter(result.VERSION),
          vendor: result.getParameter(result.VENDOR),
          renderer: result.getParameter(result.RENDERER),
          unmaskedRenderer: debug
            ? result.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : null,
          unmaskedVendor: debug
            ? result.getParameter(debug.UNMASKED_VENDOR_WEBGL)
            : null,
        },
      }
      record.scopeId = scopeIdentity(record.scope)
      if (contexts.length >= 512)
        throw new Error('Probe context bound exceeded')
      contexts.push(record)
      glRecords.set(result, record)
    }
    if (result && this.isConnected && glRecords.has(result)) {
      const record = glRecords.get(result)
      record.scope = scope(this)
      record.scopeId = scopeIdentity(record.scope)
    }
    return result
  }
  for (const prototype of [
    WebGLRenderingContext.prototype,
    WebGL2RenderingContext.prototype,
  ]) {
    for (const kind of [
      'Buffer',
      'Texture',
      'Framebuffer',
      'Renderbuffer',
      'Program',
      'Shader',
      'VertexArray',
      'Sampler',
      'TransformFeedback',
      'Query',
    ]) {
      const create = prototype[`create${kind}`],
        remove = prototype[`delete${kind}`]
      if (typeof create !== 'function' || typeof remove !== 'function') continue
      prototype[`create${kind}`] = function () {
        const value = Reflect.apply(create, this, arguments)
        resource(kind, value, this)
        return value
      }
      prototype[`delete${kind}`] = function (value) {
        const record = value && resourceIds.get(value)
        if (record) {
          record.deletes++
          const totals = resources[kind]
          if (record.deletes === 1) {
            totals.deleted++
            totals.live--
            perContextResources.get(record.gl)[kind]--
          } else totals.duplicateDeletes++
        }
        return Reflect.apply(remove, this, arguments)
      }
    }
    const programs = new WeakMap()
    for (const [drawType, name] of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ].entries()) {
      const original = prototype[name]
      if (!original) continue
      prototype[name] = function () {
        const result = Reflect.apply(original, this, arguments)
        const record = glRecords.get(this)
        if (!record || this.isContextLost()) return result
        record.draws++
        const program = this.getParameter(this.CURRENT_PROGRAM)
        let entry = program && programs.get(program)
        if (program && !entry) {
          entry = { time: this.getUniformLocation(program, 'uTime') }
          programs.set(program, entry)
        }
        if (entry?.time) {
          record.gradientDraws++
          record.time = this.getUniform(program, entry.time)
        } else record.fullscreenDraws++
        if (drawTraceActive) {
          if (drawTraceCount < drawTraceCapacity) {
            const index = drawTraceCount++
            drawTraceEpochs[index] = Date.now()
            const offset = index * 4
            drawTraceValues[offset] = record.id
            drawTraceValues[offset + 1] = record.scopeId
            drawTraceValues[offset + 2] = drawType + 1
            drawTraceValues[offset + 3] = entry?.time ? 1 : 0
          } else drawTraceOverflow++
        }
        if (
          rasterRequested &&
          this.getParameter(this.FRAMEBUFFER_BINDING) === null
        ) {
          const pixel = new Uint8Array(4)
          const clear = this.getParameter(this.COLOR_CLEAR_VALUE)
          let hash = 2166136261,
            nonclear = 0
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              this.readPixels(
                Math.floor(((x + 0.5) * this.drawingBufferWidth) / 8),
                Math.floor(((y + 0.5) * this.drawingBufferHeight) / 8),
                1,
                1,
                this.RGBA,
                this.UNSIGNED_BYTE,
                pixel
              )
              let differs = false
              for (let c = 0; c < 4; c++) {
                hash = Math.imul(hash ^ pixel[c], 16777619) >>> 0
                if (pixel[c] !== Math.round(clear[c] * 255)) differs = true
              }
              if (differs) nonclear++
            }
          record.raster = {
            hash,
            nonclear,
            linked:
              !!program &&
              !!this.getProgramParameter(program, this.LINK_STATUS),
            width: this.drawingBufferWidth,
            height: this.drawingBufferHeight,
            draw: record.draws,
            error: this.getError(),
          }
        }
        return result
      }
    }
  }
  for (const name of [
    'IntersectionObserver',
    'ResizeObserver',
    'MutationObserver',
  ]) {
    const Original = window[name]
    if (!Original) continue
    window[name] = new Proxy(Original, {
      construct(target, args) {
        const observer = Reflect.construct(target, args)
        const record = { kind: name, targets: new Set(), disconnects: 0 }
        observerRecords.push(record)
        if (observerRecords.length > 8192)
          throw new Error('Observer evidence bound exceeded')
        const observe = observer.observe,
          disconnect = observer.disconnect,
          unobserve = observer.unobserve
        observer.observe = function (element) {
          record.targets.add(identity(element))
          return Reflect.apply(observe, this, arguments)
        }
        if (unobserve)
          observer.unobserve = function (element) {
            record.targets.delete(identity(element))
            return Reflect.apply(unobserve, this, arguments)
          }
        observer.disconnect = function () {
          record.disconnects++
          record.targets.clear()
          return disconnect.call(this)
        }
        return observer
      },
    })
  }
  const add = EventTarget.prototype.addEventListener,
    remove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (type, callback, options) {
    if (callback) {
      let byType = listeners.get(this)
      if (!byType) {
        byType = new Map()
        listeners.set(this, byType)
      }
      const capture =
        typeof options === 'boolean' ? options : !!options?.capture
      const key = `${type}:${capture}`
      let byCallback = byType.get(key)
      if (!byCallback) {
        byCallback = new WeakMap()
        byType.set(key, byCallback)
      }
      let record = byCallback.get(callback)
      if (!record || !record.live) {
        record = {
          type,
          capture,
          target: identity(this),
          live: !options?.signal?.aborted,
          once: !!options?.once,
          targetKind: this.constructor?.name ?? null,
        }
        byCallback.set(callback, record)
        listenerRecords.push(record)
        if (listenerRecords.length > 32768)
          throw new Error('Listener metadata budget exceeded')
        if (options?.signal)
          add.call(
            options.signal,
            'abort',
            () => {
              record.live = false
            },
            { once: true }
          )
      }
    }
    return Reflect.apply(add, this, arguments)
  }
  EventTarget.prototype.removeEventListener = function (
    type,
    callback,
    options
  ) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture
    const record =
      callback && listeners.get(this)?.get(`${type}:${capture}`)?.get(callback)
    if (record) record.live = false
    return Reflect.apply(remove, this, arguments)
  }
  function observeThree(value, kind, owner) {
    if (!value || threeIds.has(value)) return
    if (threeRecords.length >= 8192)
      throw new Error('Three metadata budget exceeded')
    const record = {
      id: identity(value),
      uuid: value.uuid ?? null,
      kind,
      owner,
      disposals: 0,
      terminalDisposals: 0,
      resizeInvalidations: 0,
      resizeCalls: 0,
    }
    threeIds.set(value, record)
    threeRecords.push(record)
    let resizeDepth = 0
    if (kind === 'target' && typeof value.setSize === 'function') {
      const setSize = value.setSize
      value.setSize = function () {
        record.resizeCalls++
        resizeDepth++
        try {
          return Reflect.apply(setSize, this, arguments)
        } finally {
          resizeDepth--
        }
      }
    }
    const original = value.dispose
    if (typeof original === 'function')
      value.dispose = function () {
        record.disposals++
        if (kind === 'target' && resizeDepth > 0) record.resizeInvalidations++
        else record.terminalDisposals++
        return Reflect.apply(original, this, arguments)
      }
  }
  const attached = new WeakSet()
  function attach(channel = 'native') {
    const refs = window.gradientLifecycle?.refs()[channel]
    if (!refs) return false
    const { renderer, scene } = refs
    const scan = () => {
      scene.traverse((object) => {
        if (!object.isMesh) return
        const owner =
          object.name === 'shadergradient-mesh'
            ? channel === 'native'
              ? 'native'
              : 'external-native'
            : 'host'
        observeThree(object.geometry, 'geometry', owner)
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          observeThree(material, 'material', owner)
          for (const key of ['map', 'envMap', 'normalMap', 'roughnessMap'])
            if (material?.[key]) observeThree(material[key], 'texture', owner)
        }
      })
      observeThree(scene.environment, 'texture', channel)
    }
    scan()
    if (attached.has(renderer)) return true
    attached.add(renderer)
    observeThree(renderer, 'renderer', channel)
    const render = renderer.render,
      setTarget = renderer.setRenderTarget
    renderer.setRenderTarget = function (target) {
      if (target) {
        observeThree(target, 'target', channel)
        observeThree(target.texture, 'target-texture', channel)
        threeIds.get(target.texture).releasedWithTarget = identity(target)
      }
      return Reflect.apply(setTarget, this, arguments)
    }
    renderer.render = function (renderScene) {
      if (!sampling) scan()
      if (renderScene === scene) counters.sceneRenders++
      else counters.fullscreenRenders++
      return Reflect.apply(render, this, arguments)
    }
    return true
  }
  function identities(channel = 'native') {
    const refs = window.gradientLifecycle?.refs()[channel]
    if (!refs) return null
    const mesh = refs.scene.getObjectByName('shadergradient-mesh')
    const uniforms = mesh?.material?.userData
    const vectors = {}
    if (uniforms)
      for (const [key, uniform] of Object.entries(uniforms)) {
        if (uniform?.value && typeof uniform.value === 'object')
          vectors[key] = identity(uniform.value)
      }
    return {
      renderer: identity(refs.renderer),
      scene: identity(refs.scene),
      camera: identity(refs.camera()),
      geometry: identity(mesh?.geometry),
      material: identity(mesh?.material),
      uniforms: identity(uniforms),
      position: identity(mesh?.position),
      rotation: identity(mesh?.rotation),
      cameraPosition: identity(refs.camera().position),
      vectors,
    }
  }
  function snapshot() {
    const effectiveResources = JSON.parse(JSON.stringify(resources))
    for (const value of Object.values(effectiveResources)) {
      value.undeletedHandles = value.live
      value.live = 0
      value.contextLostHandles = 0
      value.collectedContextHandles = 0
    }
    for (const record of contexts) {
      const gl = record.weak.deref()
      for (const [kind, count] of Object.entries(
        perContextResources.get(record.id) ?? {}
      )) {
        if (!gl) effectiveResources[kind].collectedContextHandles += count
        else if (gl.isContextLost())
          effectiveResources[kind].contextLostHandles += count
        else effectiveResources[kind].live += count
      }
    }
    return {
      counters: { ...counters },
      resources: effectiveResources,
      contexts: contexts.map((record) => {
        const gl = record.weak.deref()
        if (gl?.canvas.isConnected) {
          record.scope = scope(gl.canvas)
          record.scopeId = scopeIdentity(record.scope)
        }
        return {
          id: record.id,
          scope: record.scope,
          scopeId: record.scopeId,
          draws: record.draws,
          gradientDraws: record.gradientDraws,
          fullscreenDraws: record.fullscreenDraws,
          time: record.time,
          lost: gl ? gl.isContextLost() : null,
          collected: !gl,
          raster: record.raster,
          backend: record.backend,
        }
      }),
      observers: [
        'IntersectionObserver',
        'ResizeObserver',
        'MutationObserver',
      ].map((kind) => ({
        kind,
        created: observerRecords.filter((r) => r.kind === kind).length,
        activeTargets: observerRecords
          .filter((r) => r.kind === kind)
          .reduce((n, r) => n + r.targets.size, 0),
      })),
      listeners: {
        created: listenerRecords.length,
        activeExplicit: listenerRecords.filter((r) => r.live && !r.once).length,
        onceUnobservable: listenerRecords.filter((r) => r.live && r.once)
          .length,
      },
      three: threeRecords.map((record) => ({
        ...record,
        targetReleaseObserved: record.releasedWithTarget
          ? threeRecords.find(
              (target) => target.id === record.releasedWithTarget
            )?.terminalDisposals > 0
          : false,
      })),
      identities: identities(),
      rendererInfo: Object.fromEntries(
        ['native', 'host'].map((channel) => {
          const renderer = window.gradientLifecycle?.refs()[channel]?.renderer
          return [
            channel,
            renderer
              ? {
                  memory: { ...renderer.info.memory },
                  render: { ...renderer.info.render },
                  programs: renderer.info.programs?.length ?? null,
                }
              : null,
          ]
        })
      ),
    }
  }
  window.__nativePerformance = {
    snapshot,
    attach,
    identities,
    prepareDrawTrace() {
      drawTraceCount = 0
      drawTraceOverflow = 0
      drawTraceActive = true
    },
    drawTrace() {
      if (sampling)
        throw new Error('Draw trace may only be read after allocation capture')
      drawTraceActive = false
      return {
        capacity: drawTraceCapacity,
        count: drawTraceCount,
        overflow: drawTraceOverflow,
        epochMs: Array.from(drawTraceEpochs.subarray(0, drawTraceCount)),
        columns: ['contextId', 'scopeId', 'drawType', 'gradient'],
        values: Array.from(drawTraceValues.subarray(0, drawTraceCount * 4)),
        scopes: Array.from(drawTraceScopes, ([scope, id]) => ({ id, scope })),
        drawTypes: [
          'drawArrays',
          'drawElements',
          'drawArraysInstanced',
          'drawElementsInstanced',
        ],
        gradientBasis: 'current GL program has a uTime uniform',
      }
    },
    raster(value) {
      rasterRequested = value
    },
    sampling(value) {
      sampling = value
      if (!value) drawTraceActive = false
    },
  }
}

async function observationWindow(page, milliseconds = 400) {
  return page.evaluate(async (milliseconds) => {
    const snapshot = () => ({
      probe: window.__nativePerformance.snapshot(),
      canvasCount: document.querySelectorAll('canvas').length,
      fixture: window.gradientFixture?.snapshot?.() ?? {
        events: { ...window.gradientFixture?.events },
      },
    })
    const first = snapshot()
    const start = performance.now()
    // A bounded clock window measures work only; it never certifies rendered pixels.
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
    return { first, last: snapshot(), elapsedMs: performance.now() - start }
  }, milliseconds)
}
async function nativeCall(page, path, ...args) {
  return page.evaluate(
    async ({ path, args }) => {
      let target = window.gradientFixture
      for (const key of path.slice(0, -1)) target = target[key]
      return target[path.at(-1)](...args)
    },
    { path: path.split('.'), args }
  )
}
async function mirrorCall(page, method, ...args) {
  const observation = await nativeCall(page, `mirrors.${method}`, ...args)
  if (method === 'configureView') {
    const id = args[0]
    await page.evaluate(
      ({ id, visible }) => {
        const node = document.querySelector(`[data-testid="mirror-view-${id}"]`)
        // Reflect the actual public configuration in harness-owned placement.
        // IntersectionObserver must still observe the real offscreen element.
        node?.setAttribute('data-f27-visible', String(visible))
      },
      { id, visible: observation.views[id].config.visible }
    )
  }
  return observation
}
async function probe(page) {
  return page.evaluate(() => window.__nativePerformance.snapshot())
}
async function fixture(page) {
  return page.evaluate(() => window.gradientFixture.snapshot())
}
function drawDelta(window, scope) {
  const selected = (snapshot) =>
    snapshot.probe.contexts
      .filter((record) => record.scope === scope)
      .reduce((sum, record) => sum + record.draws, 0)
  return selected(window.last) - selected(window.first)
}
function assertUnrelatedIdle(window, name) {
  for (const scope of [
    'independent-a',
    'independent-b',
    'external-host',
    'mirror-source-independent',
  ]) {
    const delta = drawDelta(window, scope)
    check(
      `${name}: unrelated ${scope} settled`,
      delta === 0,
      delta,
      'F19 fixture isolation'
    )
    if (delta !== 0)
      throw new Error(
        `Cannot characterize matched output: unrelated ${scope} rendered ${delta} draws`
      )
  }
}
async function settle(page, milliseconds = 5000) {
  await page.waitForFunction(
    () => {
      const state = window.__nativePerformance.snapshot()
      const signature = state.contexts.reduce(
        (sum, item) => sum + item.draws,
        0
      )
      const previous = window.__performanceSettling
      const now = performance.now()
      if (!previous || previous.signature !== signature) {
        window.__performanceSettling = { signature, since: now }
        return false
      }
      return now - previous.since >= 200
    },
    undefined,
    { timeout: milliseconds, polling: 50 }
  )
}
async function idle(page, name) {
  await settle(page)
  const window = await observationWindow(page)
  report.scenarios.push({ name, ...window })
  assertUnrelatedIdle(window, name)
  check(
    `${name}: completed frames stop`,
    window.last.fixture.counters.completedFrames ===
      window.first.fixture.counters.completedFrames,
    [window.first.fixture.counters, window.last.fixture.counters],
    'F09/F14 scheduling'
  )
  check(
    `${name}: main draws stop`,
    drawDelta(window, 'main') === 0,
    drawDelta(window, 'main'),
    'F09/F14 scheduling'
  )
  check(
    `${name}: time stops`,
    window.first.fixture.scene?.meshes[0]?.time ===
      window.last.fixture.scene?.meshes[0]?.time,
    [
      window.first.fixture.scene?.meshes[0]?.time,
      window.last.fixture.scene?.meshes[0]?.time,
    ],
    'F09 time'
  )
  return window
}
async function redraw(page, name, operation) {
  await page.evaluate(() => window.__nativePerformance.raster(true))
  const before = await fixture(page)
  const beforeProbe = await probe(page)
  await operation()
  await page.waitForFunction(
    (frames) =>
      window.gradientFixture.snapshot().counters.completedFrames > frames,
    before.counters.completedFrames,
    { timeout: 15000 }
  )
  const after = await fixture(page)
  const afterProbe = await probe(page)
  await page.evaluate(() => window.__nativePerformance.raster(false))
  const latest = afterProbe.contexts.findLast(
    (entry) => entry.scope === 'main' && !entry.lost
  )
  const previous = beforeProbe.contexts.findLast(
    (entry) => entry.id === latest?.id
  )
  check(
    `${name}: actual completed nonclear screen draw`,
    !!latest?.raster &&
      latest.raster.linked &&
      latest.raster.draw > (previous?.draws ?? 0) &&
      latest.raster.nonclear > 0 &&
      latest.raster.error === 0,
    latest?.raster,
    'F09/F12/F13 explicit invalidation'
  )
  report.scenarios.push({
    name,
    before,
    after,
    raster: latest?.raster,
    beforeIdentities: beforeProbe.identities,
    afterIdentities: afterProbe.identities,
  })
  await idle(page, `${name} settled`)
  return { before, after, beforeProbe, afterProbe }
}

function profileComparison(label) {
  const paired = /^(native|vue)-grain-(off|on)$/.exec(label)
  return paired
    ? {
        scope: 'paired active allocation workload',
        pairId: `mint-480x320-dpr1-3d-grain-${paired[2]}`,
        consumer: paired[1],
        lightType: '3d',
        grain: paired[2],
      }
    : {
        scope: 'native-only characterization; no paired Vue allocation profile',
        consumer: 'native',
        lightType: 'env',
        grain: 'on',
        views: label.includes('mirrors') ? 3 : 1,
      }
}

async function allocationObservationSnapshot(page) {
  return page.evaluate(() => ({
    capturedAtEpochMs: Date.now(),
    probe: window.__nativePerformance.snapshot(),
    canvasCount: document.querySelectorAll('canvas').length,
    fixture: window.gradientFixture?.snapshot?.() ?? {
      events: { ...window.gradientFixture?.events },
    },
  }))
}

async function allocationMetadataSources(
  cdp,
  inventory,
  preparation,
  label,
  warmSources
) {
  const {
    lookup,
    capture,
    evidence,
    currentScripts,
    sessionKey,
    debuggerId,
    contextRevision,
    warmScripts,
    warmIdentities,
  } = warmSources
  if (
    inventory.capture !== lookup ||
    lookup.state !== capture ||
    capture.cdp !== cdp ||
    capture.closed ||
    capture.evidence !== evidence ||
    capture.currentScripts !== currentScripts
  )
    throw new Error(
      `${label}: metadata preparation lost its matching source session`
    )
  const bindings = preparation.metadata.resolvedScripts.map((frame) => {
    const script = warmScripts.get(frame.scriptId)
    const identity = warmIdentities.get(frame.scriptId)
    return {
      frame,
      script,
      metadata: identity?.metadata,
      metadataKey: identity?.metadataKey,
      context: identity?.context,
      knownSource: identity?.source,
      knownSourceIdentityJSON: identity?.sourceIdentityJSON,
      source: null,
      sourceIdentity: null,
      sourceIdentityJSON: null,
      error: null,
    }
  })
  // Await the source cache's real acquisitions, not a timer or a second warm
  // profile. All source RPCs here precede the actual allocation baseline.
  await Promise.all([...currentScripts.values()].map((script) => script.ready))
  const acquisition = await captureSampledScriptSources(
    cdp,
    preparation.profile,
    inventory,
    `${label}.metadata-preparation`,
    warmScripts
  )
  for (const binding of bindings) {
    const { frame, script, metadata, metadataKey, context } = binding
    const source = lookup.byId.get(frame.scriptId)
    if (
      !script ||
      currentScripts.get(frame.scriptId) !== script ||
      script.url !== frame.url ||
      script.metadata !== metadata ||
      metadata.key !== metadataKey ||
      metadata.sessionKey !== sessionKey ||
      metadata.context !== context ||
      context.retired ||
      context.metadataUnavailable ||
      source?.script !== script ||
      (binding.knownSource && binding.knownSource !== source) ||
      typeof script.scriptSource !== 'string' ||
      !script.sha256
    ) {
      binding.error = {
        reason:
          'No exact live source identity for the script/metadata/context references known at warm export.',
        warmMetadata: metadata ?? null,
        currentMetadata: currentScripts.get(frame.scriptId)?.metadata ?? null,
        acquisitionError:
          lookup.acquisitionErrors?.get(frame.scriptId) ??
          metadata?.sourceAcquisitionError ??
          null,
      }
      continue
    }
    binding.source = source
    binding.sourceIdentity = sampledScriptIdentity(capture, script)
    binding.sourceIdentityJSON = JSON.stringify(binding.sourceIdentity)
    if (
      JSON.stringify(source.sourceIdentity) !== binding.sourceIdentityJSON ||
      (binding.knownSourceIdentityJSON &&
        binding.knownSourceIdentityJSON !== binding.sourceIdentityJSON)
    )
      binding.error = {
        reason:
          'Warm captured-source identity differs from its live script or the source identity already known before warm-up.',
        sourceIdentity: source.sourceIdentity,
        liveIdentity: binding.sourceIdentity,
      }
  }
  const byScript = new Map(
    bindings.map((binding) => [
      JSON.stringify([binding.frame.scriptId, binding.frame.url]),
      binding,
    ])
  )
  return {
    acquisition,
    provenance: {
      sessionKey,
      debuggerId,
      contextRevision,
      bindings: bindings.map(({ frame, sourceIdentity, error }) => ({
        frame,
        sourceIdentity,
        error,
      })),
      basis:
        'Warm all-tree resolved script positions bound to the exact existing CDP source-cache, script, metadata and context references, plus captured source SHA-256. This is metadata preparation provenance, not allocation ownership.',
    },
    validate(profile) {
      const sessionUnchanged =
        inventory.capture === lookup &&
        lookup.state === capture &&
        capture.cdp === cdp &&
        capture.evidence === evidence &&
        capture.currentScripts === currentScripts &&
        !capture.closed &&
        !evidence.fatalError &&
        evidence.sessionKey === sessionKey &&
        evidence.debuggerId === debuggerId &&
        evidence.contextRevision === contextRevision
      const failures = []
      let actualScriptNodes = 0
      let coveredScriptNodes = 0
      function visit(node) {
        const frame = node.callFrame
        if (frame.scriptId && String(frame.scriptId) !== '0') {
          actualScriptNodes++
          const binding = byScript.get(
            JSON.stringify([frame.scriptId, frame.url])
          )
          const script = binding?.script
          const unchanged =
            sessionUnchanged &&
            binding &&
            !binding.error &&
            currentScripts.get(frame.scriptId) === script &&
            script.metadata === binding.metadata &&
            script.metadata.key === binding.metadataKey &&
            script.metadata.context === binding.context &&
            !binding.context.retired &&
            !binding.context.metadataUnavailable &&
            lookup.byId.get(frame.scriptId) === binding.source &&
            JSON.stringify(sampledScriptIdentity(capture, script)) ===
              binding.sourceIdentityJSON &&
            JSON.stringify(binding.source.sourceIdentity) ===
              binding.sourceIdentityJSON
          if (unchanged) coveredScriptNodes++
          else
            failures.push({
              nodeId: node.id,
              frame,
              reason:
                'Actual script lacks an unchanged exact source identity known at the fixed warm export.',
              warmSourceIdentity: binding?.sourceIdentity ?? null,
              warmBindingError: binding?.error ?? null,
              currentMetadata:
                currentScripts.get(frame.scriptId)?.metadata ?? null,
            })
        }
        for (const child of node.children ?? []) visit(child)
      }
      visit(profile.head)
      return {
        complete: sessionUnchanged && failures.length === 0,
        sessionUnchanged,
        sessionKey,
        debuggerId,
        warmContextRevision: contextRevision,
        actualContextRevision: evidence.contextRevision,
        actualScriptNodes,
        coveredScriptNodes,
        failures,
        scope:
          'Every nonzero actual all-tree script node must refer to a warmed script/URL with the same captured source identity. Script-zero frames are not attributed or exempted by this check.',
      }
    },
  }
}

async function allocationProfile(page, cdp, label, scope, inventory) {
  const comparison = profileComparison(label)
  const parameters = {
    samplingInterval: 16384,
    includeObjectsCollectedByMinorGC: true,
    includeObjectsCollectedByMajorGC: true,
  }
  const metadataPreparation = {
    status: 'preparing',
    requestedDurationMs: 1000,
    requestedParameters: {
      samplingInterval: 1,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    },
    purpose:
      'One fixed diagnostic metadata export and strong named-key retention before the steady-state measurement; not an SDK pass, startup measurement, or root attribution.',
    release: { status: 'not-acquired' },
  }
  const profileRecord = {
    label,
    comparison,
    scope,
    parameters,
    measurementPopulation:
      'Steady-state after one fixed 1000ms metadata-preparation capture; no startup or first-use performance claim.',
    metadataPreparation,
    status: 'preparing-metadata',
  }
  report.profiles.push(profileRecord)
  const controller = new AbortController()
  let preparationPromise
  let preparation
  let capturePromise
  let resourcesCleanup
  let probeCleanupAllowed = true
  const cleanupError = (phase, error) => {
    ;(profileRecord.cleanupErrors ??= []).push({
      phase,
      ...sourceAcquisitionError(error),
    })
    ;(report.cleanup.profileErrors ??= []).push(
      `${label}: ${phase}: ${String(error)}`
    )
  }
  const closeOwnedContext = async (reason) => {
    try {
      await bounded(
        () => page.context().close(),
        5000,
        'close owned allocation context'
      )
      metadataPreparation.contextClosure = {
        status: 'closed',
        atEpochMs: Date.now(),
        reason,
      }
    } catch (error) {
      cleanupError('close owned allocation context', error)
    }
  }
  const releaseResources = () => {
    resourcesCleanup ??= (async () => {
      let samplerStateUnknown = false
      // A preparation capture has a fixed one-second lifetime. Await its real
      // stop, and the actual helper's stop/abort cleanup, before any Runtime RPC.
      for (const pending of [preparationPromise, capturePromise]) {
        try {
          await pending
        } catch (error) {
          if (error instanceof AggregateError) {
            samplerStateUnknown = true
            probeCleanupAllowed = false
            cleanupError('capture sampler cleanup', error)
          }
        }
      }
      if (samplerStateUnknown) {
        let recovered
        try {
          recovered = await cdp.send('HeapProfiler.stopSampling')
          probeCleanupAllowed = true
        } catch (error) {
          cleanupError('recover owned allocation sampler', error)
          await closeOwnedContext('sampler stop could not be established')
          return
        }
        try {
          profileRecord.samplerCleanupRaw = await save(
            `${label}.sampler-cleanup.json`,
            {
              purpose:
                'Raw recovery-stop response after a failed capture; diagnostic only, not a complete actual measurement.',
              response: recovered,
            }
          )
        } catch (error) {
          cleanupError('save sampler recovery diagnostic', error)
        }
      }
      if (!preparation) return
      try {
        await preparation.release()
        metadataPreparation.release = {
          status: 'released',
          atEpochMs: Date.now(),
          phase: 'outside actual sampling, after sampler stop',
        }
      } catch (error) {
        metadataPreparation.status = 'invalid-retention-evidence'
        profileRecord.statusBeforeRetentionFailure = profileRecord.status
        profileRecord.status = 'rejected-metadata-retention-evidence'
        metadataPreparation.release = {
          status: 'failed',
          error: sourceAcquisitionError(error),
        }
        cleanupError('release retained metadata keys', error)
        await closeOwnedContext('retained-key release failed')
      }
    })()
    return resourcesCleanup
  }
  const cancelCapture = async (reason) => {
    controller.abort(reason)
    await releaseResources()
  }
  activeHeapCaptures.add(cancelCapture)
  try {
    const lookup = inventory.capture
    const sourceCapture = lookup?.state
    if (!sourceCapture || sourceCapture.cdp !== cdp || sourceCapture.closed)
      throw new Error(
        `${label}: metadata preparation requires the live inventory CDP session`
      )
    await Promise.all(
      [...sourceCapture.currentScripts.values()].map((script) => script.ready)
    )
    controller.signal.throwIfAborted()
    const sourceEvidence = sourceCapture.evidence
    const warmSources = {
      lookup,
      capture: sourceCapture,
      evidence: sourceEvidence,
      currentScripts: sourceCapture.currentScripts,
      sessionKey: sourceEvidence.sessionKey,
      debuggerId: sourceEvidence.debuggerId,
      contextRevision: sourceEvidence.contextRevision,
      warmScripts: new Map(sourceCapture.currentScripts),
      warmIdentities: new Map(
        [...sourceCapture.currentScripts].map(([scriptId, script]) => {
          const source = lookup.byId.get(scriptId)
          return [
            scriptId,
            {
              metadata: script.metadata,
              metadataKey: script.metadata.key,
              context: script.metadata.context,
              source,
              sourceIdentityJSON: source
                ? JSON.stringify(source.sourceIdentity)
                : null,
            },
          ]
        })
      ),
    }
    metadataPreparation.sourceSession = {
      sessionKey: warmSources.sessionKey,
      debuggerId: warmSources.debuggerId,
      contextRevision: warmSources.contextRevision,
    }
    metadataPreparation.startedAtEpochMs = Date.now()
    preparationPromise = prepareAllocationMetadata(cdp, { durationMs: 1000 })
    preparation = await preparationPromise
    metadataPreparation.finishedAtEpochMs = Date.now()
    metadataPreparation.elapsedMs =
      metadataPreparation.finishedAtEpochMs -
      metadataPreparation.startedAtEpochMs
    metadataPreparation.parameters = preparation.parameters
    metadataPreparation.timing = preparation.timing
    metadataPreparation.release.status = 'retained'
    const preparationDiagnostic = {
      purpose: metadataPreparation.purpose,
      sourceSession: metadataPreparation.sourceSession,
      startedAtEpochMs: metadataPreparation.startedAtEpochMs,
      finishedAtEpochMs: metadataPreparation.finishedAtEpochMs,
      elapsedMs: metadataPreparation.elapsedMs,
      profile: preparation.profile,
      timing: preparation.timing,
      parameters: preparation.parameters,
      metadata: preparation.metadata,
    }
    const preparationBytes = JSON.stringify(preparationDiagnostic, null, 2)
    metadataPreparation.raw = await save(
      `${label}.metadata-preparation.json`,
      preparationBytes
    )
    metadataPreparation.rawSHA256 = hash(preparationBytes)
    metadataPreparation.rawBytes = Buffer.byteLength(preparationBytes)
    controller.signal.throwIfAborted()
    const sourceBindingStartedAtEpochMs = Date.now()
    const metadataSources = await allocationMetadataSources(
      cdp,
      inventory,
      preparation,
      label,
      warmSources
    )
    metadataPreparation.sourceBindingElapsedMs =
      Date.now() - sourceBindingStartedAtEpochMs
    metadataPreparation.sourceAcquisition = metadataSources.acquisition
    metadataPreparation.sourceProvenance = metadataSources.provenance
    metadataPreparation.status = 'prepared-diagnostic-only'
    controller.signal.throwIfAborted()
    await page.evaluate(() => {
      window.__nativePerformance.raster(false)
      window.__nativePerformance.sampling(true)
      window.__nativePerformance.prepareDrawTrace()
    })
    await Promise.all(
      [...sourceCapture.currentScripts.values()].map((script) => script.ready)
    )
    const first = await allocationObservationSnapshot(page)
    const before = await cdp.send('Runtime.getHeapUsage')
    const sampledScripts = new Map(sourceCapture.currentScripts)
    const sourceBefore = {
      scriptEvents: sourceEvidence.scriptEvents,
      pending: sourceEvidence.pending,
      sourceRequests: sourceEvidence.sourceRequests,
      contextRevision: sourceEvidence.contextRevision,
    }
    if (sourceBefore.pending !== 0)
      throw new Error(
        `${label}: source capture is still active before sampling`
      )
    controller.signal.throwIfAborted()
    profileRecord.status = 'sampling-steady-state'
    let captured
    try {
      capturePromise = captureAllocationWindow(cdp, 1800, {
        ...parameters,
        signal: controller.signal,
      })
      captured = await capturePromise
    } catch (error) {
      if (error.samplingPhase !== 'start' || controller.signal.aborted)
        throw error
      Object.assign(profileRecord, {
        status: 'sampling-start-failed',
        error: String(error),
        cause: error.cause ? String(error.cause) : null,
        samplingPhase: error.samplingPhase,
      })
      check(
        `${label}: allocation sampling starts with requested parameters`,
        false,
        String(error),
        'F27 profiler capability'
      )
      return
    }
    const sourceAfter = {
      scriptEvents: sourceEvidence.scriptEvents,
      pending: sourceEvidence.pending,
      sourceRequests: sourceEvidence.sourceRequests,
      contextRevision: sourceEvidence.contextRevision,
    }
    const { profile, timing } = captured
    const raw = await save(`${label}.heapprofile.json`, profile)
    Object.assign(profileRecord, {
      supported: true,
      raw,
      timing,
      status: 'captured-awaiting-observation',
    })
    const metadataCoverage = preparation.validate(profile)
    const metadataSourceCoverage = metadataSources.validate(profile)
    profileRecord.metadataCoverage = metadataCoverage
    profileRecord.metadataSourceCoverage = metadataSourceCoverage
    const metadataComplete =
      metadataCoverage.complete && metadataSourceCoverage.complete
    check(
      `${label}: actual all-tree export metadata covered by fixed preparation`,
      metadataCoverage.complete,
      metadataCoverage,
      'F27 steady-state export metadata read-set coverage'
    )
    check(
      `${label}: warmed and actual script source identities unchanged`,
      metadataSourceCoverage.complete,
      metadataSourceCoverage,
      'F27 exact prepared-source provenance'
    )
    await page.evaluate(() => window.__nativePerformance.sampling(false))
    const trace = await page.evaluate(() =>
      window.__nativePerformance.drawTrace()
    )
    const last = await allocationObservationSnapshot(page)
    const after = await cdp.send('Runtime.getHeapUsage')
    const sampledSourceAcquisition = await captureSampledScriptSources(
      cdp,
      profile,
      inventory,
      label,
      sampledScripts
    )
    profileRecord.sampledSourceAcquisition = sampledSourceAcquisition
    const window = {
      first,
      last,
      elapsedMs: last.capturedAtEpochMs - first.capturedAtEpochMs,
      counterScope:
        'Broader before/after snapshot bracket; counter deltas are not exact sampled-window activity.',
    }
    const sourceActivity = {
      before: sourceBefore,
      after: sourceAfter,
      basis:
        'Host counters immediately before start request and after stop acknowledgement, excluding all preparatory and follow-up snapshot evaluations.',
    }
    const sourceQuiet =
      sourceBefore.pending === 0 &&
      sourceAfter.pending === 0 &&
      sourceBefore.scriptEvents === sourceAfter.scriptEvents &&
      sourceBefore.sourceRequests === sourceAfter.sourceRequests &&
      sourceBefore.contextRevision === sourceAfter.contextRevision
    check(
      `${label}: no source-capture protocol work during sampling`,
      sourceQuiet,
      sourceActivity,
      'F27 isolated allocation window'
    )
    const targetScope = label.includes('mirrors')
      ? 'mirror-source-main'
      : 'main'
    const isVue = label.startsWith('vue-')
    const targetContexts = window.first.probe.contexts.filter(
      (entry) =>
        !entry.lost &&
        !entry.collected &&
        (isVue || entry.scope === targetScope)
    )
    const targetIds = new Set(targetContexts.map((entry) => entry.id))
    const targetScopes = new Set(targetContexts.map((entry) => entry.scopeId))
    // Both processes use the same machine's epoch clock. Exclude an additional
    // 5ms at each boundary rather than count clock quantization as activity.
    const clockMarginMs = 5
    const strictStartEpochMs = timing.startAcknowledgedEpochMs + clockMarginMs
    const strictStopEpochMs = timing.stopRequestEpochMs - clockMarginMs
    const actualSamplingActivity = {
      scope: isVue ? 'paired Vue 3d single-context workload' : targetScope,
      contextIds: [...targetIds],
      scopeIds: [...targetScopes],
      clockMarginMs,
      strictStartEpochMs,
      strictStopEpochMs,
      draws: 0,
      gradientDraws: 0,
      fullscreenDraws: 0,
      drawTypeCounts: [0, 0, 0, 0],
      firstGradientDrawEpochMs: null,
      lastGradientDrawEpochMs: null,
      basis:
        'Actual passthrough GL draws with a uTime uniform, strictly inside start ACK + margin to stop REQUEST - margin; not RAF callbacks or broad snapshot deltas.',
    }
    for (let index = 0; index < trace.count; index++) {
      const epoch = trace.epochMs[index]
      const offset = index * 4
      if (
        epoch <= strictStartEpochMs ||
        epoch >= strictStopEpochMs ||
        !targetIds.has(trace.values[offset]) ||
        !targetScopes.has(trace.values[offset + 1])
      )
        continue
      actualSamplingActivity.draws++
      actualSamplingActivity.drawTypeCounts[trace.values[offset + 2] - 1]++
      if (trace.values[offset + 3] === 1) {
        actualSamplingActivity.gradientDraws++
        actualSamplingActivity.firstGradientDrawEpochMs ??= epoch
        actualSamplingActivity.lastGradientDrawEpochMs = epoch
      } else actualSamplingActivity.fullscreenDraws++
    }
    const drawTraceRaw = await save(`${label}.draw-trace.json`, trace)
    const activityValid =
      trace.overflow === 0 && actualSamplingActivity.gradientDraws > 0
    const drawTrace = {
      raw: drawTraceRaw,
      capacity: trace.capacity,
      count: trace.count,
      overflow: trace.overflow,
      scopes: trace.scopes,
      drawTypes: trace.drawTypes,
      gradientBasis: trace.gradientBasis,
    }
    Object.assign(profileRecord, {
      before,
      after,
      window,
      sourceActivity,
      drawTrace,
      actualSamplingActivity,
    })
    check(
      `${label}: bounded trace proves actual in-window gradient draws`,
      activityValid,
      { ...drawTrace, ...actualSamplingActivity },
      'F27 exact sampled-window GPU activity'
    )
    assertUnrelatedIdle(window, label)
    let pairedActivity = null
    if (label.startsWith('vue-')) {
      const first = window.first.probe.contexts.filter(
        (entry) => !entry.lost && !entry.collected
      )
      const last = window.last.probe.contexts.filter(
        (entry) => !entry.lost && !entry.collected
      )
      const firstDraws = first.reduce((sum, entry) => sum + entry.draws, 0)
      const lastDraws = last.reduce((sum, entry) => sum + entry.draws, 0)
      pairedActivity = {
        firstCanvasCount: window.first.canvasCount,
        lastCanvasCount: window.last.canvasCount,
        firstContextIds: first.map((entry) => entry.id),
        lastContextIds: last.map((entry) => entry.id),
        draws: lastDraws - firstDraws,
        uTimeStart: first[0]?.time ?? null,
        uTimeEnd: last[0]?.time ?? null,
        elapsedMs: window.elapsedMs,
        counterScope: window.counterScope,
        actualSamplingActivity,
      }
      check(
        `${label}: actual paired hot path sampled during rendering`,
        window.first.canvasCount === 1 &&
          window.last.canvasCount === 1 &&
          first.length === 1 &&
          last.length === 1 &&
          first[0].id === last[0].id &&
          pairedActivity.draws > 0 &&
          activityValid &&
          comparison.lightType === '3d',
        pairedActivity,
        'F27 paired Vue observation scope'
      )
    }
    profileRecord.pairedActivity = pairedActivity
    const sampleVectors = new Map()
    for (const [index, sample] of (profile.samples ?? []).entries()) {
      let vector = sampleVectors.get(sample.nodeId)
      if (!vector) {
        vector = { weightedBytes: 0, entries: [] }
        sampleVectors.set(sample.nodeId, vector)
      }
      vector.weightedBytes += sample.size
      vector.entries.push({ rawSampleIndex: index, sample })
    }
    const treeNodeIds = new Set()
    const duplicateTreeNodeIds = []
    const sites = []
    function walk(node, ancestors) {
      if (treeNodeIds.has(node.id)) duplicateTreeNodeIds.push(node.id)
      treeNodeIds.add(node.id)
      const frame = originalFrame(node.callFrame, inventory)
      const stack = [...ancestors, frame]
      const sampleVector = sampleVectors.get(node.id)
      if (node.selfSize || sampleVector) {
        const attribution = frameAttribution(frame)
        const category = attribution.category
        sites.push({
          bytes: node.selfSize,
          treeSelfSize: node.selfSize,
          sampleVector: sampleVector ?? null,
          nodeId: node.id,
          category,
          attribution,
          frame,
          stack,
          sdkAncestors: stack.filter(
            (entry) => frameAttribution(entry).category === 'SDK'
          ),
          sdkCaller:
            stack.findLast(
              (entry) => frameAttribution(entry).category === 'SDK'
            ) ?? null,
          servedScript: frame.sourceIdentity?.sha256 ?? null,
        })
      }
      for (const child of node.children ?? []) walk(child, stack)
    }
    walk(profile.head, [])
    const orphanSampleVectorNodeIds = []
    for (const [nodeId, sampleVector] of sampleVectors) {
      if (treeNodeIds.has(nodeId)) continue
      orphanSampleVectorNodeIds.push(nodeId)
      sites.push({
        bytes: null,
        treeSelfSize: null,
        sampleVector,
        nodeId,
        category: 'unresolved sample-vector orphan',
        attribution: {
          category: 'unresolved sample-vector orphan',
          basis:
            'Raw sample vector references a node absent from the raw tree.',
        },
        frame: null,
        stack: [],
        sdkAncestors: [],
        sdkCaller: null,
        servedScript: null,
      })
    }
    const sampleVectorCoverage = {
      rawEntries: profile.samples?.length ?? 0,
      representedEntries: sites.reduce(
        (sum, site) => sum + (site.sampleVector?.entries.length ?? 0),
        0
      ),
      referencedNodeIds: [...sampleVectors.keys()],
      zeroSelfSampleVectorNodeIds: sites
        .filter((site) => site.treeSelfSize === 0 && site.sampleVector)
        .map((site) => site.nodeId),
      orphanSampleVectorNodeIds,
      duplicateTreeNodeIds,
      weightedBytes: (profile.samples ?? []).reduce(
        (sum, sample) => sum + sample.size,
        0
      ),
      treeSelfBytes: sites.reduce(
        (sum, site) => sum + (site.treeSelfSize ?? 0),
        0
      ),
      basis:
        'Every raw sample-vector entry is retained with its index, independently of tree selfSize. Weighted vector bytes and tree self bytes are separate observations, not assumed equal.',
    }
    const coverageComplete =
      sampleVectorCoverage.rawEntries ===
        sampleVectorCoverage.representedEntries &&
      orphanSampleVectorNodeIds.length === 0 &&
      duplicateTreeNodeIds.length === 0
    check(
      `${label}: every raw sample-vector node has unambiguous tree coverage`,
      coverageComplete,
      sampleVectorCoverage,
      'F27 complete raw sample-vector review coverage'
    )
    sites.sort((a, b) => b.bytes - a.bytes)
    const sourceSites = await save(`${label}.callsites.json`, sites)
    const missingSampleSources = sites.filter((site) =>
      site.stack.some((frame) => frame.sourceCaptureError)
    )
    check(
      `${label}: sampled served-script identities available`,
      missingSampleSources.length === 0,
      missingSampleSources,
      'F27 exact sampled-source provenance'
    )
    const sdkSites = sites.filter((site) => site.category === 'SDK')
    const sdkAncestorSites = sites.filter(
      (site) => site.sdkAncestors.length > 0
    )
    const constructorCandidates = sites.filter((site) =>
      site.stack.some((frame) =>
        /Vector|Matrix|Color|Geometry|Material|Texture|RenderTarget|CameraControls/.test(
          frame.functionName
        )
      )
    )
    const unknownSites = sites.filter(
      (site) =>
        site.category === 'unattributed served bundle' ||
        site.category === 'unresolved sample-vector orphan' ||
        site.category === 'unattributed captured script' ||
        (!site.frame?.url &&
          !site.frame?.generated?.url &&
          !site.frame?.sourceProvenance?.harnessProbe)
    )
    const sourceCaptureState = inventory.capture.state
    const sampledSourceEvidence = assessAllocationSourceEvidence({
      profile,
      sites,
      sessionKey: sourceCaptureState.evidence.sessionKey,
      debuggerId: sourceCaptureState.evidence.debuggerId,
      closed: sourceCaptureState.closed,
      fatalError: sourceCaptureState.evidence.fatalError,
      sources: new Map(
        [...inventory.capture.byId].map(([scriptId, known]) => [
          scriptId,
          {
            script: known.script,
            currentScript: sourceCaptureState.currentScripts.get(scriptId),
            sourceIdentity: known.sourceIdentity,
          },
        ])
      ),
    })
    const sourceAdmission = assessAllocationSourceAdmission(
      sampledSourceEvidence,
      comparison.consumer
    )
    const sourceEvidenceBytes = JSON.stringify(sampledSourceEvidence, null, 2)
    const sampledSourceEvidenceRecord = {
      method: 'prospective-exact-sampled-source-caller-readiness',
      methodStatus: 'new prospective measurement candidate; not qualification',
      complete: sampledSourceEvidence.complete,
      qualificationStatus: sampledSourceEvidence.qualificationStatus,
      admission: sourceAdmission,
      raw: await save(`${label}.source-evidence.json`, sourceEvidenceBytes),
      rawSHA256: hash(sourceEvidenceBytes),
      rawBytes: Buffer.byteLength(sourceEvidenceBytes),
      scope: sampledSourceEvidence.scope,
      rawCoverage: sampledSourceEvidence.rawCoverage,
      failedSites: sampledSourceEvidence.sites
        .filter((site) => !site.readyForAdjudication)
        .map(({ nodeId, evidenceKind, reasons }) => ({
          nodeId,
          evidenceKind,
          reasons,
        })),
    }
    profileRecord.sampledSourceEvidence = sampledSourceEvidenceRecord
    check(
      `${label}: ${
        comparison.consumer === 'native'
          ? 'Sampled source/caller evidence available for native adjudication'
          : 'Descriptive comparison retained without a source-integrity failure'
      }`,
      sourceAdmission.admitted,
      sampledSourceEvidenceRecord,
      'F27 native owning-source readiness; legacy comparison permits only explicit absent-caller attribution limits, never measurement-integrity failures'
    )
    report.allocationReview.candidates.push({
      label,
      rawProfile: raw,
      callsites: sourceSites,
      consumer: comparison.consumer,
      reviewRole:
        comparison.consumer === 'native'
          ? 'native-qualification'
          : 'descriptive-comparison-no-ownership-certificate',
      sdkSampleNodeIds: sdkSites.map((site) => site.nodeId),
      sdkAncestorSampleNodeIds: sdkAncestorSites.map((site) => site.nodeId),
      constructorSampleNodeIds: constructorCandidates.map(
        (site) => site.nodeId
      ),
      unknownAttributionNodeIds: unknownSites.map((site) => site.nodeId),
      unknownAttributionBasis:
        'Includes unresolved vector orphans, unattributed captured/served scripts, and source-less frames including VM roots. A URL-less frame is excluded only when its exact captured location lies inside the verified current harness-probe text span; no VM-origin or necessary-allocation assumption is made.',
      sampleVectorCoverage,
      sampledSourceEvidence: sampledSourceEvidenceRecord,
      reviewStatus: 'pending',
    })
    Object.assign(profileRecord, {
      status:
        sourceQuiet &&
        activityValid &&
        coverageComplete &&
        metadataComplete &&
        sourceAdmission.admitted
          ? comparison.consumer === 'native'
            ? 'captured-pending-allocation-review'
            : sampledSourceEvidence.complete
            ? 'captured-descriptive-comparison'
            : 'captured-descriptive-attribution-incomplete'
          : 'rejected-allocation-window',
      sourceSites,
      sampledBytes: sampleVectorCoverage.treeSelfBytes,
      sampledBytesBasis:
        'Sum of tree selfSize; not the weighted sample-vector total.',
      sampleVectorWeightedBytes: sampleVectorCoverage.weightedBytes,
      sampleVectorCoverage,
      sdkSites,
      sdkAncestorSites,
      constructorCandidates,
      unknownSites,
      interpretation:
        'Steady-state Poisson sampled allocated bytes including collected objects, after the separately recorded fixed metadata-preparation cost; no startup claim. Native source readiness is distinct from mandatory owning-source adjudication. The legacy comparator offers descriptive totals, includes every unknown byte, and has no allocation-ownership/avoidability certificate; absent callers remain UNKNOWN. No direct-causal-caller, allocation-count, universal-zero, necessity, or root-exemption claim.',
    })
    if (label.startsWith('native-')) {
      const relevantGradientDraws = actualSamplingActivity.gradientDraws
      check(
        `${label}: actual hot path sampled during rendering`,
        activityValid && relevantGradientDraws > 0,
        actualSamplingActivity,
        'F27 observation scope'
      )
    }
    if (
      !sourceQuiet ||
      !activityValid ||
      !coverageComplete ||
      !metadataComplete ||
      !sourceAdmission.admitted
    )
      throw new Error(
        `${label}: allocation window rejected: ${
          !sourceQuiet
            ? 'source-capture activity crossed the sampling boundary'
            : !metadataComplete
            ? 'fixed preparation lacks complete unchanged actual metadata/source coverage'
            : !coverageComplete
            ? 'raw sample-vector nodes have unresolved or ambiguous tree coverage'
            : !sourceAdmission.admitted
            ? 'sampled source/caller evidence is invalid or insufficient for this declared measurement role'
            : trace.overflow
            ? 'bounded GPU draw trace overflowed'
            : 'no relevant gradient draw strictly inside the sampling interval'
        }`
      )
  } catch (error) {
    if (profileRecord.status !== 'rejected-allocation-window')
      profileRecord.status = profileRecord.raw
        ? 'allocation-processing-failed'
        : 'allocation-preparation-or-capture-failed'
    profileRecord.error = sourceAcquisitionError(error)
    if (metadataPreparation.status !== 'prepared-diagnostic-only') {
      metadataPreparation.status = 'failed'
      metadataPreparation.error = profileRecord.error
      metadataPreparation.samplingPhase = error.samplingPhase ?? null
      if (metadataPreparation.startedAtEpochMs !== undefined) {
        metadataPreparation.finishedAtEpochMs ??= Date.now()
        metadataPreparation.elapsedMs =
          metadataPreparation.finishedAtEpochMs -
          metadataPreparation.startedAtEpochMs
      }
    }
    if (error.metadataPreparation) {
      metadataPreparation.finishedAtEpochMs ??= Date.now()
      metadataPreparation.elapsedMs =
        metadataPreparation.finishedAtEpochMs -
        metadataPreparation.startedAtEpochMs
      metadataPreparation.parameters = error.metadataPreparation.parameters
      metadataPreparation.timing = error.metadataPreparation.timing
      try {
        const failureBytes = JSON.stringify(
          {
            purpose: metadataPreparation.purpose,
            sourceSession: metadataPreparation.sourceSession,
            startedAtEpochMs: metadataPreparation.startedAtEpochMs,
            finishedAtEpochMs: metadataPreparation.finishedAtEpochMs,
            elapsedMs: metadataPreparation.elapsedMs,
            error: profileRecord.error,
            ...error.metadataPreparation,
          },
          null,
          2
        )
        metadataPreparation.raw = await save(
          `${label}.metadata-preparation-failed.json`,
          failureBytes
        )
        metadataPreparation.rawSHA256 = hash(failureBytes)
        metadataPreparation.rawBytes = Buffer.byteLength(failureBytes)
      } catch (saveError) {
        cleanupError('save failed metadata preparation', saveError)
      }
    }
    throw error
  } finally {
    await releaseResources()
    activeHeapCaptures.delete(cancelCapture)
    if (probeCleanupAllowed && !page.isClosed())
      await page
        .evaluate(() => window.__nativePerformance.sampling(false))
        .catch((error) => cleanupError('disable allocation probe', error))
  }
}

// Decode standard source-map VLQ segments once, outside the measured hot window.
// Generated and original locations remain zero-based, matching CDP CallFrame.
function decodeMappings(map) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let source = 0,
    originalLine = 0,
    originalColumn = 0
  return map.mappings.split(';').map((line) => {
    let column = 0
    return line
      .split(',')
      .filter(Boolean)
      .map((segment) => {
        const values = []
        let value = 0,
          shift = 0
        for (const char of segment) {
          const digit = alphabet.indexOf(char)
          if (digit < 0) throw new Error('Invalid source-map VLQ')
          value += (digit & 31) * 2 ** shift
          if (digit & 32) shift += 5
          else {
            values.push(
              value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2)
            )
            value = 0
            shift = 0
          }
        }
        column += values[0]
        if (values.length < 4) return { column }
        source += values[1]
        originalLine += values[2]
        originalColumn += values[3]
        return { column, source, originalLine, originalColumn }
      })
  })
}
function frameAttribution(frame) {
  if (frame.sourceCaptureError)
    return {
      category: 'unattributed served bundle',
      basis:
        'required sampled script has no exact captured session/context/script/hash identity',
      sourceCaptureError: frame.sourceCaptureError,
    }
  if (frame.sourceProvenance?.harnessProbe)
    return {
      category: 'fixture/profiler or browser unattributed',
      basis:
        'Frame location is inside exact current installProbe text in the CDP-acquired script; actual script identity and source hash are retained.',
      harnessProbe: frame.sourceProvenance.harnessProbe,
    }
  const originalURL = frame.url ?? ''
  const generatedURL = frame.generated?.url ?? originalURL
  const membership = frame.sourceProvenance?.packageMatches ?? []
  if (membership.some((match) => match.artifact === 'native'))
    return {
      category: 'SDK',
      basis:
        'mapped source-content SHA-256 matches prepared native package bytes',
      membership,
    }
  const nativePath =
    /(?:\/packages\/shadergradient-svelte\/(?:src|dist)\/|\/(?:node_modules\/)?@shadergradient\/svelte\/|\/shadergradient-svelte\/(?:src|dist)\/)/
  const thirdPartyPath =
    /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:three|svelte|camera-controls|@threlte\/[^/]+)\//
  const optimizedDependency =
    /\/node_modules\/\.vite\/deps\/(?:three[._-]|svelte[._-]|@threlte_|camera-controls[._-])/
  if (nativePath.test(originalURL))
    return {
      category: 'SDK',
      basis: 'unambiguous normalized native package source path',
    }
  // A dependency allocation remains third-party even when a native caller is
  // above it, or a native-generated bundle contains its mapped source.
  if (thirdPartyPath.test(originalURL) || optimizedDependency.test(originalURL))
    return {
      category: 'ThirdParty',
      basis: 'unambiguous dependency source or optimized dependency path',
    }
  if (nativePath.test(generatedURL))
    return {
      category: 'SDK',
      basis: 'unambiguous actual generated native package script path',
    }
  const fixturePath =
    /\/src\/(?:lib\/)?(?:fixture\.ts|SceneProbe\.svelte|App\.svelte)(?:[?#]|$)|\/src\/routes\/\+page\.svelte(?:[?#]|$)|\/tests\/svelte\/performance\.mjs(?:[?#]|$)/
  if (fixturePath.test(originalURL) || fixturePath.test(generatedURL))
    return {
      category: 'fixture/profiler or browser unattributed',
      basis: 'known actual consumer fixture/generated script path',
    }
  if (
    thirdPartyPath.test(generatedURL) ||
    optimizedDependency.test(generatedURL)
  )
    return {
      category: 'ThirdParty',
      basis: 'unambiguous generated dependency script path',
    }
  if (!originalURL) {
    if (frame.sourceIdentity)
      return {
        category: 'unattributed captured script',
        basis:
          'Exact URL-less script source is captured, but no verified owning-source or exact harness-span attribution is available.',
      }
    return {
      category: 'fixture/profiler or browser unattributed',
      basis:
        'CDP supplies no script URL; raw stack retained, not an SDK-zero proof',
    }
  }
  return {
    category: 'unattributed served bundle',
    basis:
      'no verified native membership or unambiguous fixture/dependency path',
  }
}
function originalFrame(frame, inventory) {
  if (!frame.scriptId || String(frame.scriptId) === '0') return frame
  const capture = inventory.capture
  const known = capture?.byId.get(frame.scriptId)
  const current = capture?.state.currentScripts.get(frame.scriptId)
  if (
    !known ||
    current !== known.script ||
    known.script.url !== (frame.url ?? '') ||
    known.script.metadata.context.retired ||
    known.script.metadata.context.metadataUnavailable ||
    capture.state.closed ||
    capture.state.evidence.fatalError
  ) {
    return {
      ...frame,
      sourceCaptureError: {
        reason:
          'No exact captured source for sampled script identity, or its session/script identity changed',
        sessionKey: capture?.state.evidence.sessionKey ?? null,
        scriptId: frame.scriptId,
        url: frame.url,
        actualMetadata: current?.metadata ?? null,
        acquisitionError:
          capture?.acquisitionErrors?.get(frame.scriptId) ??
          current?.metadata.sourceAcquisitionError ??
          null,
      },
    }
  }
  const identified = { ...frame, sourceIdentity: known.sourceIdentity }
  const probe = known.script.harnessProbeSpan
  if (probe) {
    const offset = known.script.sourcePositions.offsetAt(
      frame.lineNumber,
      frame.columnNumber,
      known.script.metadata.startLine,
      known.script.metadata.startColumn
    )
    if (
      offset !== null &&
      offset >= probe.startOffset &&
      offset < probe.endOffset
    )
      identified.sourceProvenance = {
        harnessProbe: { ...probe, frameOffset: offset },
      }
  }
  const entry = known.mapping
  if (!entry) return identified
  const segment = entry.lines[frame.lineNumber]?.findLast(
    (part) => part.column <= frame.columnNumber
  )
  if (segment?.source === undefined) return identified
  const source = entry.sources[segment.source]
  return {
    ...identified,
    generated: {
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    },
    url: source.normalizedURL ?? source.originalSource,
    sourceProvenance: source,
    lineNumber: segment.originalLine,
    columnNumber: segment.originalColumn,
  }
}

function sampledScriptIdentity(capture, script) {
  return {
    sessionKey: capture.evidence.sessionKey,
    debuggerId: capture.evidence.debuggerId,
    scriptId: script.scriptId,
    url: script.url,
    executionContextId: script.metadata.executionContextId,
    executionContextUniqueId: script.metadata.context.uniqueId,
    contextKey: script.metadata.context.key,
    contextEpoch: script.metadata.context.epoch,
    protocolHash: script.metadata.protocolHash,
    sha256: script.sha256,
    capturedAt: script.metadata.sourceCapturedAt,
    sourceEvidence: script.metadata.sourceEvidence ?? null,
  }
}

function sourceAcquisitionError(error) {
  return {
    name: error?.name ?? typeof error,
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    cause: error?.cause === undefined ? null : String(error.cause),
    errors:
      error instanceof AggregateError
        ? error.errors.map(sourceAcquisitionError)
        : undefined,
  }
}

async function captureSampledScriptSources(
  cdp,
  profile,
  inventory,
  label,
  sampledScripts
) {
  const lookup = inventory.capture
  const capture = lookup.state
  if (capture.cdp !== cdp || capture.closed)
    throw new Error(
      `${label}: sampled source acquisition has no live matching session`
    )
  const scriptIds = new Set()
  function collect(node) {
    const id = String(node.callFrame.scriptId ?? '0')
    if (id !== '0') scriptIds.add(id)
    for (const child of node.children ?? []) collect(child)
  }
  collect(profile.head)
  lookup.acquisitionErrors ??= new Map()
  const requested = []
  const acquiredSources = []
  const evidenceFile = `${label}.sampled-sources.json`
  const probeSource = installProbe.toString()
  for (const scriptId of scriptIds) {
    const expected = sampledScripts.get(scriptId)
    const current = capture.currentScripts.get(scriptId)
    let error = null
    if (
      !expected ||
      expected !== current ||
      expected.metadata.context.retired ||
      expected.metadata.context.metadataUnavailable
    ) {
      error = {
        name: 'SampledScriptIdentityError',
        message:
          'No unchanged pre-start session/context/script identity is available for this raw sampled script ID.',
        expectedMetadata: expected?.metadata ?? null,
        currentMetadata: current?.metadata ?? null,
      }
    } else {
      const known = lookup.byId.get(scriptId)
      if (known?.script === expected) {
        requested.push({
          scriptId,
          status: 'already-captured',
          sourceIdentity: known.sourceIdentity,
        })
        continue
      }
      await capture.acquireSampledSource(expected)
      if (
        capture.closed ||
        capture.currentScripts.get(scriptId) !== expected ||
        expected.metadata.context.retired ||
        typeof expected.scriptSource !== 'string'
      ) {
        error = expected.metadata.sourceAcquisitionError ?? {
          name: 'SampledScriptSourceUnavailable',
          message:
            'Exact sampled script source is unavailable or its context retired.',
          captureMetadata: expected.metadata,
        }
      } else {
        const source = expected.scriptSource
        const startOffset = source.indexOf(probeSource)
        if (
          startOffset >= 0 &&
          source.indexOf(probeSource, startOffset + 1) < 0
        ) {
          expected.harnessProbeSpan = {
            startOffset,
            endOffset: startOffset + probeSource.length,
            functionTextSHA256: hash(probeSource),
            basis:
              'Unique exact installProbe function-text span in actual CDP source.',
          }
          expected.sourcePositions = createSourcePositionIndex(source)
        }
        expected.metadata.sourceEvidence = evidenceFile
        const sourceIdentity = sampledScriptIdentity(capture, expected)
        lookup.byId.set(scriptId, {
          script: expected,
          mapping: null,
          sourceIdentity,
        })
        requested.push({
          scriptId,
          status: 'captured-after-stop',
          sourceIdentity,
        })
        acquiredSources.push({
          sourceIdentity,
          captureMetadata: expected.metadata,
          harnessProbeSpan: expected.harnessProbeSpan ?? null,
          scriptSource: source,
        })
        continue
      }
    }
    lookup.byId.delete(scriptId)
    lookup.acquisitionErrors.set(scriptId, error)
    requested.push({ scriptId, status: 'source-acquisition-failed', error })
  }
  await save(evidenceFile, {
    sessionKey: capture.evidence.sessionKey,
    debuggerId: capture.evidence.debuggerId,
    phase: 'after HeapProfiler.stopSampling acknowledgement',
    requested,
    acquiredSources,
  })
  return {
    raw: evidenceFile,
    requestedScriptIds: [...scriptIds],
    failedScriptIds: requested
      .filter((entry) => entry.status === 'source-acquisition-failed')
      .map((entry) => entry.scriptId),
  }
}
async function scriptInventory(cdp, scripts, label, manifest) {
  const inventory = [],
    sourceEvidence = []
  const capture = scripts.capture
  if (!capture || capture.cdp !== cdp || capture.closed)
    throw new Error(
      `${label} inventory has no matching live consumer CDP source cache`
    )
  const revision = capture.evidence.contextRevision
  const entries = [...scripts.values()]
  await Promise.all(entries.map((entry) => entry.ready))
  if (capture.evidence.fatalError) throw new Error(capture.evidence.fatalError)
  if (capture.evidence.contextRevision !== revision)
    throw new Error(
      `${label} execution context changed while preparing source inventory`
    )
  const byId = new Map(),
    retiredGaps = []
  capture.lookups.add(byId)
  Object.defineProperty(inventory, 'capture', {
    value: { state: capture, byId },
  })
  const consumer = manifest.consumers.find(
    (entry) =>
      new URL(entry.baseURL).origin === new URL(options['--native-url']).origin
  )
  const preparedFiles = consumer?.artifacts?.production?.files ?? []
  for (const script of entries) {
    if (
      typeof script.scriptSource !== 'string' ||
      script.metadata.status !== 'captured'
    ) {
      if (script.metadata.context.retired) {
        retiredGaps.push(script.metadata)
        continue
      }
      throw new Error(
        `${label} required source was not captured: ${JSON.stringify(
          script.metadata
        )}`
      )
    }
    const { scriptSource, sha256, map, mapError, mapURL } = script
    script.metadata.sourceEvidence ??= `${label}.sources.json`
    const sourceIdentity = sampledScriptIdentity(capture, script)
    const packageSourceMatches = []
    const sourceContentHashes = []
    if (map?.sourcesContent)
      for (let i = 0; i < map.sources.length; i++) {
        if (typeof map.sourcesContent[i] !== 'string') continue
        const sourceHash = hash(map.sourcesContent[i])
        sourceContentHashes[i] = sourceHash
        for (const [kind, pkg] of Object.entries(manifest.packages))
          for (const file of pkg.files)
            if (file.sha256 === sourceHash)
              packageSourceMatches.push({
                source: map.sources[i],
                sourceIndex: i,
                package: pkg.name,
                artifact: kind,
                path: file.path,
                sha256: sourceHash,
              })
      }
    const resolvedMapURL = mapURL
      ? mapURL.startsWith('data:')
        ? script.url
        : new URL(mapURL, script.url).href
      : null
    const parsedMapSHA256 = map ? hash(JSON.stringify(map)) : null
    const mapURLSHA256 = mapURL ? hash(mapURL) : null
    const sourceDescriptors = map
      ? map.sources.map((source, sourceIndex) => {
          let normalizedURL = null,
            normalizationError = null
          try {
            const sourceRootURL = map.sourceRoot
              ? new URL(
                  map.sourceRoot.endsWith('/')
                    ? map.sourceRoot
                    : `${map.sourceRoot}/`,
                  resolvedMapURL
                ).href
              : resolvedMapURL
            normalizedURL = new URL(source, sourceRootURL).href
          } catch (error) {
            normalizationError = String(error)
          }
          return {
            sourceIndex,
            originalSource: source,
            sourceRoot: map.sourceRoot ?? null,
            normalizedURL,
            normalizationError,
            generatedScriptURL: script.url,
            generatedScriptSHA256: sha256,
            mapURL: mapURL?.startsWith('data:')
              ? 'inline:data-url (raw in served script evidence)'
              : mapURL ?? null,
            mapURLSHA256,
            resolvedMapURL,
            parsedMapSHA256,
            sourceContentSHA256: sourceContentHashes[sourceIndex] ?? null,
            packageMatches: packageSourceMatches.filter(
              (match) => match.sourceIndex === sourceIndex
            ),
          }
        })
      : []
    const mapping = map
      ? { lines: decodeMappings(map), sources: sourceDescriptors }
      : null
    if (capture.currentScripts.get(script.scriptId) === script)
      byId.set(script.scriptId, { script, mapping, sourceIdentity })
    sourceEvidence.push({
      url: script.url,
      sourceIdentity,
      captureMetadata: script.metadata,
      harnessProbeSpan: script.harnessProbeSpan ?? null,
      scriptSource,
      map,
      mapError,
      sourceDescriptors,
    })
    inventory.push({
      url: script.url,
      scriptId: script.scriptId,
      sourceIdentity,
      captureMetadata: script.metadata,
      sha256,
      bytes: Buffer.byteLength(scriptSource),
      sourceMapURL: mapURL || null,
      mapError,
      packageSourceMatches,
      sourceDescriptors,
      preparedByteMatches: preparedFiles
        .filter((file) => file.sha256 === sha256)
        .map((file) => file.path),
    })
  }
  if (capture.evidence.contextRevision !== revision)
    throw new Error(
      `${label} execution context changed during source inventory`
    )
  capture.evidence.inventories ??= []
  capture.evidence.inventories.push({
    label,
    contextRevision: revision,
    capturedSources: inventory.length,
    retiredUncapturedGaps: retiredGaps,
  })
  await save(`${label}.served-scripts.json`, inventory)
  await save(`${label}.sources.json`, sourceEvidence)
  return inventory
}

const realHDRAssets = new Map()
async function realHDRAsset(name) {
  let asset = realHDRAssets.get(name)
  if (!asset) {
    const path = join(root, 'packages/ui/assets/hdr', `${name}.hdr`)
    const bytes = await readFile(path)
    if (bytes.length > 8 * 1024 * 1024)
      throw new Error(`Real HDR asset exceeds 8MiB budget: ${path}`)
    asset = { path, bytes, sha256: hash(bytes) }
    realHDRAssets.set(name, asset)
  }
  return asset
}

async function captureConsumerSources(cdp, page, label) {
  const scripts = new Map()
  const activeContexts = new Map()
  const currentScripts = new Map()
  const requests = new Set()
  const lookups = new Set()
  const sessionKey = randomUUID()
  const limit = 64 * 1024 * 1024
  const evidence = {
    sessionKey,
    debuggerId: null,
    status: 'capturing',
    limits: {
      scripts: 1024,
      scriptMetadata: 16384,
      cachedUTF8Bytes: limit,
      metadataBytes: limit,
      pending: 64,
      lifecycleEvents: 4096,
      debuggerCollectedScriptBytes: limit,
    },
    cachedUTF8Bytes: 0,
    metadataBytes: 0,
    pending: 0,
    pendingPeak: 0,
    scriptEvents: 0,
    sourceRequests: 0,
    metadataScriptCount: 0,
    epoch: 0,
    contextRevision: 0,
    entries: [],
    lifecycle: [],
    perturbation:
      'HTTP source/map capture is eager during loading. Other script IDs retain bounded identity metadata only; referenced missing sources are acquired after sampling stops. Debugger collected-script cache is bounded. No page pause, replacement source, or browser-object handles are used.',
    primaryProtocol:
      'https://chromedevtools.github.io/devtools-protocol/tot/Debugger/',
  }
  report.provenance[`${label}SourceCapture`] = evidence
  let closed = false,
    contextSequence = 0
  function fatal(error) {
    if (!evidence.fatalError)
      check(
        `${label}: bounded source capture`,
        false,
        String(error),
        'F27 source provenance bounds'
      )
    report.measurementStatus = 'error'
    evidence.fatalError ??= String(error)
    evidence.status = 'error'
  }
  function reserve(bytes, metadata = false) {
    const key = metadata ? 'metadataBytes' : 'cachedUTF8Bytes'
    if (evidence[key] + bytes > limit) {
      const error = new Error(`${label} source capture exceeds bounded ${key}`)
      fatal(error)
      throw error
    }
    evidence[key] += bytes
    if (!metadata) evidence.peakCachedUTF8Bytes = evidence.cachedUTF8Bytes
  }
  function lifecycle(type, data) {
    if (evidence.lifecycle.length >= 4096) {
      fatal(new Error(`${label} source context metadata exceeds 4096 events`))
      return
    }
    const event = { type, at: new Date().toISOString(), ...data }
    try {
      reserve(Buffer.byteLength(JSON.stringify(event)), true)
      evidence.lifecycle.push(event)
    } catch (error) {
      fatal(error)
    }
  }
  function retire(context, reason) {
    if (!context || context.retired) return
    context.retired = { reason, at: new Date().toISOString() }
    evidence.contextRevision++
  }
  function onCreated({ context }) {
    if (closed || evidence.fatalError) return
    retire(activeContexts.get(context.id), 'executionContextId replaced')
    const entry = {
      key:
        context.uniqueId ??
        `${evidence.epoch}:${context.id}:${++contextSequence}`,
      id: context.id,
      uniqueId: context.uniqueId ?? null,
      epoch: evidence.epoch,
      origin: context.origin,
      name: context.name,
      auxData: context.auxData ?? null,
      createdAt: new Date().toISOString(),
      retired: null,
    }
    activeContexts.set(context.id, entry)
    evidence.contextRevision++
    lifecycle('executionContextCreated', { context: entry })
  }
  function onDestroyed(event) {
    const context = event.executionContextUniqueId
      ? [...activeContexts.values()].find(
          (item) => item.uniqueId === event.executionContextUniqueId
        )
      : activeContexts.get(event.executionContextId)
    retire(context, 'Runtime.executionContextDestroyed')
    if (context) activeContexts.delete(context.id)
    lifecycle('executionContextDestroyed', event)
  }
  function onCleared() {
    for (const context of activeContexts.values())
      retire(context, 'Runtime.executionContextsCleared')
    activeContexts.clear()
    evidence.epoch++
    evidence.contextRevision++
    lifecycle('executionContextsCleared', { epoch: evidence.epoch })
  }
  function onNavigation(frame) {
    if (frame === page.mainFrame())
      lifecycle('mainFrameNavigated', { url: frame.url() })
  }
  function onParsed(parsed) {
    evidence.scriptEvents++
    if (closed || evidence.fatalError || String(parsed.scriptId) === '0') return
    try {
      const served = /^https?:/.test(parsed.url)
      let context = activeContexts.get(parsed.executionContextId)
      if (!context) {
        context = {
          key: `${evidence.epoch}:${
            parsed.executionContextId
          }:${++contextSequence}`,
          id: parsed.executionContextId,
          uniqueId: null,
          epoch: evidence.epoch,
          auxData: parsed.executionContextAuxData ?? null,
          metadataUnavailable: true,
          retired: null,
        }
        activeContexts.set(parsed.executionContextId, context)
      }
      const key = JSON.stringify([
        sessionKey,
        context.key,
        parsed.scriptId,
        parsed.url,
        parsed.hash,
        hash(parsed.sourceMapURL ?? ''),
      ])
      if (currentScripts.get(parsed.scriptId)?.metadata.key === key) return
      if (currentScripts.size >= evidence.limits.scriptMetadata)
        throw new Error(
          `${label} source identity metadata exceeds hard script bound`
        )
      const metadata = {
        key,
        sessionKey,
        scriptId: parsed.scriptId,
        url: parsed.url,
        protocolHash: parsed.hash,
        executionContextId: parsed.executionContextId,
        sourceMapURLSHA256: hash(parsed.sourceMapURL ?? ''),
        context,
        hasSourceURL: parsed.hasSourceURL ?? false,
        executionContextUniqueId: context.uniqueId,
        startLine: parsed.startLine,
        startColumn: parsed.startColumn,
        endLine: parsed.endLine,
        endColumn: parsed.endColumn,
        length: parsed.length ?? null,
        isModule: parsed.isModule ?? null,
        isLiveEdit: parsed.isLiveEdit ?? null,
        scriptLanguage: parsed.scriptLanguage ?? null,
        sourceMapURL: served
          ? parsed.sourceMapURL?.startsWith('data:')
            ? 'inline:data-url'
            : parsed.sourceMapURL ?? null
          : null,
        parsedAt: new Date().toISOString(),
        status: served ? 'pending' : 'metadata-only',
      }
      reserve(Buffer.byteLength(JSON.stringify(metadata)), true)
      const entry = {
        scriptId: parsed.scriptId,
        url: parsed.url,
        hash: parsed.hash,
        sourceMapURL: served ? parsed.sourceMapURL : null,
        metadata,
        ready: null,
      }
      currentScripts.set(parsed.scriptId, entry)
      evidence.metadataScriptCount = currentScripts.size
      if (!served) return
      if (scripts.size >= evidence.limits.scripts || evidence.pending >= 64)
        throw new Error(
          `${label} eager source capture exceeds script/pending bound`
        )
      scripts.set(key, entry)
      evidence.entries.push(metadata)
      evidence.pending++
      evidence.pendingPeak = Math.max(evidence.pendingPeak, evidence.pending)
      entry.ready = (async () => {
        try {
          evidence.sourceRequests++
          const { scriptSource } = await cdp.send('Debugger.getScriptSource', {
            scriptId: parsed.scriptId,
          })
          if (closed) {
            metadata.status = 'cancelled'
            return
          }
          const bytes = Buffer.byteLength(scriptSource)
          reserve(bytes)
          entry.scriptSource = scriptSource
          entry.sha256 = hash(scriptSource)
          metadata.sourceBytes = bytes
          metadata.sha256 = entry.sha256
          metadata.sourceCapturedAt = new Date().toISOString()
          entry.mapURL =
            parsed.sourceMapURL ||
            /[#@] sourceMappingURL=(\S+)/.exec(scriptSource)?.[1]
          entry.map = null
          entry.mapError = null
          if (entry.mapURL) {
            try {
              let text
              if (entry.mapURL.startsWith('data:')) {
                const comma = entry.mapURL.indexOf(',')
                text = /;base64/.test(entry.mapURL.slice(0, comma))
                  ? Buffer.from(
                      entry.mapURL.slice(comma + 1),
                      'base64'
                    ).toString()
                  : decodeURIComponent(entry.mapURL.slice(comma + 1))
              } else {
                const controller = new AbortController()
                requests.add(controller)
                const timer = setTimeout(() => controller.abort(), 15000)
                try {
                  const response = await fetch(
                    new URL(entry.mapURL, parsed.url),
                    { signal: controller.signal }
                  )
                  if (!response.ok)
                    throw new Error(`Source map HTTP ${response.status}`)
                  text = await response.text()
                  metadata.mapResponseURL = response.url
                } finally {
                  clearTimeout(timer)
                  requests.delete(controller)
                }
              }
              if (closed) {
                metadata.status = 'cancelled'
                return
              }
              const mapBytes = Buffer.byteLength(text)
              if (mapBytes > 32 * 1024 * 1024)
                throw new Error('Source map exceeds 32MiB budget')
              reserve(mapBytes)
              metadata.mapBytes = mapBytes
              metadata.mapRawSHA256 = hash(text)
              metadata.mapCapturedAt = new Date().toISOString()
              const map = JSON.parse(text)
              if (map.sections)
                throw new Error(
                  'Indexed source map is not supported; source attribution remains explicit'
                )
              entry.map = map
            } catch (error) {
              entry.mapError = String(error)
              metadata.mapError = String(error)
              if (evidence.cachedUTF8Bytes >= limit) fatal(error)
            }
          }
          metadata.status = closed ? 'cancelled' : 'captured'
        } catch (error) {
          metadata.status = 'error'
          metadata.error = String(error)
          metadata.sourceAcquisitionError = sourceAcquisitionError(error)
        } finally {
          evidence.pending--
        }
      })()
    } catch (error) {
      fatal(error)
    }
  }
  function closeCapture() {
    if (closed) return
    closed = true
    cdp.off('Debugger.scriptParsed', onParsed)
    cdp.off('Runtime.executionContextCreated', onCreated)
    cdp.off('Runtime.executionContextDestroyed', onDestroyed)
    cdp.off('Runtime.executionContextsCleared', onCleared)
    page.off('framenavigated', onNavigation)
    for (const request of requests) request.abort()
    requests.clear()
    for (const lookup of lookups) lookup.clear()
    lookups.clear()
    for (const entry of scripts.values()) {
      delete entry.scriptSource
      delete entry.map
    }
    evidence.releasedCachedUTF8Bytes = evidence.cachedUTF8Bytes
    evidence.cachedUTF8Bytes = 0
    scripts.clear()
    currentScripts.clear()
    activeContexts.clear()
    evidence.closedAt = new Date().toISOString()
    if (!evidence.fatalError) evidence.status = 'closed'
  }
  const capture = {
    cdp,
    evidence,
    currentScripts,
    lookups,
    async acquireSampledSource(script) {
      if (script.ready) await script.ready
      if (
        typeof script.scriptSource === 'string' ||
        script.metadata.status === 'error'
      )
        return
      const metadata = script.metadata
      try {
        if (closed || currentScripts.get(script.scriptId) !== script)
          throw new Error('Sampled script identity is no longer current')
        if (scripts.size >= evidence.limits.scripts || evidence.pending >= 64)
          throw new Error(
            `${label} sampled source capture exceeds script/pending bound`
          )
        scripts.set(metadata.key, script)
        evidence.entries.push(metadata)
        evidence.pending++
        evidence.pendingPeak = Math.max(evidence.pendingPeak, evidence.pending)
        metadata.status = 'pending-sampled-source'
        metadata.acquisitionPhase = 'after-sampling-stop'
        script.ready = (async () => {
          try {
            evidence.sourceRequests++
            const { scriptSource } = await cdp.send(
              'Debugger.getScriptSource',
              {
                scriptId: script.scriptId,
              }
            )
            if (typeof scriptSource !== 'string')
              throw new Error(
                'Debugger.getScriptSource returned no scriptSource text'
              )
            if (closed || currentScripts.get(script.scriptId) !== script)
              throw new Error(
                'Sampled script identity changed during source acquisition'
              )
            reserve(Buffer.byteLength(scriptSource))
            script.scriptSource = scriptSource
            script.sha256 = hash(scriptSource)
            metadata.sourceBytes = Buffer.byteLength(scriptSource)
            metadata.sha256 = script.sha256
            metadata.sourceCapturedAt = new Date().toISOString()
            metadata.status = 'captured'
          } catch (error) {
            metadata.status = 'error'
            metadata.sourceAcquisitionError = sourceAcquisitionError(error)
          } finally {
            evidence.pending--
          }
        })()
        await script.ready
      } catch (error) {
        metadata.status = 'error'
        metadata.sourceAcquisitionError = sourceAcquisitionError(error)
        fatal(error)
      }
    },
    get closed() {
      return closed
    },
  }
  Object.defineProperty(scripts, 'capture', { value: capture })
  // Page/context cleanup is already registered by the caller. Register this
  // cache's listeners and fetch cleanup before enabling either protocol domain.
  page.once('close', closeCapture)
  page.on('framenavigated', onNavigation)
  cdp.on('Runtime.executionContextCreated', onCreated)
  cdp.on('Runtime.executionContextDestroyed', onDestroyed)
  cdp.on('Runtime.executionContextsCleared', onCleared)
  cdp.on('Debugger.scriptParsed', onParsed)
  await cdp.send('Runtime.enable')
  const enabled = await cdp.send('Debugger.enable', {
    maxScriptsCacheSize: limit,
  })
  evidence.debuggerId = enabled.debuggerId ?? null
  evidence.debuggerParameters = { maxScriptsCacheSize: limit }
  return scripts
}

async function createConsumer(url, label) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  contexts.add(context)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = [],
    warnings = [],
    network = [],
    hdr = [],
    pendingResponses = []
  page.on('pageerror', (error) => {
    diagnostic(label, 'pageerror', error.stack ?? String(error))
    if (errors.length < 100) errors.push(String(error))
  })
  page.on('console', (message) => {
    diagnostic(
      label,
      `console.${message.type()}`,
      message.text(),
      message.location()
    )
    const target = message.type() === 'warning' ? warnings : errors
    if (['error', 'warning'].includes(message.type()) && target.length < 100)
      target.push(`${message.type()}: ${message.text().slice(0, 2048)}`)
  })
  page.on('response', (response) => {
    if (network.length < 1024)
      network.push({
        url: response.url(),
        status: response.status(),
        resourceType: response.request().resourceType(),
      })
    if (/\.hdr(?:\?|$)/i.test(response.url()) && pendingResponses.length < 32) {
      pendingResponses.push(
        (async () => {
          try {
            const bytes = await response.body()
            hdr.push({
              url: response.url(),
              status: response.status(),
              bytes: bytes.length,
              sha256: hash(bytes),
            })
          } catch (error) {
            hdr.push({ url: response.url(), error: String(error) })
          }
        })()
      )
    }
  })
  const cdp = await context.newCDPSession(page)
  const scripts = await captureConsumerSources(cdp, page, label)
  report.provenance[`${label}Protocol`] = await cdp.send('Browser.getVersion')
  await page.addInitScript(installProbe)
  // The consumer contract uses /hdr/, but neither workspace app ships a
  // public/hdr directory; Vite can return its SPA HTML with HTTP 200 there.
  // Serve the same checked-in, unmodified Radiance bytes to both consumers.
  // This is harness-owned asset delivery, not a generated texture or SDK shim.
  const assetProvenance = []
  for (const name of ['city', 'dawn', 'lobby']) {
    const asset = await realHDRAsset(name)
    const endpoint = new URL(`/hdr/${name}.hdr`, url).href
    assetProvenance.push({
      url: endpoint,
      source: asset.path,
      bytes: asset.bytes.length,
      sha256: asset.sha256,
    })
    await page.route(endpoint, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: asset.bytes,
      })
    )
  }
  report.provenance[`${label}HDRDelivery`] = {
    scope:
      'Harness route serves real checked-in HDR bytes unchanged to the actual public loader; no app/SDK instrumentation or synthetic image',
    assets: assetProvenance,
  }
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => !!window.gradientFixture)
  return {
    context,
    page,
    cdp,
    scripts,
    errors,
    warnings,
    network,
    hdr,
    pendingResponses,
    label,
  }
}

async function mirrorWindow(page, name, resizeAllowance = 0, duration = 400) {
  const before = await mirrorCall(page, 'snapshot')
  const window = await observationWindow(page, duration)
  const after = await mirrorCall(page, 'snapshot')
  const source = before.sources.A,
    end = after.sources.A
  const views = ['square', 'wide', 'tall']
  const copies = views.reduce(
    (n, id) => n + after.views[id].copies - before.views[id].copies,
    0
  )
  const frames = end.frames - source.frames
  const visibleViews = source.demand.visibleViews
  const budget = frames * visibleViews + resizeAllowance
  check(
    `${name}: copy budget`,
    copies <= budget,
    { copies, frames, visibleViews, resizeAllowance, budget },
    'F15/F16 completed-frame mirror copying'
  )
  if (visibleViews === 0)
    check(
      `${name}: no visible views means no copies`,
      copies === 0,
      copies,
      'F15/F16 visibility'
    )
  assertUnrelatedIdle(window, name)
  report.scenarios.push({
    name,
    before,
    after,
    window,
    copies,
    frames,
    visibleViews,
    resizeAllowance,
    budget,
  })
  return { before, after, window }
}

async function captureHeapSnapshot(cdp, label) {
  const fileName = `${label}.heapsnapshot.json.gz`
  const rawLimit = 256 * 1024 * 1024
  const compressedLimit = 64 * 1024 * 1024
  const pendingRawLimit = 64 * 1024 * 1024
  const started = Date.now()
  const rawHash = createHash('sha256')
  const record = {
    label,
    file: fileName,
    status: 'capturing',
    startedAt: new Date(started).toISOString(),
    parameters: { reportProgress: true },
    limits: {
      rawBytes: rawLimit,
      compressedBytes: compressedLimit,
      pendingRawBytes: pendingRawLimit,
      commandMilliseconds: 90000,
    },
    rawBytes: 0,
    compressedBytesProduced: 0,
    chunks: 0,
    perturbation:
      'A full heap snapshot can stop the VM, collect garbage and change debugger/heap bookkeeping. Captured after the scheduled forced GC, outside allocation-profile and render/copy measurement windows.',
    protocolDocumentation:
      'https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/',
  }
  report.heapSnapshots.push(record)
  let gzip, meter, file, readback, finished
  let failure, rejectCapture
  const failed = new Promise((_, reject) => {
    rejectCapture = reject
  })
  // Keep event-triggered rejection handled even during synchronous acquisition.
  failed.catch(() => {})
  function stop(reason) {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
    cdp.off('HeapProfiler.reportHeapSnapshotProgress', onProgress)
    if (reason && !failure) {
      failure = reason
      record.status = 'interrupted'
      rejectCapture(reason)
    }
    gzip?.destroy()
    meter?.destroy()
    file?.destroy()
    readback?.destroy()
    return finished
  }
  function fail(error, status = 'error') {
    if (failure) return
    failure = error
    record.status = status
    rejectCapture(error)
    void stop()
  }
  function onChunk({ chunk }) {
    if (failure) return
    try {
      const size = Buffer.byteLength(chunk)
      if (record.rawBytes + size > rawLimit)
        throw new Error(`Heap snapshot ${label} exceeds 256MiB raw cap`)
      const bytes = Buffer.from(chunk)
      record.rawBytes += bytes.length
      record.chunks++
      rawHash.update(bytes)
      gzip.write(bytes)
      // CDP has no public chunk-pause command. Bound Node's queued raw buffers
      // instead of accumulating the snapshot as strings or an unbounded queue.
      if (gzip.writableLength > pendingRawLimit)
        throw new Error(
          `Heap snapshot ${label} exceeds 64MiB pending raw buffer cap`
        )
    } catch (error) {
      fail(error, 'truncated')
    }
  }
  function onProgress(progress) {
    record.progress = { ...progress }
  }
  // Register stream/listener cleanup before acquiring either streams or file.
  activeHeapCaptures.add(stop)
  try {
    if (filesWritten >= 80)
      throw new Error('Heap snapshot exceeds 80-file run cap')
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
    cdp.on('HeapProfiler.reportHeapSnapshotProgress', onProgress)
    gzip = createGzip()
    meter = new Transform({
      transform(chunk, encoding, callback) {
        if (
          record.compressedBytesProduced + chunk.length > compressedLimit ||
          bytesWritten + chunk.length > 256 * 1024 * 1024
        ) {
          const error = new Error(
            `Heap snapshot ${label} exceeds compressed-file or aggregate run byte cap`
          )
          fail(error, 'truncated')
          callback(error)
          return
        }
        record.compressedBytesProduced += chunk.length
        bytesWritten += chunk.length
        callback(null, chunk)
      },
    })
    file = createWriteStream(join(run, fileName), { flags: 'wx' })
    file.once('open', () => {
      filesWritten++
    })
    finished = pipeline(gzip, meter, file).catch((error) => {
      fail(error)
    })
    record.before = await cdp.send('Runtime.getHeapUsage')
    await bounded(
      () =>
        Promise.race([
          cdp.send('HeapProfiler.takeHeapSnapshot', record.parameters),
          failed,
        ]),
      90000,
      `capture ${label} heap snapshot`
    )
    if (failure) throw failure
    gzip.end()
    await bounded(
      () => Promise.race([finished, failed]),
      10000,
      `flush ${label} heap snapshot`
    )
    if (failure) throw failure
    if (record.chunks === 0 || record.rawBytes === 0)
      throw new Error(`Heap snapshot ${label} completed without actual chunks`)
    record.after = await cdp.send('Runtime.getHeapUsage')
    record.status = 'captured'
  } catch (error) {
    failure ??= error
    if (record.status === 'capturing') record.status = 'error'
    record.error = { message: String(failure), stack: failure?.stack ?? null }
  } finally {
    await bounded(() => stop(), 5000, `close ${label} heap streams`).catch(
      (error) => {
        failure ??= error
        record.status = 'error'
        record.cleanupError = String(error)
      }
    )
    record.rawPrefixSHA256 = rawHash.digest('hex')
    record.fileBytes = 0
    try {
      const fileHash = createHash('sha256')
      readback = createReadStream(join(run, fileName))
      for await (const bytes of readback) {
        record.fileBytes += bytes.length
        fileHash.update(bytes)
      }
      record.fileSHA256 = fileHash.digest('hex')
      if (
        record.status === 'captured' &&
        record.fileBytes !== record.compressedBytesProduced
      )
        throw new Error(
          `Heap snapshot ${label} compressed file byte count disagrees with streamed output`
        )
    } catch (error) {
      record.fileHashError = String(error)
      failure ??= error
      record.status = 'error'
    } finally {
      readback?.destroy()
      activeHeapCaptures.delete(stop)
    }
    record.finishedAt = new Date().toISOString()
    record.durationMs = Date.now() - started
    record.completeRawSHA256 =
      record.status === 'captured' ? record.rawPrefixSHA256 : null
    record.retained =
      'Unique run-owned gzip file; partial/error files are retained with explicit status, never treated as a complete snapshot.'
    check(
      `${label}: complete bounded heap snapshot`,
      record.status === 'captured',
      record,
      'F27 heap-retainer evidence'
    )
  }
  if (failure) throw failure
  return record
}

async function resourceCycle(native, measured, index) {
  const { page, cdp } = native
  const start = await probe(page)
  const mirrorStart = await mirrorCall(page, 'snapshot')
  await nativeCall(page, 'update', {
    ...workload,
    animate: 'off',
    grain: 'on',
    lightType: 'env',
  })
  await nativeCall(page, 'lifecycle.setMounted', true)
  await page.evaluate(() => window.__nativePerformance.attach())
  await page.waitForFunction(
    () => window.gradientFixture.snapshot().scene?.environmentUuid != null,
    undefined,
    { timeout: 30000 }
  )
  await nativeCall(page, 'lifecycle.requestFrame')
  const mounted = await probe(page)
  const geometryIds = mounted.three
    .filter(
      (r) =>
        r.kind === 'geometry' &&
        r.owner === 'native' &&
        !start.three.some((s) => s.id === r.id)
    )
    .map((r) => r.id)
  const rendererIds = mounted.three
    .filter(
      (r) =>
        r.kind === 'renderer' &&
        r.owner === 'native' &&
        !start.three.some((s) => s.id === r.id)
    )
    .map((r) => r.id)
  await nativeCall(page, 'lifecycle.setMounted', false)
  for (const id of ['square', 'wide', 'tall'])
    await mirrorCall(page, 'configureView', id, {
      mounted: true,
      source: 'A',
      visible: true,
      pixelDensity: 1,
    })
  await mirrorCall(page, 'configureSource', 'main', {
    mounted: true,
    source: 'A',
    width: 480,
    height: 320,
    pixelDensity: 1,
    gradient: { ...workload, animate: 'off', grain: 'on', lightType: 'env' },
    canvas: { envBasePath: '/hdr/', respectReducedMotion: true },
  })
  await mirrorCall(page, 'requestFrame', 'A')
  await page.waitForFunction(
    () => {
      const state = window.gradientFixture.mirrors.snapshot()
      return (
        state.sources.A.demand.visibleViews === 3 &&
        ['square', 'wide', 'tall'].every(
          (id) => state.views[id].pixels?.nonzeroAlpha > 0
        )
      )
    },
    undefined,
    { timeout: 30000 }
  )
  const mirrorMounted = await mirrorCall(page, 'snapshot')
  const cycleCopies = ['square', 'wide', 'tall'].reduce(
    (sum, id) =>
      sum + mirrorMounted.views[id].copies - mirrorStart.views[id].copies,
    0
  )
  const cycleFrames =
    mirrorMounted.sources.A.frames - mirrorStart.sources.A.frames
  check(
    `cycle ${index}: three-view completed-frame copy ceiling`,
    cycleCopies <= cycleFrames * mirrorMounted.sources.A.demand.visibleViews &&
      mirrorMounted.sources.A.demand.visibleViews === 3,
    {
      cycleCopies,
      cycleFrames,
      visibleViews: mirrorMounted.sources.A.demand.visibleViews,
      ceiling: cycleFrames * 3,
      scope:
        'views mount before producer; fixed three-view demand during completed output',
    },
    'F15/F16 mirror copies'
  )
  for (const id of ['square', 'wide', 'tall'])
    await mirrorCall(page, 'configureView', id, { mounted: false })
  await mirrorCall(page, 'configureSource', 'main', { mounted: false })
  await settle(page)
  const end = await probe(page)
  const mirrors = await mirrorCall(page, 'snapshot')
  const resources = end.three.filter((r) =>
    [...geometryIds, ...rendererIds].includes(r.id)
  )
  check(
    `cycle ${index}: scoped geometry/renderer once`,
    resources.length > 0 && resources.every((r) => r.disposals === 1),
    resources,
    'F12/F14 resource ownership'
  )
  const materialRecords = end.three.filter(
    (r) =>
      r.owner === 'native' &&
      r.kind === 'material' &&
      !start.three.some((s) => s.id === r.id)
  )
  check(
    `cycle ${index}: scoped material once`,
    materialRecords.length > 0 &&
      materialRecords.every((r) => r.disposals === 1),
    materialRecords,
    'F12/F14 resource ownership'
  )
  const targetRecords = end.three.filter(
    (r) =>
      r.owner === 'native' &&
      r.kind === 'target' &&
      !start.three.some((s) => s.id === r.id)
  )
  check(
    `cycle ${index}: scoped targets released once outside resize`,
    targetRecords.length > 0 &&
      targetRecords.every(
        (r) =>
          r.terminalDisposals === 1 &&
          r.disposals === r.resizeInvalidations + r.terminalDisposals
      ),
    targetRecords,
    'F12/F14 target ownership'
  )
  check(
    `cycle ${index}: source/view teardown`,
    mirrors.sources.A.demand.visibleViews === 0 &&
      mirrors.sources.A.demand.pendingFrames === 0 &&
      mirrors.instrumentation.viewWrappers === 0 &&
      mirrors.instrumentation.pendingRequests === 0,
    {
      demand: mirrors.sources.A.demand,
      instrumentation: mirrors.instrumentation,
    },
    'F15/F16 subscriptions'
  )
  const scopedContexts = end.contexts.filter(
    (entry) => entry.scope === 'main' || entry.scope === 'mirror-source-main'
  )
  check(
    `cycle ${index}: no observed live owned context`,
    scopedContexts.every((entry) => entry.lost || entry.collected),
    scopedContexts.map(({ id, scope, lost, collected }) => ({
      id,
      scope,
      lost,
      collected,
    })),
    'F12/F15 renderer/context ownership'
  )
  const window = await observationWindow(page, 120)
  assertUnrelatedIdle(window, `cycle ${index}`)
  if (!measured || index % 10 === 0)
    await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const record = {
    index,
    measured,
    postForcedGC: !measured || index % 10 === 0,
    resources: end.resources,
    observers: end.observers,
    listeners: end.listeners,
    mountedRendererInfo: mounted.rendererInfo,
    threeCreated: end.three.length,
    threeLive: end.three
      .filter(
        (r) =>
          r.kind !== 'texture' &&
          r.terminalDisposals === 0 &&
          !r.targetReleaseObserved
      )
      .map((r) => ({ id: r.id, kind: r.kind, owner: r.owner })),
    textureCalls: end.three.filter(
      (r) => r.kind === 'texture' || r.kind === 'target-texture'
    ),
    targetDisposalCalls: end.three.filter((r) => r.kind === 'target'),
    threeDuplicateDisposals: end.three.filter((r) => r.terminalDisposals > 1),
    contexts: end.contexts.map(({ id, scope, lost, collected }) => ({
      id,
      scope,
      lost,
      collected,
    })),
    demand: mirrors.sources.A.demand,
    subscriptions: mirrors.instrumentation,
    mirrorFrame: mirrorMounted.sources.A.lastFrame,
    heap,
  }
  if (measured) report.cycles.push(record)
  else report.warmup = record
  return record
}

async function toolchain(directory) {
  const resolver = createRequire(join(directory, 'package.json'))
  const result = { directory, packages: {} }
  for (const name of [
    'svelte',
    '@sveltejs/kit',
    '@threlte/core',
    'three',
    'camera-controls',
    'vite',
    '@shadergradient/svelte',
    '@shadergradient/core',
    '@shadergradient/vue',
    '@tresjs/core',
  ]) {
    try {
      let entry
      try {
        entry = resolver.resolve(`${name}/package.json`)
      } catch {
        entry = resolver.resolve(name)
      }
      let directory = dirname(entry)
      let found = false
      for (let depth = 0; depth < 12; depth++) {
        try {
          const bytes = await readFile(join(directory, 'package.json'))
          const pkg = JSON.parse(bytes)
          if (pkg.name === name) {
            result.packages[name] = {
              version: pkg.version,
              packageJSON: join(directory, 'package.json'),
              sha256: hash(bytes),
            }
            found = true
            break
          }
        } catch {}
        const parent = dirname(directory)
        if (parent === directory) break
        directory = parent
      }
      if (!found)
        result.packages[name] = {
          unavailable:
            'Resolved module has no matching reachable package metadata',
        }
    } catch (error) {
      result.packages[name] = { unavailable: String(error) }
    }
  }
  return result
}
try {
  await mkdir(run)
  await save('ownership.json', {
    pid: process.pid,
    startedAt: report.startedAt,
    scope: 'browser and contexts only; shared servers untouched',
    retention:
      'Evidence intentionally retained for parent acceptance; remove this unique run directory after review, recommended within 14 days',
    budgets: {
      files: 80,
      bytes: 268435456,
      contexts: 2,
      cycles: 100,
      profiles: 6,
      heapSnapshots: 2,
      heapSnapshotRawBytes: 268435456,
      heapSnapshotCompressedBytes: 67108864,
      deadlineMinutes: 20,
    },
  })
  const manifestBytes = await readFile(resolve(options['--manifest']))
  const manifest = JSON.parse(manifestBytes)
  if (
    !manifest.candidate?.inputs ||
    !manifest.packages?.native ||
    !manifest.consumers?.length
  )
    throw new Error('Expected actual F26 prepared manifest schema')
  const changed = []
  for (const input of manifest.candidate.inputs) {
    try {
      const actual = hash(await readFile(resolve(root, input.path)))
      if (actual !== input.sha256)
        changed.push({ path: input.path, prepared: input.sha256, actual })
    } catch (error) {
      changed.push({ path: input.path, error: String(error) })
    }
  }
  report.provenance = {
    manifest: {
      path: resolve(options['--manifest']),
      sha256: hash(manifestBytes),
      preparationFingerprint: manifest.candidate.fingerprint,
      currentPreparationInputsMatch: changed.length === 0,
      changedInputs: changed,
    },
    artifactPair: Object.fromEntries(
      await Promise.all(
        Object.entries(manifest.packages).map(async ([key, pkg]) => {
          const actual = hash(await readFile(pkg.tarball))
          if (actual !== pkg.sha256)
            throw new Error(`Prepared ${key} tarball digest mismatch`)
          return [
            key,
            {
              name: pkg.name,
              version: pkg.version,
              sha256: actual,
              tarball: pkg.tarball,
            },
          ]
        })
      )
    ),
    currentHarness: hash(await readFile(fileURLToPath(import.meta.url))),
    currentRootManifest: hash(await readFile(join(root, 'package.json'))),
    currentLock: hash(await readFile(join(root, 'pnpm-lock.yaml'))),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    playwright: require('@playwright/test/package.json').version,
    chromiumLaunchOptions,
    identityScope:
      'Prepared package pair and served-script hashes are distinct from the full integrated checkout identity. Stale preparation inputs are listed, never relabeled as current full-candidate proof.',
    consumers: manifest.consumers.map(
      ({ id, kind, root, baseURL, svelteVersion, mode }) => ({
        id,
        kind,
        root,
        baseURL,
        svelteVersion,
        mode,
      })
    ),
  }
  report.workload = {
    name: 'Mint explicit matched output',
    width: 480,
    height: 320,
    deviceScaleFactor: 1,
    props: workload,
    hdr: '/hdr/city.hdr via actual public loader; harness delivers unchanged packages/ui/assets/hdr bytes to both origins',
    pairedAllocationProfiles: [
      ['native-grain-off', 'vue-grain-off'],
      ['native-grain-on', 'vue-grain-on'],
    ],
    pairedAllocationLighting: '3d',
    nativeOnlyAllocationProfiles: [
      'native-hdr-grain',
      'native-mirrors-grain-hdr',
    ],
    hdrComparisonScope:
      'Real delivered-byte identity and separate paused observations; Vue HDR decoding is not established by HTTP status, and no paired active-HDR allocation profile is collected.',
    pipelineDifference:
      'Native Threlte selected grain render path versus existing Vue/Tres composer path; compare counts and output behavior, not identical internals or absolute milliseconds.',
  }
  if (report.interruption)
    throw new Error(
      `Interrupted before browser acquisition: ${report.interruption}`
    )
  launchingBrowser = chromium.launchServer({
    ...chromiumLaunchOptions,
    headless: true,
    timeout: 30000,
  })
  const browserServer = await launchingBrowser
  if (report.interruption)
    throw new Error(
      `Interrupted during browser acquisition: ${report.interruption}`
    )
  browser = await chromium.connect(browserServer.wsEndpoint(), {
    timeout: 30000,
  })
  report.provenance.browser = browser.version()
  const native = await createConsumer(options['--native-url'], 'native')
  const { page, cdp } = native
  report.native = {
    errors: native.errors,
    warnings: native.warnings,
    network: native.network,
  }
  await page.waitForFunction(
    () =>
      !!window.gradientFixture.mirrors &&
      !!window.gradientLifecycle?.refs().native
  )
  await nativeCall(page, 'lifecycle.setIndependentMounted', false)
  const unrelatedCanvases = await page
    .locator('[data-testid="independent-a"], [data-testid="independent-b"]')
    .count()
  check(
    'independent example trees are actually unmounted before profiling',
    unrelatedCanvases === 0,
    { remainingWrappers: unrelatedCanvases },
    'fixture'
  )
  await nativeCall(page, 'externalHost.configure', {
    enabled: false,
    gradients: [],
  })
  for (const tree of ['main', 'independent'])
    await mirrorCall(page, 'configureSource', tree, { mounted: false })
  for (const id of ['square', 'wide', 'tall', 'independent'])
    await mirrorCall(page, 'configureView', id, { mounted: false })
  await mirrorCall(page, 'setOracle', false)
  await page.addStyleTag({
    content:
      '[data-testid="gradient-wrapper"]{width:480px!important;height:320px!important;min-height:0!important;position:fixed!important;top:8px!important;left:8px!important;z-index:100!important}[data-testid="gradient-wrapper"].offscreen{left:-10000px!important}[data-testid^="mirror-view-"]{position:fixed!important;top:400px!important;z-index:101!important}[data-testid="mirror-view-square"]{left:8px!important}[data-testid="mirror-view-wide"]{left:220px!important}[data-testid="mirror-view-tall"]{left:650px!important}',
  })
  await page.addStyleTag({
    content:
      '[data-testid^="mirror-view-"][data-f27-visible="false"]{left:-10000px!important;right:auto!important}',
  })
  await nativeCall(page, 'configureCanvas', {
    pixelDensity: 1,
    fov: 45,
    envBasePath: '/hdr/',
    respectReducedMotion: true,
    lazyLoad: true,
  })
  await nativeCall(page, 'update', { ...workload, animate: 'off' })
  await page.evaluate(() => window.__nativePerformance.attach())
  await idle(page, 'paused')
  const baseline = await fixture(page)
  check(
    'matched native dimensions/DPR',
    baseline.canvas?.cssWidth === 480 &&
      baseline.canvas?.cssHeight === 320 &&
      baseline.canvas?.bufferWidth === 480 &&
      baseline.canvas?.bufferHeight === 320 &&
      baseline.canvas?.dpr === 1,
    baseline.canvas,
    'F19 fixture workload'
  )
  report.native.baseline = await probe(page)
  const inventory = await scriptInventory(
    cdp,
    native.scripts,
    'native',
    manifest
  )
  report.provenance.nativeServed = inventory
  const matchedConsumer = manifest.consumers.find(
    (entry) =>
      new URL(entry.baseURL).origin === new URL(options['--native-url']).origin
  )
  report.provenance.nativeConsumerCorrelation = matchedConsumer
    ? {
        id: matchedConsumer.id,
        basis:
          'URL origin plus actual served-script byte matches; URL alone is not package identity',
        byteMatches: inventory.filter(
          (entry) => entry.preparedByteMatches.length
        ),
      }
    : {
        id: null,
        basis:
          'Workspace URL: manifest identifies prepared packages only, not these served workspace bytes',
        byteMatches: [],
      }
  report.provenance.nativePackageSourceMatches = inventory.flatMap(
    (entry) => entry.packageSourceMatches
  )
  check(
    'served native bytes correlate to actual artifact/source',
    inventory.some(
      (entry) =>
        entry.preparedByteMatches.length ||
        entry.packageSourceMatches.some((match) => match.artifact === 'native')
    ),
    report.provenance.nativeConsumerCorrelation,
    'F27 artifact provenance'
  )
  report.provenance.toolchains = {
    scope:
      'Read from actual installed package metadata; server attribution additionally requires the served-byte/source correlations above.',
    native: matchedConsumer
      ? await toolchain(matchedConsumer.root)
      : {
          workspacePlain: await toolchain(
            join(root, 'apps/example-svelte-dev')
          ),
          workspaceKit: await toolchain(
            join(root, 'apps/example-sveltekit-dev')
          ),
        },
    vue: await toolchain(join(root, 'apps/example-vue-dev')),
  }

  for (const grain of ['off', 'on']) {
    await nativeCall(page, 'update', { animate: 'on', grain })
    const active = await observationWindow(page, 900)
    assertUnrelatedIdle(active, `active grain ${grain}`)
    const deltaFrames =
      active.last.fixture.counters.completedFrames -
      active.first.fixture.counters.completedFrames
    const sceneRenders =
      active.last.probe.counters.sceneRenders -
      active.first.probe.counters.sceneRenders
    const fullscreenRenders =
      active.last.probe.counters.fullscreenRenders -
      active.first.probe.counters.fullscreenRenders
    report.scenarios.push({
      name: `active grain ${grain}`,
      deltaFrames,
      sceneRenders,
      fullscreenRenders,
      ...active,
    })
    check(
      `grain ${grain}: one scene path per completed frame`,
      deltaFrames > 0 && sceneRenders === deltaFrames,
      { deltaFrames, sceneRenders, fullscreenRenders },
      'F09/F14 selected render path'
    )
    check(
      `grain ${grain}: fullscreen path`,
      grain === 'on'
        ? fullscreenRenders === deltaFrames
        : fullscreenRenders === 0,
      { deltaFrames, fullscreenRenders },
      'F14 grain pass'
    )
    check(
      `grain ${grain}: time advances`,
      active.last.fixture.scene?.meshes[0]?.time !==
        active.first.fixture.scene?.meshes[0]?.time,
      [
        active.first.fixture.scene?.meshes[0]?.time,
        active.last.fixture.scene?.meshes[0]?.time,
      ],
      'F09 time'
    )
    await allocationProfile(
      page,
      cdp,
      `native-grain-${grain}`,
      'one active 480x320 DPR1 output; fixed unrelated examples must be settled',
      inventory
    )
    await nativeCall(page, 'update', { animate: 'off' })
    await idle(page, `grain ${grain} paused`)
  }
  const stable = await redraw(
    page,
    'paused public color/noise/transform update',
    () =>
      nativeCall(page, 'update', {
        color1: '#ff0088',
        uStrength: 2.2,
        positionX: 0.1,
      })
  )
  check(
    'non-topology object/uniform/vector identities stable',
    JSON.stringify(stable.beforeProbe.identities) ===
      JSON.stringify(stable.afterProbe.identities),
    [stable.beforeProbe.identities, stable.afterProbe.identities],
    'F09/F12 stable hot objects'
  )
  await redraw(page, 'paused camera input', () =>
    nativeCall(page, 'update', { cAzimuthAngle: 150, cDistance: 4.8 })
  )
  await redraw(page, 'paused resize', async () => {
    await page.addStyleTag({
      content:
        '[data-testid="gradient-wrapper"]{width:512px!important;height:288px!important}',
    })
    await nativeCall(page, 'lifecycle.requestFrame')
  })
  await page.addStyleTag({
    content:
      '[data-testid="gradient-wrapper"]{width:480px!important;height:320px!important}',
  })
  await redraw(page, 'paused HDR completion', async () => {
    await nativeCall(page, 'update', { lightType: 'env', envPreset: 'city' })
    await page.waitForFunction(
      () => !!window.gradientFixture.snapshot().scene?.environmentUuid,
      undefined,
      { timeout: 30000 }
    )
    await nativeCall(page, 'lifecycle.requestFrame')
  })
  await nativeCall(page, 'update', {
    ...workload,
    animate: 'on',
    lightType: 'env',
    grain: 'on',
  })
  await nativeCall(page, 'lifecycle.requestFrame')
  await allocationProfile(
    page,
    cdp,
    'native-hdr-grain',
    'matched Mint one-output480x320 DPR1 active HDR/grain with actual environment UUID',
    inventory
  )
  await nativeCall(page, 'update', { animate: 'off' })
  report.scenarios.push({
    name: 'native matched HDR grain paused',
    ...(await idle(page, 'matched HDR paused')),
  })
  await nativeCall(page, 'update', { ...workload, animate: 'on' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await idle(page, 'reduced-motion')
  await redraw(page, 'reduced-motion explicit seek', () =>
    nativeCall(page, 'update', { uTime: 4 })
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await nativeCall(page, 'lifecycle.setVisible', false)
  await idle(page, 'offscreen')
  await nativeCall(page, 'lifecycle.setVisible', true)
  await nativeCall(page, 'update', { animate: 'off' })
  await nativeCall(page, 'lifecycle.setMounted', false)

  await mirrorCall(page, 'configureSource', 'main', {
    mounted: true,
    source: 'A',
    width: 480,
    height: 320,
    pixelDensity: 1,
    maxDimension: 1024,
    gradient: { ...workload, animate: 'on' },
    canvas: { envBasePath: '/hdr/', respectReducedMotion: true },
  })
  for (const id of ['square', 'wide', 'tall'])
    await mirrorCall(page, 'configureView', id, {
      mounted: true,
      source: 'A',
      visible: true,
    })
  await page.waitForFunction(
    () =>
      window.gradientFixture.mirrors.snapshot().sources.A.demand
        .visibleViews === 3
  )
  await mirrorCall(page, 'requestFrame', 'A')
  await mirrorWindow(page, 'one-source three-visible-views active')
  await mirrorCall(page, 'configureSource', 'main', {
    gradient: { grain: 'on', lightType: 'env' },
  })
  await page.waitForLoadState('networkidle')
  await mirrorCall(page, 'requestFrame', 'A')
  const mirrorInventory = await scriptInventory(
    cdp,
    native.scripts,
    'native-mirrors',
    manifest
  )
  await allocationProfile(
    page,
    cdp,
    'native-mirrors-grain-hdr',
    'one real active Source, three visible Views, grain/HDR, 480x320 DPR1 producer; completed-frame copy workload',
    mirrorInventory
  )
  await mirrorWindow(page, 'one-source grain/HDR active copy budget')
  await mirrorCall(page, 'configureSource', 'main', {
    gradient: { animate: 'off', grain: 'on', lightType: 'env' },
  })
  await mirrorCall(page, 'requestFrame', 'A')
  await settle(page)
  const mirrorPaused = await mirrorWindow(page, 'one-source paused')
  check(
    'paused source frames cease',
    mirrorPaused.before.sources.A.frames ===
      mirrorPaused.after.sources.A.frames,
    [mirrorPaused.before.sources.A.frames, mirrorPaused.after.sources.A.frames],
    'F15 source scheduling'
  )
  const resizeBefore = await mirrorCall(page, 'snapshot')
  await mirrorCall(page, 'configureView', 'wide', { width: 312, height: 112 })
  await page.waitForFunction(
    (copies) =>
      window.gradientFixture.mirrors.snapshot().views.wide.copies > copies,
    resizeBefore.views.wide.copies
  )
  const resizeAfter = await mirrorCall(page, 'snapshot')
  const actualResizes = Number(
    resizeBefore.views.wide.buffer?.width !==
      resizeAfter.views.wide.buffer?.width ||
      resizeBefore.views.wide.buffer?.height !==
        resizeAfter.views.wide.buffer?.height
  )
  const resizeCopies = ['square', 'wide', 'tall'].reduce(
    (n, id) => n + resizeAfter.views[id].copies - resizeBefore.views[id].copies,
    0
  )
  check(
    'paused actual resize refresh budget',
    resizeCopies <=
      (resizeAfter.sources.A.frames - resizeBefore.sources.A.frames) * 3 +
        actualResizes,
    { resizeCopies, actualResizes, before: resizeBefore, after: resizeAfter },
    'F16 resize copy'
  )
  await mirrorCall(page, 'configureSource', 'main', {
    width: 4000,
    height: 3000,
    pixelDensity: 4,
    maxDimension: 1024,
  })
  await mirrorCall(page, 'requestFrame', 'A')
  const boundedSourceSnapshot = await mirrorCall(page, 'snapshot')
  check(
    'source bounded DPR/resolution',
    boundedSourceSnapshot.sources.A.lastFrame.width <= 1024 &&
      boundedSourceSnapshot.sources.A.lastFrame.height <= 1024,
    boundedSourceSnapshot.sources.A.lastFrame,
    'F15 bounded source dimensions'
  )
  await mirrorCall(page, 'configureView', 'square', {
    width: 4000,
    height: 3000,
    pixelDensity: 4,
    maxDimension: 1024,
  })
  await page.waitForFunction(() => {
    const b = window.gradientFixture.mirrors.snapshot().views.square.buffer
    return !!b && Math.max(b.width, b.height) === 1024
  })
  const boundedView = await mirrorCall(page, 'snapshot')
  check(
    'view bounded DPR/resolution',
    boundedView.views.square.buffer.width <= 1024 &&
      boundedView.views.square.buffer.height <= 1024,
    boundedView.views.square.buffer,
    'F16 bounded view dimensions'
  )
  await mirrorCall(page, 'configureSource', 'main', {
    width: 480,
    height: 320,
    pixelDensity: 1,
  })
  await mirrorCall(page, 'configureView', 'square', {
    width: 180,
    height: 180,
    pixelDensity: 1,
  })
  for (const id of ['square', 'wide', 'tall'])
    await mirrorCall(page, 'configureView', id, { visible: false })
  await page.waitForFunction(
    () =>
      window.gradientFixture.mirrors.snapshot().sources.A.demand
        .visibleViews === 0
  )
  await settle(page)
  const hidden = await mirrorWindow(page, 'all views hidden')
  check(
    'last hidden view releases source GPU',
    hidden.after.sources.A.demand.pendingFrames === 0 &&
      hidden.after.contexts.live === 0,
    { contexts: hidden.after.contexts, demand: hidden.after.sources.A.demand },
    'F15/F16 GPU demand release'
  )
  const hiddenBefore = await mirrorCall(page, 'snapshot')
  await mirrorCall(page, 'requestFrame', 'A')
  const hiddenAfter = await mirrorCall(page, 'snapshot')
  check(
    'hidden one-shot completes then releases',
    hiddenAfter.sources.A.frames > hiddenBefore.sources.A.frames &&
      hiddenAfter.sources.A.demand.pendingFrames === 0 &&
      hiddenAfter.contexts.live === 0,
    {
      before: hiddenBefore.sources.A,
      after: hiddenAfter.sources.A,
      contexts: hiddenAfter.contexts,
    },
    'F15 hidden one-shot'
  )
  for (const id of ['square', 'wide', 'tall'])
    await mirrorCall(page, 'configureView', id, { mounted: false })
  await mirrorCall(page, 'configureSource', 'main', {
    gradient: { animate: 'on' },
  })
  await settle(page)
  const noViews = await mirrorWindow(page, 'no subscribers')
  check(
    'no subscribers stops source frames',
    noViews.before.sources.A.frames === noViews.after.sources.A.frames,
    [noViews.before.sources.A.frames, noViews.after.sources.A.frames],
    'F15 source demand'
  )
  await mirrorCall(page, 'configureSource', 'main', { mounted: false })

  await nativeCall(page, 'externalHost.configure', {
    enabled: true,
    gradients: [{ ...workload, animate: 'off' }],
  })
  await page.evaluate(() => window.__nativePerformance.attach('host'))
  const hostBefore = await page.evaluate(() => ({
    identities: window.__nativePerformance.identities('host'),
    snapshot: window.gradientFixture.snapshot().externalHost,
  }))
  const hostResources = (await probe(page)).three.filter(
    (r) => r.owner === 'host'
  )
  await nativeCall(page, 'externalHost.clear')
  const hostAfter = await page.evaluate(() => ({
    identities: window.__nativePerformance.identities('host'),
    snapshot: window.gradientFixture.snapshot().externalHost,
  }))
  const afterHostProbe = await probe(page)
  check(
    'external host scene/camera/environment/renderer survive',
    hostBefore.identities.renderer === hostAfter.identities.renderer &&
      hostBefore.identities.scene === hostAfter.identities.scene &&
      hostBefore.identities.camera === hostAfter.identities.camera &&
      hostBefore.snapshot.environmentUuid ===
        hostAfter.snapshot.environmentUuid &&
      hostAfter.snapshot.gradientMeshCount === 0,
    { hostBefore, hostAfter },
    'F12 external ownership'
  )
  check(
    'external host resources not disposed by native removal',
    hostResources.length > 0 &&
      hostResources.every(
        (r) => afterHostProbe.three.find((e) => e.id === r.id)?.disposals === 0
      ),
    hostResources,
    'F12 external ownership'
  )
  await nativeCall(page, 'externalHost.configure', {
    enabled: false,
    gradients: [],
  })

  // The baseline includes warm caches, mounted fixture handles and the two fixed examples.
  await nativeCall(page, 'update', {
    ...workload,
    animate: 'off',
    grain: 'on',
    lightType: 'env',
  })
  await resourceCycle(native, false, 'warmup')
  await captureHeapSnapshot(cdp, 'native-warmup')
  for (let index = 1; index <= 100; index++)
    await resourceCycle(native, true, index)
  await captureHeapSnapshot(cdp, 'native-cycle-100')
  const warm = report.warmup
  for (const cycle of report.cycles) {
    check(
      `cycle ${cycle.index}: GL live plateau`,
      Object.entries(cycle.resources).every(
        ([kind, counts]) => counts.live <= (warm.resources[kind]?.live ?? 0)
      ),
      { warm: warm.resources, current: cycle.resources },
      'F12/F14/F15 resource plateau'
    )
    check(
      `cycle ${cycle.index}: no repeated GL deletion growth`,
      Object.entries(cycle.resources).every(
        ([kind, counts]) =>
          counts.duplicateDeletes <=
          (warm.resources[kind]?.duplicateDeletes ?? 0)
      ),
      { warm: warm.resources, current: cycle.resources },
      'F12/F14 scoped GL release'
    )
    check(
      `cycle ${cycle.index}: observer target plateau`,
      cycle.observers.every(
        (entry) =>
          entry.activeTargets <=
          (warm.observers.find((old) => old.kind === entry.kind)
            ?.activeTargets ?? 0)
      ),
      cycle.observers,
      'F12/F15/F16 observer cleanup'
    )
    check(
      `cycle ${cycle.index}: explicit listener plateau`,
      cycle.listeners.activeExplicit <= warm.listeners.activeExplicit,
      { warm: warm.listeners, current: cycle.listeners },
      'F12 controls/listener ownership'
    )
    check(
      `cycle ${cycle.index}: owned Three live plateau`,
      cycle.threeLive.length <= warm.threeLive.length,
      {
        warm: warm.threeLive,
        current: cycle.threeLive,
        duplicates: cycle.threeDuplicateDisposals,
      },
      'F12/F14 disposal ownership'
    )
    check(
      `cycle ${cycle.index}: owned Three terminal release at most once`,
      cycle.threeDuplicateDisposals.length === 0,
      cycle.threeDuplicateDisposals,
      'F12/F14 disposal ownership'
    )
  }
  check(
    '100 measured lifecycle cycles complete',
    report.cycles.length === 100,
    report.cycles.length,
    'F27 lifecycle coverage'
  )
  report.native.finalScripts = await scriptInventory(
    cdp,
    native.scripts,
    'native-final',
    manifest
  )
  await bounded(
    () => native.context.close(),
    5000,
    'close native measurement context'
  )
  contexts.delete(native.context)

  // Sequential contexts avoid racing native and Vue GPU workloads.
  const vue = await createConsumer(options['--vue-url'], 'vue')
  report.vue = {
    errors: vue.errors,
    warnings: vue.warnings,
    network: vue.network,
  }
  await vue.page.evaluate((props) => window.gradientFixture.update(props, 1), {
    ...workload,
    animate: 'off',
  })
  report.scenarios.push({
    name: 'Vue paused baseline existing behavior',
    ...(await observationWindow(vue.page, 500)),
  })
  const vueInventory = await scriptInventory(vue.cdp, vue.scripts, 'vue', {
    ...manifest,
    consumers: [],
  })
  report.provenance.vueServed = vueInventory
  const vueSize = await vue.page.locator('canvas').evaluateAll((canvases) =>
    canvases.map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.getBoundingClientRect().width,
      cssHeight: canvas.getBoundingClientRect().height,
    }))
  )
  check(
    'matched Vue one-output dimensions/DPR',
    vueSize.length === 1 &&
      vueSize[0].width === 480 &&
      vueSize[0].height === 320 &&
      vueSize[0].cssWidth === 480 &&
      vueSize[0].cssHeight === 320,
    vueSize,
    'F27 comparison workload'
  )
  for (const grain of ['off', 'on']) {
    await vue.page.evaluate(() => window.__nativePerformance.raster(true))
    await vue.page.evaluate(
      (props) => window.gradientFixture.update(props, 1),
      { ...workload, grain, animate: 'on' }
    )
    const active = await observationWindow(vue.page, 900)
    await vue.page.evaluate(() => window.__nativePerformance.raster(false))
    const vueOutput = active.last.probe.contexts.findLast(
      (entry) => !entry.lost
    )
    check(
      `Vue grain ${grain}: actual nonclear output`,
      !!vueOutput?.raster &&
        vueOutput.raster.nonclear > 0 &&
        vueOutput.raster.error === 0,
      vueOutput?.raster,
      'F27 paired workload output'
    )
    report.scenarios.push({ name: `Vue active grain ${grain}`, ...active })
    await allocationProfile(
      vue.page,
      vue.cdp,
      `vue-grain-${grain}`,
      'paired 3d lighting/grain workload: existing Vue coverage one-output Mint 480x320 DPR1; pipeline differences preserved',
      vueInventory
    )
    await vue.page.evaluate(() =>
      window.gradientFixture.update({ animate: 'off' }, 1)
    )
    // Existing Vue may keep rendering while paused: record rather than native-budget it.
    report.scenarios.push({
      name: `Vue paused grain ${grain}`,
      ...(await observationWindow(vue.page, 500)),
    })
  }
  await vue.page.evaluate((props) => window.gradientFixture.update(props, 1), {
    ...workload,
    animate: 'off',
    grain: 'on',
    lightType: 'env',
  })
  report.scenarios.push({
    name: 'Vue HDR byte-delivery and paused output observation',
    scope:
      'Separate observation, not paired active-HDR profiling; decoded environment reference is unavailable from the frozen Vue fixture',
    decodedEnvironmentInstalled: null,
    ...(await observationWindow(vue.page, 900)),
  })
  await Promise.all(vue.pendingResponses)
  await Promise.all(native.pendingResponses)
  report.native.hdr = native.hdr
  report.vue.hdr = vue.hdr
  check(
    'native/Vue delivered HDR byte identity (not Vue decode proof)',
    native.hdr.some(
      (left) =>
        left.status === 200 &&
        vue.hdr.some(
          (right) => right.status === 200 && right.sha256 === left.sha256
        )
    ),
    { native: native.hdr, vue: vue.hdr },
    'F27 HDR workload matching'
  )
  await vue.page.emulateMedia({ reducedMotion: 'reduce' })
  report.scenarios.push({
    name: 'Vue reduced-motion existing behavior',
    ...(await observationWindow(vue.page, 500)),
  })
  await vue.page.addStyleTag({
    content: 'main{position:fixed;left:-10000px;top:0}',
  })
  report.scenarios.push({
    name: 'Vue offscreen existing behavior',
    ...(await observationWindow(vue.page, 500)),
  })
  await vue.page.evaluate(() => window.gradientFixture.update({}, 0))
  report.scenarios.push({
    name: 'Vue no output',
    ...(await observationWindow(vue.page, 500)),
  })
  report.vue.finalProbe = await probe(vue.page)
  check(
    'native runtime page errors absent',
    native.errors.length === 0,
    native.errors,
    'owning native runtime source'
  )
  check(
    'two complete post-GC native heap snapshots collected',
    report.heapSnapshots.length === 2 &&
      report.heapSnapshots.every((snapshot) => snapshot.status === 'captured'),
    report.heapSnapshots.map(
      ({ label, status, file, rawBytes, fileBytes, fileSHA256 }) => ({
        label,
        status,
        file,
        rawBytes,
        fileBytes,
        fileSHA256,
      })
    ),
    'F27 heap-retainer evidence'
  )
  check(
    'six complete paired allocation profiles collected',
    report.profiles.length === 6 &&
      report.profiles.every((profile) => profile.raw && profile.sourceSites),
    report.profiles.map(({ label, raw, sourceSites, status }) => ({
      label,
      raw,
      sourceSites,
      status,
    })),
    'F27 complete allocation measurement'
  )
  report.measurementStatus = report.checks.every((entry) => entry.pass)
    ? 'pass'
    : 'fail'
} catch (error) {
  report.measurementStatus = 'error'
  report.error = { message: String(error), stack: error?.stack ?? null }
} finally {
  await cleanup()
  clearTimeout(deadline)
  for (const [signal, handler] of signalHandlers)
    process.removeListener(signal, handler)
  await save('browser.log', browserLog.join(''))
  report.browserLog = {
    path: 'browser.log',
    bytes: browserLogBytes,
    droppedMessages: browserLogDropped,
    limitBytes: 4 * 1024 * 1024,
  }
  if (browserLogDropped > 0) {
    check(
      'raw browser diagnostics retained within budget',
      false,
      report.browserLog,
      'F27 diagnostic evidence budget'
    )
    report.measurementStatus = 'fail'
  }
  report.finishedAt = new Date().toISOString()
  report.output = {
    bytesBeforeReport: bytesWritten,
    filesBeforeReport: filesWritten,
    retained: true,
    purpose: 'F27 reproducible raw measurement evidence',
    expiry: 'parent removes after acceptance; recommended 14 days',
  }
  if (
    report.interruption ||
    report.cleanup.errors?.length ||
    report.cleanup.profileErrors?.length
  )
    report.measurementStatus = 'error'
  const comparatorProfiles = report.profiles.filter(
    (profile) => profile.comparison.consumer === 'vue'
  )
  const comparatorAttributionLimited = comparatorProfiles.some(
    (profile) => profile.sampledSourceEvidence?.complete === false
  )
  report.comparatorCharacterization = {
    measurementStatus:
      report.measurementStatus === 'pass' && comparatorProfiles.length === 2
        ? 'complete'
        : 'incomplete-or-invalid',
    sourceReadiness:
      comparatorProfiles.length !== 2
        ? 'incomplete-population'
        : comparatorAttributionLimited
        ? 'incomplete-unknowns-retained'
        : 'source-ready-not-ownership-certified',
    ownershipCertificate: 'not-offered-descriptive-comparison',
    allUnknownBytesIncludedInTotals: true,
    profiles: comparatorProfiles.map((profile) => ({
      label: profile.label,
      status: profile.status,
      sourceEvidence: profile.sampledSourceEvidence,
    })),
  }
  report.qualificationStatus =
    report.measurementStatus === 'pass'
      ? comparatorAttributionLimited
        ? 'pending-native-allocation-review-with-comparator-attribution-limitations'
        : 'pending-allocation-review'
      : 'blocked-by-measurement'
  report.status =
    report.measurementStatus === 'pass'
      ? comparatorAttributionLimited
        ? 'measured-with-comparator-attribution-limitations'
        : 'measured'
      : report.measurementStatus
  await save('report.json', report)
  console.log(
    JSON.stringify({
      status: report.status,
      measurementStatus: report.measurementStatus,
      qualificationStatus: report.qualificationStatus,
      allocationReview: {
        required: true,
        status: report.allocationReview.status,
      },
      heapReview: { required: true, status: report.heapReview.status },
      report: join(run, 'report.json'),
      failedChecks: report.checks
        .filter((entry) => !entry.pass)
        .map((entry) => ({ name: entry.name, owner: entry.owner })),
    })
  )
  if (report.measurementStatus !== 'pass') process.exitCode = 1
}
