import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page, Route, TestInfo } from '@playwright/test'
import type {
  BufferGeometry,
  Camera,
  Material,
  Mesh,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three'
import type {
  FixtureCanvasConfig,
  FixtureObservation,
  GradientFixture,
} from '../../apps/example-svelte-dev/src/fixture-types'
import {
  installDrawObserver,
  nonblank,
  pixelDifference,
} from './svelte-fixtures'
import { attachEvidence } from './evidence'

/**
 * F24 consumes v1 directly, independently of the feature/mirror suites.
 * The orchestrator owns preparation and nativeLifecycle project metadata:
 * {kind:'plain'|'kit', mode:'development'|'production', supportURL, hmrURL}.
 * supportURL serves the real compiled-public-import /ssr probe and /ownership
 * consumer; hmrURL serves a temporary public consumer plus /status, /apply,
 * /restore. Only the orchestrator edits that copy. These tests never edit apps,
 * prepare packages, manufacture WebGL success, or certify absence of GPU leaks.
 */
interface LifecycleProject {
  kind: 'plain' | 'kit'
  mode: 'development' | 'production'
  supportURL: string
  hmrURL: string
}
interface PublicScene {
  renderer: WebGLRenderer
  scene: Scene
  camera(): Camera
}
interface DisposalEvent {
  id: string
  kind: string
  disposals: number
  owner: 'native' | 'host'
}
interface OwnershipSnapshot {
  mode: string | null
  errors: { code: string; message: string }[]
  host: {
    sceneUuid: string
    cameraUuid: string
    environmentUuid: string | null
    meshUuid: string
    rendererIdentity: number
    contextLost: boolean
  }
  nativeMeshCount: number
  nativeLightCount: number
  resourceEvents: DisposalEvent[]
}
interface HostControls {
  enabled: boolean
  dispose(): void
}
interface OwnershipFixture {
  run(
    mode:
      'missing-context' | 'duplicate-managed-owner' | 'failed-initial-managed'
  ): Promise<OwnershipSnapshot>
  recover(): Promise<OwnershipSnapshot>
  clear(): Promise<OwnershipSnapshot>
  snapshot(): OwnershipSnapshot
  refs(): PublicScene & { hostMesh: Mesh; controls?: HostControls }
  replaceEnvironment(): Promise<OwnershipSnapshot>
}
interface BindingSnapshot {
  mode: 'initialization' | 'render-path'
  phase: 'loading' | 'initial-failure' | 'ready'
  failures: number
  rendererId: string | null
  rendererDisposals: Record<string, number>
  hostAutoRender: boolean | null
}
interface BindingProbe {
  snapshot(): BindingSnapshot
  recoverInitialization(): Promise<void>
  setHostAutoRender(value: boolean): Promise<void>
  frame(): Promise<{ sceneRenders: number; width: number; height: number }>
  removeGradient(): Promise<void>
}
interface RasterFrame {
  offscreen: boolean
  viewport: number[]
  framebuffer: number
  error: number
}
interface LifecycleWindow extends Window {
  __shadergradientBindingProbe: BindingProbe
  gradientFixture: GradientFixture
  gradientLifecycle: {
    refs(): { native: PublicScene | null; host: PublicScene | null }
    classes: { Texture: typeof Texture }
  }
  gradientOwnership: OwnershipFixture
  gradientHmr: {
    snapshot(): {
      marker: string
      color1: string
      canvasIdentity: number
      rendererIdentity: number
      meshUuid: string
      frames: number
      errors: { code: string; message: string }[]
    }
    refs(): PublicScene
  }
  __lifecycleDocument?: string
  __lifecycleSsrWrapper?: Element
  __lifecycleResizeObserver?: typeof ResizeObserver
  __lifecycleObservers?: {
    ownedTargets(root: Element): number[]
    activeTargets(): number[]
    mediaListeners(): number
  }
  __lifecycleHeld?: {
    canvas: HTMLCanvasElement
    gl: WebGLRenderingContext
    extension: WEBGL_lose_context | null
    draws: number
    raster: RasterFrame[]
    restore(): void
  }
  __lifecycleTextures?: {
    events: { id: string; disposals: number }[]
    restore(): void
  }
  __lifecycleHostControls?: {
    object: HostControls
    disposals: number
    restore(): void
  }
  __lifecycleResources?: {
    events: {
      id: string
      kind: 'geometry' | 'material' | 'texture' | 'renderer'
      owner: 'native' | 'host'
      meshUuid: string | null
      calls: number
      disposals: number | null
    }[]
    restore(): void
    scan(): void
  }
}

function project(info: TestInfo): LifecycleProject | undefined {
  const value = info.project.metadata.nativeLifecycle as
    LifecycleProject | undefined
  if (!value && /svelte/i.test(info.project.name)) {
    throw new Error(
      'Native lifecycle project requires metadata.nativeLifecycle; missing metadata is not a passing scenario.'
    )
  }
  return value
}

function mainWrapper(page: Page) {
  return page
    .locator(
      '[data-testid="gradient-wrapper"], [data-testid="managed-placement"]'
    )
    .first()
}

async function snapshot(page: Page): Promise<FixtureObservation> {
  return page.evaluate(() =>
    (window as unknown as LifecycleWindow).gradientFixture.snapshot()
  )
}

async function update(
  page: Page,
  patch: Parameters<GradientFixture['update']>[0]
) {
  return page.evaluate(
    (patch) =>
      (window as unknown as LifecycleWindow).gradientFixture.update(patch),
    patch
  )
}

async function configure(page: Page, patch: FixtureCanvasConfig) {
  return page.evaluate(
    (patch) =>
      (window as unknown as LifecycleWindow).gradientFixture.configureCanvas(
        patch
      ),
    patch
  )
}

async function mounted(page: Page, value: boolean) {
  return page.evaluate(
    (value) =>
      (
        window as unknown as LifecycleWindow
      ).gradientFixture.lifecycle.setMounted(value),
    value
  )
}

async function visible(page: Page, value: boolean) {
  return page.evaluate(
    (value) =>
      (
        window as unknown as LifecycleWindow
      ).gradientFixture.lifecycle.setVisible(value),
    value
  )
}

async function requestFrame(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as LifecycleWindow
    ).gradientFixture.lifecycle.requestFrame()
  )
}

async function ready(page: Page) {
  await mainWrapper(page).scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const state = await snapshot(page)
      return (
        !!state.canvas &&
        !state.canvas.contextLost &&
        state.scene?.meshes.length === 1 &&
        state.fallback === null
      )
    })
    .toBe(true)
  expect((await snapshot(page)).counters.completedFrames).toBeGreaterThan(0)
}

async function open(page: Page, url = '/') {
  await page.goto(url)
  await page.waitForFunction(
    () => (window as unknown as LifecycleWindow).gradientFixture?.version === 1
  )
  await ready(page)
  await page.evaluate(() =>
    (
      window as unknown as LifecycleWindow
    ).gradientFixture.externalHost.configure({ enabled: false, gradients: [] })
  )
  await configure(page, {
    preserveDrawingBuffer: true,
    respectReducedMotion: true,
    lazyLoad: true,
  })
  await update(page, {
    control: 'props',
    urlString: '',
    animate: 'off',
    uTime: 4,
    uSpeed: 1,
    loop: 'off',
    range: 'disabled',
    grain: 'off',
    lightType: '3d',
    shader: 'defaults',
    type: 'plane',
    enableTransition: false,
    zoomOut: false,
    color1: '#ff2255',
    color2: '#2266ff',
    color3: '#ffee99',
  })
  await ready(page)
}

async function bindingSnapshot(page: Page): Promise<BindingSnapshot> {
  return page.evaluate(() =>
    (
      window as unknown as LifecycleWindow
    ).__shadergradientBindingProbe.snapshot()
  )
}

async function openBindingRegression(
  page: Page,
  mode: BindingSnapshot['mode']
) {
  await installDrawObserver(page)
  await page.goto(`/?binding-regression=${mode}`)
  const webgl2 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    const available = !!gl && !gl.isContextLost()
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return available
  })
  expect(
    webgl2,
    'This rendered native regression requires actual WebGL2; unsupported capability is not a passing recovery or render-path scenario'
  ).toBe(true)
  await page.waitForFunction(
    () => !!(window as unknown as LifecycleWindow).__shadergradientBindingProbe
  )
  await expect(page.getByTestId('binding-regression')).toBeVisible()
}

async function bindingFrame(page: Page) {
  const canvas = page.getByTestId('binding-regression').locator('canvas')
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toBeVisible()
  const before = await canvas.evaluate(
    (element) =>
      window.nativeFeatureDraws
        .get(element as HTMLCanvasElement)
        ?.findLast((draw) => draw.linked && draw.pixels !== null)?.serial ?? 0
  )
  const frame = await page.evaluate(() =>
    (window as unknown as LifecycleWindow).__shadergradientBindingProbe.frame()
  )
  expect(
    frame.sceneRenders,
    'One explicitly invalidated scheduler frame must draw the actual main scene exactly once, excluding fullscreen postprocessing scenes'
  ).toBe(1)
  expect(frame.width).toBeGreaterThan(0)
  expect(frame.height).toBeGreaterThan(0)
  const completed = await canvas.evaluate((element) =>
    window.nativeFeatureDraws
      .get(element as HTMLCanvasElement)
      ?.findLast((draw) => draw.linked && draw.pixels !== null)
  )
  expect(
    completed?.serial ?? 0,
    'The requested frame must complete a fresh actual linked default-framebuffer draw, not reuse stale pixel evidence'
  ).toBeGreaterThan(before)
  return { frame, image: await nonblank(canvas) }
}

async function refsAvailable(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as LifecycleWindow).gradientLifecycle?.refs()
            .native
      )
    )
    .toBe(true)
}

async function holdNativeContext(page: Page) {
  await refsAvailable(page)
  return page.evaluate(() => {
    const state = window as unknown as LifecycleWindow
    state.__lifecycleHeld?.restore()
    const native = state.gradientLifecycle.refs().native!
    const gl = native.renderer.getContext()
    const originalElements = gl.drawElements
    const originalArrays = gl.drawArrays
    const held = {
      canvas: native.renderer.domElement,
      gl,
      extension: gl.getExtension('WEBGL_lose_context'),
      draws: 0,
      raster: [] as RasterFrame[],
      restore() {
        gl.drawElements = originalElements
        gl.drawArrays = originalArrays
      },
    }
    const record = () => {
      held.draws++
      held.raster.push({
        offscreen: gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null,
        viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
        framebuffer: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
        error: gl.getError(),
      })
    }
    gl.drawElements = function (...args: Parameters<typeof originalElements>) {
      const result = originalElements.apply(gl, args)
      record()
      return result
    }
    gl.drawArrays = function (...args: Parameters<typeof originalArrays>) {
      const result = originalArrays.apply(gl, args)
      record()
      return result
    }
    state.__lifecycleHeld = held
    return { extension: !!held.extension }
  })
}
async function watchNativeMeshResources(
  page: Page,
  channel: 'native' | 'host' = 'native'
) {
  return page.evaluate((channel) => {
    const state = window as unknown as LifecycleWindow
    state.__lifecycleResources?.restore()
    const events: NonNullable<
      LifecycleWindow['__lifecycleResources']
    >['events'] = []
    const cleanup: (() => void)[] = []
    const observed = new WeakSet<object>()
    const nativeMeshes = new Set<string>()
    const observe = (
      resource: BufferGeometry | Material | Texture | WebGLRenderer,
      kind: 'geometry' | 'material' | 'texture' | 'renderer',
      owner: 'native' | 'host',
      meshUuid: string | null
    ) => {
      if (observed.has(resource)) return
      observed.add(resource)
      const id =
        'uuid' in resource
          ? resource.uuid
          : `renderer:${
              state.gradientFixture.snapshot().externalHost!.rendererIdentity
            }`
      const entry = {
        id,
        kind,
        owner,
        meshUuid,
        calls: 0,
        disposals: kind === 'renderer' ? null : 0,
      }
      events.push(entry)
      const original = resource.dispose
      const onDispose = () => {
        entry.disposals = entry.disposals! + 1
      }
      const dispose = () => {
        entry.calls++
        return original.call(resource)
      }
      resource.dispose = dispose
      const eventResource =
        kind === 'renderer'
          ? null
          : (resource as BufferGeometry | Material | Texture)
      eventResource?.addEventListener('dispose', onDispose)
      cleanup.push(() => {
        if (resource.dispose === dispose) resource.dispose = original
        eventResource?.removeEventListener('dispose', onDispose)
      })
    }
    const scan = () => {
      const target = state.gradientLifecycle.refs()[channel]
      if (!target)
        throw new Error(
          `Cannot observe disposal without the actual ${channel} scene`
        )
      target.scene.traverse((object) => {
        const mesh = object as Mesh
        if (!mesh.isMesh) return
        const owner = mesh.name === 'shadergradient-mesh' ? 'native' : 'host'
        if (channel === 'native' && owner !== 'native') return
        if (owner === 'native') nativeMeshes.add(mesh.uuid)
        observe(mesh.geometry, 'geometry', owner, mesh.uuid)
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]) {
          observe(material, 'material', owner, mesh.uuid)
        }
      })
      if (channel === 'host') {
        if (target.scene.environment)
          observe(target.scene.environment, 'texture', 'host', null)
        observe(target.renderer, 'renderer', 'host', null)
      }
    }
    scan()
    if (nativeMeshes.size === 0)
      throw new Error('Cannot observe disposal without actual native meshes')
    state.__lifecycleResources = {
      events,
      scan,
      restore() {
        for (const remove of cleanup) remove()
      },
    }
    return [...nativeMeshes]
  }, channel)
}

async function pixels(page: Page, host = false) {
  return page.evaluate((host) => {
    const refs = (window as unknown as LifecycleWindow).gradientLifecycle.refs()
    const target = host ? refs.host : refs.native
    if (!target)
      throw new Error('Actual public consumer renderer ref is unavailable')
    const renderer = target.renderer
    const gl = renderer.getContext()
    if (gl.isContextLost())
      throw new Error('Cannot sample a lost context as ready output')
    if (renderer.getRenderTarget() !== null)
      throw new Error(
        'Expected completed screen output, not a pending offscreen target'
      )
    const pixel = new Uint8Array(4)
    const colors = new Set<string>()
    let hash = 2166136261
    let alpha = 0
    const clear = Array.from(
      gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array
    )
    let nonClearSamples = 0
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        gl.readPixels(
          Math.min(
            gl.drawingBufferWidth - 1,
            Math.floor(((x + 0.5) * gl.drawingBufferWidth) / 12)
          ),
          Math.min(
            gl.drawingBufferHeight - 1,
            Math.floor(((y + 0.5) * gl.drawingBufferHeight) / 12)
          ),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel
        )
        colors.add(`${pixel[0]},${pixel[1]},${pixel[2]}`)
        alpha += pixel[3]
        if (
          pixel.some(
            (byte, channel) => byte !== Math.round(clear[channel] * 255)
          )
        )
          nonClearSamples++
        for (const byte of pixel) hash = Math.imul(hash ^ byte, 16777619) >>> 0
      }
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    return {
      hash,
      colors: colors.size,
      alpha,
      nonClearSamples,
      clear,
      linked: !!program && !!gl.getProgramParameter(program, gl.LINK_STATUS),
      drawCalls: renderer.info.render.calls,
      error: gl.getError(),
      framebuffer: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    }
  }, host)
}

async function expectPixels(page: Page) {
  const result = await pixels(page)
  expect(result.error).toBe(0)
  expect(result.framebuffer).toBe(0x8cd5) // FRAMEBUFFER_COMPLETE, not an inventory of internal targets.
  expect(result.alpha).toBeGreaterThan(0)
  expect(result.linked).toBe(true)
  expect(result.drawCalls).toBeGreaterThan(0)
  expect(result.nonClearSamples).toBeGreaterThan(0)
  return result
}

/** Browser rAF is only an observation window, never evidence of a renderer frame. */
async function observeWindow(page: Page, milliseconds = 350) {
  return page.evaluate(async (milliseconds) => {
    const fixture = (window as unknown as LifecycleWindow).gradientFixture
    const start = performance.now()
    const first = fixture.snapshot()
    let last = first
    let minimum = first.scene?.meshes[0]?.time ?? null
    let maximum = minimum
    do {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      )
      last = fixture.snapshot()
      const time = last.scene?.meshes[0]?.time
      if (time !== undefined) {
        minimum = minimum === null ? time : Math.min(minimum, time)
        maximum = maximum === null ? time : Math.max(maximum, time)
      }
    } while (performance.now() - start < milliseconds)
    return {
      first,
      last,
      minimum,
      maximum,
      elapsed: (performance.now() - start) / 1000,
    }
  }, milliseconds)
}

async function expectIdle(page: Page, milliseconds = 350) {
  // Let finite controls/initial invalidations settle, then observe another full window.
  await observeWindow(page, 100)
  const observation = await observeWindow(page, milliseconds)
  expect(observation.maximum).toBe(observation.minimum)
  expect(observation.last.counters.completedFrames).toBe(
    observation.first.counters.completedFrames
  )
  expect(observation.last.counters.rendererCalls).toBe(
    observation.first.counters.rendererCalls
  )
  return observation
}

async function watchTextures(page: Page) {
  await refsAvailable(page)
  await page.evaluate(() => {
    const state = window as unknown as LifecycleWindow
    const prototype = state.gradientLifecycle.classes.Texture.prototype
    const original = prototype.dispose
    const counts = new Map<string, number>()
    const events: { id: string; disposals: number }[] = []
    const wrapped = function (this: Texture) {
      // Only the decoded 2×2 diagnostic HDR image is in this measurement scope.
      // Other examples, host textures and PMREM/composer targets are not late-HDR
      // evidence, even if their disposal happens during the same observation window.
      const image = this.image as {
        width?: number
        height?: number
        data?: ArrayLike<number>
      } | null
      if (
        !(this as Texture & { isDataTexture?: boolean }).isDataTexture ||
        image?.width !== 2 ||
        image.height !== 2 ||
        image.data?.length !== 16
      )
        return original.call(this)
      const count = (counts.get(this.uuid) ?? 0) + 1
      counts.set(this.uuid, count)
      const entry = events.find((event) => event.id === this.uuid)
      if (entry) entry.disposals = count
      else events.push({ id: this.uuid, disposals: count })
      return original.call(this)
    }
    prototype.dispose = wrapped
    state.__lifecycleTextures = {
      events,
      restore() {
        if (prototype.dispose === wrapped) prototype.dispose = original
      },
    }
  })
}

async function textureEvents(page: Page) {
  return page.evaluate(
    () => (window as unknown as LifecycleWindow).__lifecycleTextures!.events
  )
}

const hdr = Buffer.concat([
  Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n'),
  Buffer.from([
    128, 64, 32, 129, 32, 128, 64, 129, 64, 32, 128, 129, 128, 128, 128, 129,
  ]),
])

async function fulfillHDR(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: hdr,
  })
}

async function configureHDR(
  page: Page,
  base: string,
  preset: 'city' | 'dawn' | 'lobby' = 'city'
) {
  await configure(page, { envBasePath: base })
  return update(page, { lightType: 'env', envPreset: preset, animate: 'off' })
}

function browserErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      /hydration/i.test(message.text()) &&
      ['warning', 'error'].includes(message.type())
    )
      errors.push(message.text())
  })
  return errors
}
async function instrumentOwnedObservers(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as LifecycleWindow
    const identities = new WeakMap<Element, number>()
    let nextIdentity = 0
    const identity = (element: Element) => {
      let id = identities.get(element)
      if (id === undefined) {
        id = ++nextIdentity
        identities.set(element, id)
      }
      return id
    }
    const observed: Set<Element>[] = []
    for (const name of ['IntersectionObserver', 'ResizeObserver'] as const) {
      const Original = window[name]
      if (!Original) continue
      // Construct the real browser observer and forward every operation unchanged.
      // This records ownership; it never delivers synthetic visibility/size entries.
      const wrapped = new Proxy(Original, {
        construct(target, args) {
          const observer = Reflect.construct(target, args) as ResizeObserver
          const targets = new Set<Element>()
          observed.push(targets)
          const observe = observer.observe
          const unobserve = observer.unobserve
          const disconnect = observer.disconnect
          observer.observe = function (...args: Parameters<typeof observe>) {
            targets.add(args[0])
            return observe.apply(observer, args)
          }
          observer.unobserve = function (
            ...args: Parameters<typeof unobserve>
          ) {
            targets.delete(args[0])
            return unobserve.apply(observer, args)
          }
          observer.disconnect = function () {
            targets.clear()
            return disconnect.call(observer)
          }
          return observer
        },
      })
      Object.defineProperty(window, name, {
        configurable: true,
        value: wrapped,
      })
    }
    const listenerSets: Set<EventListenerOrEventListenerObject>[] = []
    const match = window.matchMedia
    window.matchMedia = function (query) {
      const media = match.call(window, query)
      if (query !== '(prefers-reduced-motion: reduce)') return media
      const listeners = new Set<EventListenerOrEventListenerObject>()
      listenerSets.push(listeners)
      const add = media.addEventListener
      const remove = media.removeEventListener
      media.addEventListener = function (...args: Parameters<typeof add>) {
        if (args[0] === 'change' && args[1]) listeners.add(args[1])
        return add.apply(media, args)
      }
      media.removeEventListener = function (
        ...args: Parameters<typeof remove>
      ) {
        if (args[0] === 'change' && args[1]) listeners.delete(args[1])
        return remove.apply(media, args)
      }
      return media
    }
    state.__lifecycleObservers = {
      ownedTargets(root) {
        return observed.flatMap((targets) =>
          [...targets]
            .filter((element) => element !== root && root.contains(element))
            .map(identity)
        )
      },
      activeTargets() {
        return observed.flatMap((targets) => [...targets].map(identity))
      },
      mediaListeners() {
        return listenerSets.reduce(
          (count, listeners) => count + listeners.size,
          0
        )
      },
    }
  })
}

async function supportOwnership(page: Page, info: TestInfo) {
  const config = project(info)!
  expect(
    config.supportURL,
    'Orchestrator must provision the real ownership consumer'
  ).toBeTruthy()
  await page.goto(`${config.supportURL.replace(/\/$/, '')}/ownership`)
  await page.waitForFunction(
    () => !!(window as unknown as LifecycleWindow).gradientOwnership
  )
}

function expectHostPreserved(
  before: OwnershipSnapshot,
  after: OwnershipSnapshot,
  environment = before.host.environmentUuid
) {
  expect(after.host.sceneUuid).toBe(before.host.sceneUuid)
  expect(after.host.cameraUuid).toBe(before.host.cameraUuid)
  expect(after.host.meshUuid).toBe(before.host.meshUuid)
  expect(after.host.rendererIdentity).toBe(before.host.rendererIdentity)
  expect(after.host.environmentUuid).toBe(environment)
  expect(after.host.contextLost).toBe(false)
}

async function assertOwnedEvents(
  page: Page,
  info: TestInfo,
  events: DisposalEvent[]
) {
  // Scope is the resources the consumer actually instrumented, never all GPU allocations.
  const native = events.filter((event) => event.owner === 'native')
  const host = events.filter((event) => event.owner === 'host')
  expect(
    native.length,
    'The consumer must observe at least one native-owned resource'
  ).toBeGreaterThan(0)
  expect(
    host.length,
    'Host-owned resources must remain independently observable'
  ).toBeGreaterThan(0)
  for (const event of native)
    expect(event.disposals, `${event.kind}:${event.id}`).toBe(1)
  for (const event of host)
    expect(event.disposals, `${event.kind}:${event.id}`).toBe(0)
  await attachEvidence(info, 'observed-owned-disposals', {
    body: JSON.stringify(events, null, 2),
    contentType: 'application/json',
  })
  const hostLost = await page.evaluate(() =>
    (window as unknown as LifecycleWindow).gradientOwnership
      .refs()
      .renderer.getContext()
      .isContextLost()
  )
  expect(hostLost).toBe(false)
}

test.beforeEach(async ({}, info) => {
  test.skip(
    !project(info),
    'Native lifecycle scenarios belong to the explicitly configured native projects'
  )
})

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return
  await page.evaluate(() => {
    const state = window as unknown as LifecycleWindow
    state.__lifecycleHeld?.restore()
    state.__lifecycleTextures?.restore()
    state.__lifecycleResources?.restore()
    state.__lifecycleHostControls?.restore()
  })
})

test.describe('compiled SSR and production HTML are separate evidence', () => {
  test('public native imports render through the real Svelte server compiler without browser globals', async ({
    request,
  }, info) => {
    const config = project(info)!
    expect(config.supportURL).toBeTruthy()
    const response = await request.get(
      `${config.supportURL.replace(/\/$/, '')}/ssr`
    )
    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.browserGlobalsAbsent).toBe(true)
    if (result.browserGlobalReads !== null)
      expect(result.browserGlobalReads).toEqual([])
    expect(result.assetRequests).toBe(0)
    if (result.canvasConstructs !== null)
      expect(result.canvasConstructs).toBe(0)
    expect(result.publicImports).toEqual(
      expect.arrayContaining(['ShaderGradientCanvas', 'ShaderGradient'])
    )
    expect(result.identicalFreshRequests).toBe(true)
    expect(result.html).not.toMatch(/<canvas(?:\s|>)/i)
    expect(result.html).toMatch(/deferred/)
    await attachEvidence(info, 'compiled-public-ssr', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
  })

  test('production Kit HTTP HTML retains surrounding SSR content and a deferred wrapper without server canvas output', async ({
    request,
  }, info) => {
    const config = project(info)!
    test.skip(
      config.kind !== 'kit' || config.mode !== 'production',
      'Requires the adapter-node production Kit project'
    )
    const response = await request.get(
      '/?request=ssr-only&color1=%231122ee&lightType=env&envPreset=city'
    )
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('text/html')
    const html = await response.text()
    expect(html).not.toMatch(/<canvas(?:\s|>)/i)
    expect(html).toContain('data-testid="ssr-content"')
    expect(html).toContain('data-native-fallback="deferred"')
    expect(html).toContain('data-request="ssr-only"')
    expect(html).toContain('data-color1="#1122ee"')
    await attachEvidence(info, 'production-http-html', {
      body: html,
      contentType: 'text/html',
    })
  })

  test('JavaScript-disabled production Kit displays a meaningful dimensioned fallback and usable surrounding page', async ({
    browser,
    baseURL,
  }, info) => {
    const config = project(info)!
    test.skip(
      config.kind !== 'kit' || config.mode !== 'production',
      'Requires production server HTML in a JavaScript-disabled browser'
    )
    const url =
      '/?request=ssr-only&color1=%231122ee&lightType=env&envPreset=city'
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    const assets: string[] = []
    page.on('request', (request) => {
      if (/\.hdr(?:\?|$)/i.test(request.url())) assets.push(request.url())
    })
    try {
      await page.goto(url)
      await expect(page.getByTestId('ssr-content')).toBeVisible()
      await expect(page.getByTestId('request-settings')).toHaveAttribute(
        'data-request',
        'ssr-only'
      )
      await expect(page.getByTestId('request-settings')).toHaveAttribute(
        'data-color1',
        '#1122ee'
      )
      const fallback = page.getByTestId('native-fallback')
      await expect(fallback).toHaveAttribute('data-native-fallback', 'deferred')
      expect((await fallback.innerText()).trim().length).toBeGreaterThan(20)
      const box = await fallback.boundingBox()
      expect(box!.width).toBeGreaterThan(100)
      expect(box!.height).toBeGreaterThan(100)
      await expect(page.getByTestId('away-link')).toBeVisible()
      await expect(page.locator('canvas')).toHaveCount(0)
      expect(assets).toEqual([])
      await attachEvidence(info, 'javascript-disabled-production', {
        body: JSON.stringify({
          bounds: box,
          text: await fallback.innerText(),
          hdrRequests: assets,
        }),
        contentType: 'application/json',
      })
    } finally {
      await context.close()
    }
  })

  test('concurrent production requests and separately hydrated trees keep distinguishable settings isolated', async ({
    browser,
    request,
    baseURL,
  }, info) => {
    const config = project(info)!
    test.skip(
      config.kind !== 'kit' || config.mode !== 'production',
      'Requires production request handling'
    )
    const alpha =
      '/?request=alpha&color1=%231122ee&uTime=11&animate=off&grain=off&type=sphere'
    const beta =
      '/?request=beta&color1=%23ee2211&uTime=23&animate=off&grain=off&shader=positionMix&type=waterPlane'
    const responses = await Promise.all([
      request.get(alpha),
      request.get(beta),
      request.get(alpha),
    ])
    const html = await Promise.all(responses.map((response) => response.text()))
    for (const response of responses) expect(response.ok()).toBe(true)
    expect(html[0]).toBe(html[2])
    expect(html[0]).toContain('data-request="alpha"')
    expect(html[0]).toContain('data-color1="#1122ee"')
    expect(html[1]).toContain('data-request="beta"')
    expect(html[1]).toContain('data-color1="#ee2211"')
    expect(html[0]).not.toContain('data-request="beta"')
    const contexts = await Promise.all([
      browser.newContext({ baseURL }),
      browser.newContext({ baseURL }),
    ])
    try {
      const pages = await Promise.all(
        contexts.map((context) => context.newPage())
      )
      await Promise.all(
        pages.map(async (page, index) => {
          const errors = browserErrors(page)
          await page.goto(index ? beta : alpha)
          await page.waitForFunction(
            () => !!(window as unknown as LifecycleWindow).gradientFixture
          )
          await ready(page)
          await configure(page, { preserveDrawingBuffer: true })
          await requestFrame(page)
          const state = await snapshot(page)
          expect(state.scene!.meshes[0].time).toBe(index ? 23 : 11)
          expect(state.scene!.meshes[0].type).toBe(
            index ? 'waterPlane' : 'sphere'
          )
          expect(state.scene!.meshes[0].colors[0]).toEqual(
            index
              ? [238 / 255, 34 / 255, 17 / 255]
              : [17 / 255, 34 / 255, 238 / 255]
          )
          await expectPixels(page)
          expect(errors).toEqual([])
        })
      )
      await update(pages[0], { control: 'props', color1: '#00ff00', uTime: 5 })
      expect((await snapshot(pages[1])).scene!.meshes[0].time).toBe(23)
      expect((await snapshot(pages[1])).scene!.meshes[0].colors[0]).toEqual([
        238 / 255,
        34 / 255,
        17 / 255,
      ])
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })

  test('production hydration reuses the actual SSR wrapper without mismatches and completes real rendered output', async ({
    page,
  }, info) => {
    const config = project(info)!
    test.skip(
      config.kind !== 'kit' || config.mode !== 'production',
      'Requires production hydration and client navigation'
    )
    const errors = browserErrors(page)
    let releaseScripts!: () => void
    const scripts = new Promise<void>((resolve) => {
      releaseScripts = resolve
    })
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scripts
      await route.continue()
    })
    try {
      await page.goto(
        '/?request=navigation&color1=%23ee2211&uTime=23&animate=off&grain=off',
        { waitUntil: 'commit' }
      )
      await expect(page.getByTestId('native-fallback')).toHaveAttribute(
        'data-native-fallback',
        'deferred'
      )
      await expect(page.locator('canvas')).toHaveCount(0)
      await page.evaluate(() => {
        const state = window as unknown as LifecycleWindow
        state.__lifecycleSsrWrapper =
          document.querySelector('.managed-gradient')!
        if (!state.__lifecycleSsrWrapper)
          throw new Error(
            'SSR must include the native wrapper before scripts execute'
          )
      })
    } finally {
      releaseScripts()
    }
    await page.waitForFunction(
      () => !!(window as unknown as LifecycleWindow).gradientFixture
    )
    await ready(page)
    expect(
      await page.evaluate(
        () =>
          (window as unknown as LifecycleWindow).__lifecycleSsrWrapper ===
          document.querySelector('.managed-gradient')
      )
    ).toBe(true)
    await configure(page, { preserveDrawingBuffer: true })
    const bounds = await mainWrapper(page).boundingBox()
    expect(bounds!.height).toBeGreaterThan(100)
    await expect(page.getByTestId('ssr-content')).toBeVisible()
    await expectPixels(page)
    expect(errors).toEqual([])
  })

  test('production client navigation updates request settings and repeated away/back releases old owned GL before remount', async ({
    page,
  }, info) => {
    const config = project(info)!
    test.skip(
      config.kind !== 'kit' || config.mode !== 'production',
      'Requires production SPA navigation'
    )
    const errors = browserErrors(page)
    await page.goto(
      '/?request=navigation&color1=%23ee2211&uTime=23&animate=off&grain=off'
    )
    await page.waitForFunction(
      () => !!(window as unknown as LifecycleWindow).gradientFixture
    )
    await ready(page)
    await page.evaluate(() => {
      ;(window as unknown as LifecycleWindow).__lifecycleDocument =
        'same-spa-document'
    })
    await page.getByRole('link', { name: 'Ocean request', exact: true }).click()
    await expect(page.getByTestId('request-settings')).toHaveAttribute(
      'data-request',
      'ocean'
    )
    await expect
      .poll(async () => (await snapshot(page)).scene?.meshes[0]?.colors[0])
      .toEqual([34 / 255, 128 / 255, 204 / 255])
    await configure(page, { preserveDrawingBuffer: true })
    await requestFrame(page)
    await expectPixels(page)
    await page.evaluate(() => {
      ;(window as unknown as LifecycleWindow).__lifecycleDocument =
        'same-spa-document'
    })
    for (let cycle = 0; cycle < 3; cycle++) {
      await holdNativeContext(page)
      const oldIdentity = (await snapshot(page)).canvas!.identity
      await page.getByTestId('away-link').click()
      await expect(page).toHaveURL(/\/away(?:\?|$)/)
      await expect(page.locator('canvas')).toHaveCount(0)
      expect(
        await page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).gradientFixture === undefined
        )
      ).toBe(true)
      expect(
        await page.evaluate(() =>
          (
            window as unknown as LifecycleWindow
          ).__lifecycleHeld!.gl.isContextLost()
        )
      ).toBe(true)
      await page.getByRole('link', { name: /back.*gradient/i }).click()
      await page.waitForFunction(
        () => !!(window as unknown as LifecycleWindow).gradientFixture
      )
      await ready(page)
      expect(
        await page.evaluate(
          () => (window as unknown as LifecycleWindow).__lifecycleDocument
        )
      ).toBe('same-spa-document')
      // Identities are fixture-local and may restart; actual held DOM/GL refs must differ.
      expect(
        await page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).gradientLifecycle.refs()
              .native!.renderer.domElement !==
            (window as unknown as LifecycleWindow).__lifecycleHeld!.canvas
        )
      ).toBe(true)
      expect(oldIdentity).toBeGreaterThan(0)
      await configure(page, { preserveDrawingBuffer: true })
      await expectPixels(page)
    }
    expect(errors).toEqual([])
  })
})

test.describe('owned lifecycle and motion', () => {
  test('owned observer targets and reduced-motion subscriptions are removed on teardown and rebound once on remount', async ({
    page,
  }) => {
    await instrumentOwnedObservers(page)
    await open(page)
    const before = await mainWrapper(page).evaluate((element) => {
      const observation = (window as unknown as LifecycleWindow)
        .__lifecycleObservers!
      return {
        targets: observation.ownedTargets(element),
        media: observation.mediaListeners(),
      }
    })
    expect(before.targets.length).toBeGreaterThan(0)
    expect(before.media).toBeGreaterThan(0)
    await mounted(page, false)
    const after = await page.evaluate(() => {
      const observation = (window as unknown as LifecycleWindow)
        .__lifecycleObservers!
      return {
        targets: observation.activeTargets(),
        media: observation.mediaListeners(),
      }
    })
    expect(before.targets.filter((id) => after.targets.includes(id))).toEqual(
      []
    )
    expect(after.media).toBeLessThan(before.media)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect((await snapshot(page)).scene).toBeNull()
    await mounted(page, true)
    await ready(page)
    const rebound = await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__lifecycleObservers!.mediaListeners()
    )
    expect(rebound).toBe(before.media)
    await expectIdle(page)
  })

  test('repeated mount/unmount/remount loses only the old owned GL and releases observed mesh resources', async ({
    page,
  }, info) => {
    const errors = browserErrors(page)
    await open(page)
    const disposals: unknown[] = []
    for (let cycle = 0; cycle < 4; cycle++) {
      const before = await snapshot(page)
      await watchNativeMeshResources(page)
      await holdNativeContext(page)
      await mounted(page, false)
      const after = await snapshot(page)
      expect(after.scene).toBeNull()
      expect(after.canvas).toBeNull()
      expect(
        await page.evaluate(() =>
          (
            window as unknown as LifecycleWindow
          ).__lifecycleHeld!.gl.isContextLost()
        )
      ).toBe(true)
      const resources = await page.evaluate(
        () =>
          (window as unknown as LifecycleWindow).__lifecycleResources!.events
      )
      await attachEvidence(info, `native-mesh-disposals-cycle-${cycle}`, {
        body: JSON.stringify({
          resources,
          before: before.counters,
          after: after.counters,
        }),
        contentType: 'application/json',
      })
      expect(
        resources.some(
          (resource) =>
            resource.kind === 'geometry' &&
            resource.id === before.scene!.meshes[0].geometryUuid
        )
      ).toBe(true)
      for (const resource of resources) {
        expect(
          resource.calls,
          `${resource.kind} ${resource.id} dispose calls`
        ).toBe(1)
        expect(
          resource.disposals,
          `${resource.kind} ${resource.id} dispose events`
        ).toBe(1)
      }
      expect(
        after.counters.rendererDisposals - before.counters.rendererDisposals
      ).toBe(1)
      await observeWindow(page, 100)
      expect((await snapshot(page)).counters.rendererDisposals).toBe(
        after.counters.rendererDisposals
      )
      disposals.push({ resources, counters: after.counters })
      await mounted(page, true)
      await ready(page)
      expect((await snapshot(page)).scene!.meshes[0].time).toBe(4)
      expect((await snapshot(page)).canvas!.rendererIdentity).not.toBe(
        before.canvas!.rendererIdentity
      )
      await expectPixels(page)
    }
    expect(errors).toEqual([])
    await attachEvidence(info, 'scoped-mount-cycle-events-not-gpu-leak-proof', {
      body: JSON.stringify(disposals),
      contentType: 'application/json',
    })
  })

  test('lazy offscreen exit fully releases the owned scene and reentry starts at the current seek', async ({
    page,
  }) => {
    await open(page)
    await update(page, { animate: 'on', uTime: 7 })
    await expect
      .poll(async () => (await snapshot(page)).scene!.meshes[0].time)
      .toBeGreaterThan(7.05)
    const old = await snapshot(page)
    await holdNativeContext(page)
    await visible(page, false)
    const deferred = await snapshot(page)
    expect(deferred.visible).toBe(false)
    expect(deferred.fallback).toBe('deferred')
    expect(deferred.canvas).toBeNull()
    expect(deferred.scene).toBeNull()
    expect(
      await page.evaluate(() =>
        (
          window as unknown as LifecycleWindow
        ).__lifecycleHeld!.gl.isContextLost()
      )
    ).toBe(true)
    const idle = await observeWindow(page)
    expect(idle.last.counters.rendererCalls).toBe(
      idle.first.counters.rendererCalls
    )
    await update(page, { animate: 'off', uTime: 19 })
    expect((await snapshot(page)).canvas).toBeNull()
    await visible(page, true)
    await ready(page)
    const reentered = await snapshot(page)
    expect(reentered.canvas!.rendererIdentity).not.toBe(
      old.canvas!.rendererIdentity
    )
    expect(reentered.scene!.uuid).not.toBe(old.scene!.uuid)
    expect(reentered.scene!.meshes[0].time).toBe(19)
    await expectPixels(page)
  })

  test('missing IntersectionObserver uses meaningful eager/resize fallback rather than a stalled blank scene', async ({
    page,
  }, info) => {
    const observer = 'IntersectionObserver'
    const config = project(info)!
    const kitRouterNeedsIO =
      config.kind === 'kit' && observer === 'IntersectionObserver'
    const removeObserver = (name: string) => {
      Object.defineProperty(window, name, {
        configurable: true,
        value: undefined,
      })
    }
    if (!kitRouterNeedsIO) await page.addInitScript(removeObserver, observer)
    const errors = browserErrors(page)
    await open(page)
    if (kitRouterNeedsIO) {
      // Kit 3.1's router itself requires IO at startup. Exercise a genuinely
      // observer-less FIRST mount of a fresh native Canvas after router boot,
      // rather than claiming the unrelated router supports this environment.
      await mounted(page, false)
      await page.evaluate(removeObserver, observer)
      await mounted(page, true)
      await ready(page)
    }
    expect(
      await page.evaluate(
        (name) => typeof (window as unknown as Record<string, unknown>)[name],
        observer
      )
    ).toBe('undefined')
    await attachEvidence(info, 'missing-observer-scope', {
      body: JSON.stringify({
        observer,
        kind: config.kind,
        absence: kitRouterNeedsIO
          ? 'before-first-mount-of-fresh-native-Canvas-after-router-boot'
          : 'before-application-startup',
        kitRouterRequiresIntersectionObserverAtStartup: kitRouterNeedsIO,
      }),
      contentType: 'application/json',
    })
    const before = await snapshot(page)
    await page.setViewportSize({ width: 940, height: 820 })
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await expect
      .poll(async () => (await snapshot(page)).canvas!.cssWidth)
      .not.toBe(before.canvas!.cssWidth)
    await requestFrame(page)
    const resized = await snapshot(page)
    expect(resized.canvas!.bufferWidth).toBe(
      Math.max(1, Math.floor(resized.canvas!.cssWidth * resized.canvas!.dpr))
    )
    expect(resized.canvas!.bufferHeight).toBe(
      Math.max(1, Math.floor(resized.canvas!.cssHeight * resized.canvas!.dpr))
    )
    await expectPixels(page)
    await mounted(page, false)
    await page.setViewportSize({ width: 1000, height: 840 })
    expect((await snapshot(page)).canvas).toBeNull()
    await mounted(page, true)
    await ready(page)
    await expectPixels(page)
    expect(errors).toEqual([])
  })

  test('missing ResizeObserver reports truthful typed construction failure and recovers only after real API restoration plus explicit remount', async ({
    page,
  }, info) => {
    const errors = browserErrors(page)
    const diagnostics: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text())
    })
    await page.addInitScript(() => {
      const state = window as unknown as LifecycleWindow
      state.__lifecycleResizeObserver = window.ResizeObserver
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: undefined,
      })
    })
    const restoreObserver = () =>
      page.evaluate(() => {
        const state = window as unknown as LifecycleWindow
        if (state.__lifecycleResizeObserver)
          Object.defineProperty(window, 'ResizeObserver', {
            configurable: true,
            value: state.__lifecycleResizeObserver,
          })
      })
    try {
      await page.goto('/')
      await page.waitForFunction(
        () =>
          (window as unknown as LifecycleWindow).gradientFixture?.version === 1
      )
      await mainWrapper(page).scrollIntoViewIfNeeded()
      await expect
        .poll(async () => (await snapshot(page)).fallback)
        .toBe('error')
      const failed = await snapshot(page)
      expect(failed.canvas).toBeNull()
      expect(failed.scene).toBeNull()
      expect(
        failed.errors.some(
          (error) => error.code === 'renderer' && error.message.length > 0
        )
      ).toBe(true)
      const wrapper = mainWrapper(page).locator(
        '[data-gradient-main], .managed-gradient'
      )
      await wrapper.evaluate((element) => {
        ;(window as unknown as LifecycleWindow).__lifecycleSsrWrapper = element
      })
      const bounds = await wrapper.boundingBox()
      expect(bounds!.width).toBeGreaterThan(100)
      expect(bounds!.height).toBeGreaterThan(100)
      const fallback = wrapper.locator(
        '[data-gradient-fallback], [data-native-fallback]'
      )
      await expect(fallback).toBeVisible()
      expect((await fallback.innerText()).trim().length).toBeGreaterThan(10)
      const stopped = await observeWindow(page)
      expect(stopped.last.counters.completedFrames).toBe(
        stopped.first.counters.completedFrames
      )
      expect(stopped.last.counters.rendererCalls).toBe(
        stopped.first.counters.rendererCalls
      )
      expect(stopped.last.scene).toBeNull()
      expect(
        await wrapper.evaluate(
          (element) =>
            element ===
            (window as unknown as LifecycleWindow).__lifecycleSsrWrapper
        )
      ).toBe(true)
      await restoreObserver()
      expect(await page.evaluate(() => typeof ResizeObserver)).toBe('function')
      const noRetry = await observeWindow(page)
      expect(noRetry.last.fallback).toBe('error')
      expect(noRetry.last.counters.completedFrames).toBe(
        noRetry.first.counters.completedFrames
      )
      expect(noRetry.last.counters.rendererCalls).toBe(
        noRetry.first.counters.rendererCalls
      )
      await mounted(page, false)
      await mounted(page, true)
      await ready(page)
      await configure(page, { preserveDrawingBuffer: true })
      await update(page, {
        control: 'props',
        lightType: '3d',
        animate: 'off',
        grain: 'off',
      })
      await requestFrame(page)
      await expectPixels(page)
      expect(errors).toEqual([])
      await attachEvidence(
        info,
        'missing-resize-observer-typed-failure-and-explicit-recovery',
        {
          body: JSON.stringify({
            failed,
            bounds,
            diagnostics,
            recovered: await snapshot(page),
            capability:
              'Threlte 8 Canvas requires native ResizeObserver; no polyfill or automatic retry',
          }),
          contentType: 'application/json',
        }
      )
    } finally {
      await restoreObserver()
    }
  })

  test('initial and live reduced motion stop temporal/render work but retain explicit invalidations', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await update(page, { animate: 'on', uTime: 12 })
    await expect
      .poll(async () => (await snapshot(page)).reducedMotion)
      .toBe(true)
    expect((await expectIdle(page)).last.scene!.meshes[0].time).toBe(12)
    const before = await expectPixels(page)
    await update(page, { color1: '#00ff00', color2: '#0000ff' })
    expect((await pixels(page)).hash).not.toBe(before.hash)
    expect((await snapshot(page)).scene!.meshes[0].time).toBe(12)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect
      .poll(async () => (await snapshot(page)).reducedMotion)
      .toBe(false)
    await expect
      .poll(async () => (await snapshot(page)).scene!.meshes[0].time)
      .toBeGreaterThan(12.02)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(async () => (await snapshot(page)).reducedMotion)
      .toBe(true)
    await expectIdle(page)
    await configure(page, { respectReducedMotion: false })
    await expect
      .poll(async () => (await snapshot(page)).reducedMotion)
      .toBe(false)
    const resumed = (await snapshot(page)).scene!.meshes[0].time
    await expect
      .poll(async () => (await snapshot(page)).scene!.meshes[0].time)
      .toBeGreaterThan(resumed + 0.02)
  })

  test('pause freezes actual time/pixels and resume excludes paused wall time', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await open(page)
    await update(page, { animate: 'on', uTime: 3 })
    await expect
      .poll(async () => (await snapshot(page)).scene!.meshes[0].time)
      .toBeGreaterThan(3.04)
    await update(page, { animate: 'off' })
    const before = await pixels(page)
    const frozen = await expectIdle(page, 900)
    expect((await pixels(page)).hash).toBe(before.hash)
    const time = frozen.last.scene!.meshes[0].time
    const resumeStart = await page.evaluate(() => performance.now())
    await update(page, { animate: 'on' })
    const resumed = await observeWindow(page, 180)
    const delta = resumed.last.scene!.meshes[0].time - time
    const elapsed = await page.evaluate(
      (start) => (performance.now() - start) / 1000,
      resumeStart
    )
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThan(elapsed + 0.08)
    expect((await pixels(page)).hash).not.toBe(before.hash)
    await update(page, { animate: 'off' })
    await expectIdle(page)
  })

  test('paused explicit props, CSS resize, DPR and camera changes each complete a real redraw without temporal advance', async ({
    page,
  }) => {
    await open(page)
    const initial = await snapshot(page)
    let image = await expectPixels(page)
    const color = await update(page, {
      color1: '#00ff22',
      color2: '#112244',
      color3: '#ff11ee',
    })
    expect(color.counters.completedFrames).toBeGreaterThan(
      initial.counters.completedFrames
    )
    expect(color.scene!.meshes[0].time).toBe(4)
    expect((await pixels(page)).hash).not.toBe(image.hash)
    const cameraBefore = color.scene!.camera.position
    image = await pixels(page)
    await update(page, {
      cAzimuthAngle: 65,
      cPolarAngle: 70,
      cDistance: 5,
      cameraZoom: 1.4,
    })
    await expect
      .poll(async () => (await snapshot(page)).scene!.camera.position)
      .not.toEqual(cameraBefore)
    expect((await pixels(page)).hash).not.toBe(image.hash)
    const resizedBefore = await snapshot(page)
    await mainWrapper(page).evaluate((element) => {
      ;(element as HTMLElement).style.width = '613px'
    })
    await expect
      .poll(async () => (await snapshot(page)).canvas!.cssWidth)
      .toBeCloseTo(613, 0)
    await requestFrame(page)
    await configure(page, { pixelDensity: 1.5, fov: 61 })
    const resized = await snapshot(page)
    expect(resized.canvas!.rendererIdentity).toBe(
      resizedBefore.canvas!.rendererIdentity
    )
    expect(resized.canvas!.bufferWidth).toBe(
      Math.floor(resized.canvas!.cssWidth * 1.5)
    )
    expect(resized.scene!.camera.fov).toBe(61)
    expect(resized.scene!.meshes[0].time).toBe(4)
    await expectPixels(page)
    await expectIdle(page)
  })

  test('positive owned buffer and grain targets retain at least one pixel per axis without changing CSS aspect or DPR', async ({
    page,
  }, info) => {
    await open(page)
    const original = await snapshot(page)
    // Use a deliberately centered, undisplaced mesh and a controlled projection.
    // At aspect 1024 a FOV-45 plane is narrower than the sole pixel's MSAA sample
    // spacing. A narrow public FOV guarantees coverage without changing CSS aspect,
    // DPR, backing dimensions, geometry, or the renderer/compositor sizing path.
    await update(page, {
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      uStrength: 0,
      cAzimuthAngle: 0,
      cPolarAngle: 90,
      cDistance: 3.6,
    })
    await configure(page, { fov: 0.01 })
    await refsAvailable(page)
    await holdNativeContext(page)
    const evidence: unknown[] = []
    for (const grain of ['off', 'on'] as const) {
      await update(page, { grain, grainBlending: 0.5 })
      for (const [width, height] of [
        [1024, 512],
        [512, 1024],
        [1024, 1],
        [1, 1024],
      ]) {
        await mainWrapper(page).evaluate(
          (element, size) => {
            const wrapper = element as HTMLElement
            wrapper.style.width = `${size.width}px`
            wrapper.style.height = `${size.height}px`
            const canvasWrapper = wrapper.querySelector<HTMLElement>(
              '[data-gradient-main], .managed-gradient'
            )!
            canvasWrapper.style.width = '100%'
            canvasWrapper.style.height = '100%'
          },
          { width, height }
        )
        const dpr = 1 / Math.max(width, height)
        await configure(page, { lazyLoad: false, pixelDensity: dpr })
        await requestFrame(page)
        await page.evaluate(() => {
          ;(
            window as unknown as LifecycleWindow
          ).__lifecycleHeld!.raster.length = 0
        })
        await requestFrame(page)
        const state = await snapshot(page)
        expect(state.canvas!.bufferWidth).toBe(1)
        expect(state.canvas!.bufferHeight).toBe(1)
        expect(state.canvas!.cssWidth).toBeCloseTo(width, 1)
        expect(state.canvas!.cssHeight).toBeCloseTo(height, 1)
        expect(state.canvas!.dpr).toBe(dpr)
        expect(state.canvas!.rendererIdentity).toBe(
          original.canvas!.rendererIdentity
        )
        expect(state.scene!.camera.fov).toBe(0.01)
        const actual = await page.evaluate(() => {
          const native = (
            window as unknown as LifecycleWindow
          ).gradientLifecycle.refs().native!
          const camera = native.camera() as Camera & { aspect: number }
          const gl = native.renderer.getContext()
          const mesh = native.scene.getObjectByName(
            'shadergradient-mesh'
          ) as Mesh
          const material = mesh.material as Material
          return {
            aspect: camera.aspect,
            projectionMatrix: camera.projectionMatrix.elements.slice(),
            viewMatrix: camera.matrixWorldInverse.elements.slice(),
            uniforms: {
              uStrength: Number(material.userData.uStrength?.value),
              uTime: Number(material.userData.uTime?.value),
            },
            samples: Number(gl.getParameter(gl.SAMPLES)),
            viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
            framebuffer: gl.checkFramebufferStatus(gl.FRAMEBUFFER),
            error: gl.getError(),
          }
        })
        expect(actual.aspect).toBeCloseTo(width / height, 5)
        expect(actual.viewport.slice(2)).toEqual([1, 1])
        expect(actual.framebuffer).toBe(0x8cd5)
        expect(actual.error).toBe(0)
        const rendered = await pixels(page)
        const frames = await page.evaluate(
          () => (window as unknown as LifecycleWindow).__lifecycleHeld!.raster
        )
        await attachEvidence(info, `owned-raster-${grain}-${width}x${height}`, {
          body: JSON.stringify({
            state,
            grain,
            width,
            height,
            dpr,
            actual,
            rendered,
            frames,
          }),
          contentType: 'application/json',
        })
        expect(rendered.alpha).toBeGreaterThan(0)
        expect(frames.length).toBeGreaterThan(0)
        for (const frame of frames) {
          expect(frame.viewport.slice(2)).toEqual([1, 1])
          expect(frame.framebuffer).toBe(0x8cd5)
          expect(frame.error).toBe(0)
        }
        if (grain === 'on')
          expect(frames.some((frame) => frame.offscreen)).toBe(true)
        evidence.push({ grain, width, height, dpr, actual, rendered, frames })
      }
    }
    await mainWrapper(page).evaluate((element) => {
      const wrapper = element as HTMLElement
      wrapper.style.width = '640px'
      wrapper.style.height = '360px'
    })
    await configure(page, { pixelDensity: 1, fov: original.scene!.camera.fov! })
    await requestFrame(page)
    await expectPixels(page)
    expect((await snapshot(page)).canvas!.bufferWidth).toBe(640)
    expect((await snapshot(page)).canvas!.bufferHeight).toBe(360)
    expect((await snapshot(page)).scene!.camera.fov).toBe(
      original.scene!.camera.fov
    )
    await attachEvidence(info, 'owned-positive-raster-and-final-output', {
      body: JSON.stringify(evidence),
      contentType: 'application/json',
    })
  })
})

test.describe('real capability and asset failure paths', () => {
  test('unsupported WebGL construction reports a typed error and usable fallback, never ready-looking output', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: Parameters<typeof original>
      ) {
        if (/^(webgl2?|experimental-webgl)$/.test(String(args[0]))) return null
        return original.apply(this, args)
      } as typeof original
    })
    const errors = browserErrors(page)
    await page.goto('/')
    await page.waitForFunction(
      () => !!(window as unknown as LifecycleWindow).gradientFixture
    )
    await mainWrapper(page).scrollIntoViewIfNeeded()
    await expect
      .poll(async () => (await snapshot(page)).fallback)
      .toBe('unsupported')
    const state = await snapshot(page)
    expect(
      state.errors.some(
        (error) =>
          error.code === 'unsupported-webgl' && error.message.length > 0
      )
    ).toBe(true)
    expect(state.canvas).toBeNull()
    expect(state.scene).toBeNull()
    const fallback = mainWrapper(page).locator(
      '[data-gradient-fallback], [data-native-fallback]'
    )
    await expect(fallback).toBeVisible()
    expect((await fallback.innerText()).trim().length).toBeGreaterThan(10)
    const idle = await observeWindow(page)
    expect(idle.last.counters.completedFrames).toBe(
      idle.first.counters.completedFrames
    )
    await mounted(page, false)
    await mounted(page, true)
    await expect
      .poll(async () => (await snapshot(page)).fallback)
      .toBe('unsupported')
    expect(errors).toEqual([])
  })

  test('actual post-render WEBGL_lose_context clears ready output, halts owned work and restores only on the real event', async ({
    page,
  }, info) => {
    await open(page)
    await update(page, {
      animate: 'on',
      grain: 'on',
      toggleAxis: true,
      uTime: 6,
    })
    await expectPixels(page)
    const before = await snapshot(page)
    const capability = await holdNativeContext(page)
    // Unsupported extension is explicit evidence, not a silent test skip or a fake loss.
    expect(
      capability.extension,
      `${info.project.name} must expose WEBGL_lose_context for this required scenario`
    ).toBe(true)
    await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__lifecycleHeld!.extension!.loseContext()
    )
    await expect.poll(async () => (await snapshot(page)).fallback).toBe('error')
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as LifecycleWindow
          ).__lifecycleHeld!.gl.isContextLost()
        )
      )
      .toBe(true)
    const failed = await snapshot(page)
    expect(
      failed.errors.some(
        (error) => error.code === 'context-lost' && error.message.length > 0
      )
    ).toBe(true)
    expect(failed.scene).toBeNull()
    expect(failed.canvas).toBeNull()
    await expect(
      mainWrapper(page).locator(
        '[data-gradient-fallback], [data-native-fallback]'
      )
    ).toBeVisible()
    const idle = await observeWindow(page, 500)
    expect(idle.last.counters.completedFrames).toBe(
      idle.first.counters.completedFrames
    )
    expect(idle.last.counters.rendererCalls).toBe(
      idle.first.counters.rendererCalls
    )
    const heldDraws = await page.evaluate(
      () => (window as unknown as LifecycleWindow).__lifecycleHeld!.draws
    )
    await observeWindow(page, 200)
    expect(
      await page.evaluate(
        () => (window as unknown as LifecycleWindow).__lifecycleHeld!.draws
      )
    ).toBe(heldDraws)
    expect(failed.counters.geometryDisposals).toBeGreaterThan(
      before.counters.geometryDisposals
    )
    expect(failed.counters.materialDisposals).toBeGreaterThan(
      before.counters.materialDisposals
    )
    expect(
      failed.counters.rendererDisposals - before.counters.rendererDisposals
    ).toBe(1)
    // No automatic retry: still failed until the actual extension restoration.
    expect((await snapshot(page)).fallback).toBe('error')
    // Pause while the failed generation has no scene. Do not seek: the unchanged
    // declarative uTime=6 must become the fresh generation's initial time.
    await update(page, { animate: 'off' })
    expect((await snapshot(page)).fallback).toBe('error')
    expect((await snapshot(page)).scene).toBeNull()
    await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__lifecycleHeld!.extension!.restoreContext()
    )
    await ready(page)
    const restored = await snapshot(page)
    expect(restored.canvas!.rendererIdentity).not.toBe(
      before.canvas!.rendererIdentity
    )
    expect(restored.scene!.uuid).not.toBe(before.scene!.uuid)
    expect(restored.scene!.meshes[0].time).toBeCloseTo(6, 6)
    await expectPixels(page)
    await expectIdle(page)
    await mounted(page, false)
    await mounted(page, true)
    await ready(page)
    expect((await snapshot(page)).scene!.meshes[0].time).toBeCloseTo(6, 6)
    await expectPixels(page)
    await attachEvidence(info, 'actual-context-loss-and-restoration', {
      body: JSON.stringify({ before, failed, restored }),
      contentType: 'application/json',
    })
  })

  for (const failure of ['404', 'decode'] as const) {
    test(`genuine HDR ${failure} retains honest typed failure and ambient output, then recovers with a new real load`, async ({
      page,
    }) => {
      await open(page)
      const responses: number[] = []
      await page.route('**/__lifecycle-hdr-failure/*.hdr', async (route) => {
        responses.push(failure === '404' ? 404 : 200)
        await route.fulfill({
          status: failure === '404' ? 404 : 200,
          contentType: 'application/octet-stream',
          body:
            failure === '404'
              ? 'Not found'
              : 'These bytes are not a Radiance HDR image',
        })
      })
      const before = await snapshot(page)
      await configureHDR(page, '/__lifecycle-hdr-failure')
      await expect
        .poll(
          async () =>
            (await snapshot(page)).errors.filter(
              (error) => error.code === 'environment'
            ).length
        )
        .toBeGreaterThan(
          before.errors.filter((error) => error.code === 'environment').length
        )
      expect(responses).toEqual([failure === '404' ? 404 : 200])
      expect((await snapshot(page)).scene!.environmentUuid).toBeNull()
      // Canvas output may remain ready: environment failure is NOT Canvas/context failure.
      await requestFrame(page)
      await expectPixels(page)
      await page.route('**/__lifecycle-hdr-recovery/*.hdr', fulfillHDR)
      await configure(page, { envBasePath: '/__lifecycle-hdr-recovery' })
      await expect
        .poll(async () => (await snapshot(page)).scene!.environmentUuid)
        .not.toBeNull()
      await requestFrame(page)
      expect((await snapshot(page)).scene!.meshes[0].time).toBe(4)
      expect((await snapshot(page)).canvas!.rendererIdentity).toBe(
        before.canvas!.rendererIdentity
      )
      await expectPixels(page)
      await expectIdle(page)
    })
  }

  test('delayed HDR completion explicitly redraws paused output without advancing time', async ({
    page,
  }) => {
    await open(page)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = false
    await page.route('**/__lifecycle-hdr-delay/*.hdr', async (route) => {
      requested = true
      await gate
      await fulfillHDR(route)
    })
    try {
      await configureHDR(page, '/__lifecycle-hdr-delay')
      await expect.poll(() => requested).toBe(true)
      const loading = await snapshot(page)
      expect(loading.scene!.environmentUuid).toBeNull()
      await expectIdle(page)
      const image = await pixels(page)
      release()
      await expect
        .poll(async () => (await snapshot(page)).scene!.environmentUuid)
        .not.toBeNull()
      await expect
        .poll(async () => (await snapshot(page)).counters.completedFrames)
        .toBeGreaterThan(loading.counters.completedFrames)
      expect((await snapshot(page)).scene!.meshes[0].time).toBe(4)
      expect((await pixels(page)).hash).not.toBe(image.hash)
      await expectIdle(page)
    } finally {
      release()
    }
  })

  test('latest HDR generation owns the environment and an older delayed valid texture is disposed exactly once', async ({
    page,
  }, info) => {
    await open(page)
    await watchTextures(page)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let oldRequested = false
    let oldCompleted = false
    await page.route('**/__lifecycle-hdr-old/*.hdr', async (route) => {
      oldRequested = true
      await gate
      await fulfillHDR(route)
      oldCompleted = true
    })
    await page.route('**/__lifecycle-hdr-new/*.hdr', fulfillHDR)
    try {
      await configureHDR(page, '/__lifecycle-hdr-old')
      await expect.poll(() => oldRequested).toBe(true)
      await configure(page, { envBasePath: '/__lifecycle-hdr-new' })
      await expect
        .poll(async () => (await snapshot(page)).scene!.environmentUuid)
        .not.toBeNull()
      await requestFrame(page)
      const newest = await snapshot(page)
      const image = await pixels(page)
      const before = await textureEvents(page)
      release()
      await expect.poll(() => oldCompleted).toBe(true)
      await expect
        .poll(async () => (await textureEvents(page)).length)
        .toBeGreaterThan(before.length)
      const events = (await textureEvents(page)).filter(
        (event) => !before.some((old) => old.id === event.id)
      )
      for (const event of events) expect(event.disposals).toBe(1)
      expect(
        events.some((event) => event.id !== newest.scene!.environmentUuid)
      ).toBe(true)
      expect((await snapshot(page)).scene!.environmentUuid).toBe(
        newest.scene!.environmentUuid
      )
      expect((await snapshot(page)).errors).toEqual(newest.errors)
      expect((await pixels(page)).hash).toBe(image.hash)
      await attachEvidence(info, 'late-candidate-texture-dispose-events', {
        body: JSON.stringify(events),
        contentType: 'application/json',
      })
    } finally {
      release()
    }
  })

  test('unmount before genuine HDR completion releases the late texture without publication or work on a dead renderer', async ({
    page,
  }, info) => {
    await open(page)
    await watchTextures(page)
    await holdNativeContext(page)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = false
    await page.route('**/__lifecycle-hdr-unmount/*.hdr', async (route) => {
      requested = true
      await gate
      await fulfillHDR(route)
    })
    try {
      await configureHDR(page, '/__lifecycle-hdr-unmount')
      await expect.poll(() => requested).toBe(true)
      await mounted(page, false)
      const tornDown = await snapshot(page)
      expect(tornDown.scene).toBeNull()
      expect(
        await page.evaluate(() =>
          (
            window as unknown as LifecycleWindow
          ).__lifecycleHeld!.gl.isContextLost()
        )
      ).toBe(true)
      const eventsBefore = await textureEvents(page)
      release()
      await expect
        .poll(async () => (await textureEvents(page)).length)
        .toBeGreaterThan(eventsBefore.length)
      const late = (await textureEvents(page)).filter(
        (event) => !eventsBefore.some((old) => old.id === event.id)
      )
      for (const event of late) expect(event.disposals).toBe(1)
      const idle = await observeWindow(page)
      expect(idle.last.scene).toBeNull()
      expect(idle.last.canvas).toBeNull()
      expect(idle.last.counters.rendererCalls).toBe(
        idle.first.counters.rendererCalls
      )
      expect(idle.last.errors).toEqual(tornDown.errors)
      await update(page, { lightType: '3d' })
      await mounted(page, true)
      await ready(page)
      expect((await snapshot(page)).scene!.environmentUuid).toBeNull()
      await expectPixels(page)
      await attachEvidence(info, 'unmounted-late-texture-events', {
        body: JSON.stringify(late),
        contentType: 'application/json',
      })
    } finally {
      release()
    }
  })
})

test.describe('consumer host ownership and initial failed branch regression', () => {
  test('removing external gradients preserves actual host scene/camera/environment/mesh/controls/renderer', async ({
    page,
  }, info) => {
    await open(page)
    await mounted(page, false)
    const gradients = [
      { type: 'sphere' as const, animate: 'off' as const, positionX: -1.6 },
      {
        type: 'sphere' as const,
        shader: 'cosmic' as const,
        animate: 'off' as const,
        positionX: 1.6,
      },
    ]
    await page.evaluate(
      (gradients) =>
        (
          window as unknown as LifecycleWindow
        ).gradientFixture.externalHost.configure({ enabled: true, gradients }),
      gradients
    )
    const before = await snapshot(page)
    expect(before.externalHost!.gradientMeshCount).toBe(2)
    const hostState = await page.evaluate(() => {
      const host = (
        window as unknown as LifecycleWindow
      ).gradientLifecycle.refs().host!
      const camera = host.camera()
      const box =
        host.scene.getObjectByName('consumer-owned-host-box') ??
        host.scene.children.find(
          (object) =>
            (object as Mesh).isMesh && object.name !== 'shadergradient-mesh'
        )
      if (!box)
        throw new Error(
          'Consumer host mesh must be an actual retained Object3D'
        )
      return {
        scene: host.scene.uuid,
        camera: camera.uuid,
        environment: host.scene.environment?.uuid ?? null,
        box: box.uuid,
        lost: host.renderer.getContext().isContextLost(),
      }
    })
    const originalNativeMeshes = await watchNativeMeshResources(page, 'host')
    expect(originalNativeMeshes).toHaveLength(2)
    for (const count of [1, 0]) {
      if (count)
        await page.evaluate(
          (gradients) =>
            (
              window as unknown as LifecycleWindow
            ).gradientFixture.externalHost.configure({
              enabled: true,
              gradients: gradients.slice(0, 1),
            }),
          gradients
        )
      else
        await page.evaluate(() =>
          (
            window as unknown as LifecycleWindow
          ).gradientFixture.externalHost.clear()
        )
      const state = await snapshot(page)
      expect(state.externalHost!.gradientMeshCount).toBe(count)
      expect(state.externalHost!.sceneUuid).toBe(before.externalHost!.sceneUuid)
      expect(state.externalHost!.cameraUuid).toBe(
        before.externalHost!.cameraUuid
      )
      expect(state.externalHost!.environmentUuid).toBe(
        before.externalHost!.environmentUuid
      )
      expect(state.externalHost!.rendererIdentity).toBe(
        before.externalHost!.rendererIdentity
      )
      expect(state.counters.rendererDisposals).toBe(
        before.counters.rendererDisposals
      )
      // Consumer list reconciliation may replace the surviving keyed gradient.
      // Observe any actual replacement before the next removal, while retaining
      // listeners on the original two meshes to catch repeated disposal.
      await page.evaluate(() =>
        (window as unknown as LifecycleWindow).__lifecycleResources!.scan()
      )
    }
    const after = await page.evaluate(() => {
      const host = (
        window as unknown as LifecycleWindow
      ).gradientLifecycle.refs().host!
      return {
        scene: host.scene.uuid,
        camera: host.camera().uuid,
        environment: host.scene.environment?.uuid ?? null,
        boxes: host.scene.children
          .filter((object) => (object as Mesh).isMesh)
          .map((object) => object.uuid),
        lost: host.renderer.getContext().isContextLost(),
      }
    })
    expect(after.scene).toBe(hostState.scene)
    expect(after.camera).toBe(hostState.camera)
    expect(after.environment).toBe(hostState.environment)
    expect(after.boxes).toContain(hostState.box)
    expect(after.lost).toBe(false)
    const resources = await snapshot(page)
    const scoped = await page.evaluate(
      () => (window as unknown as LifecycleWindow).__lifecycleResources!.events
    )
    await attachEvidence(
      info,
      'external-native-and-borrowed-host-resource-events',
      {
        body: JSON.stringify({
          originalNativeMeshes,
          scoped,
          aggregateBefore: before.counters,
          aggregateAfter: resources.counters,
        }),
        contentType: 'application/json',
      }
    )
    for (const meshUuid of originalNativeMeshes) {
      expect(
        scoped.some(
          (resource) =>
            resource.owner === 'native' &&
            resource.meshUuid === meshUuid &&
            resource.kind === 'geometry'
        )
      ).toBe(true)
      expect(
        scoped.some(
          (resource) =>
            resource.owner === 'native' &&
            resource.meshUuid === meshUuid &&
            resource.kind === 'material'
        )
      ).toBe(true)
    }
    expect(
      scoped.some(
        (resource) => resource.owner === 'host' && resource.kind === 'geometry'
      )
    ).toBe(true)
    expect(
      scoped.some(
        (resource) => resource.owner === 'host' && resource.kind === 'material'
      )
    ).toBe(true)
    expect(
      scoped.some(
        (resource) => resource.owner === 'host' && resource.kind === 'texture'
      )
    ).toBe(true)
    for (const resource of scoped) {
      expect(
        resource.calls,
        `${resource.owner} ${resource.kind} ${resource.id} dispose calls`
      ).toBe(resource.owner === 'native' ? 1 : 0)
      if (resource.disposals !== null) {
        expect(
          resource.disposals,
          `${resource.owner} ${resource.kind} ${resource.id} dispose events`
        ).toBe(resource.owner === 'native' ? 1 : 0)
      }
    }
    await page.evaluate(() =>
      (window as unknown as LifecycleWindow).__lifecycleResources!.restore()
    )
    // The separate public consumer exposes actual controls and render refs, including
    // host-only output after native content disappears (not just identity snapshots).
    await supportOwnership(page, info)
    const initialHost = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.snapshot()
    )
    await page.evaluate(() => {
      const state = window as unknown as LifecycleWindow
      const controls = state.gradientOwnership.refs().controls
      if (!controls)
        throw new Error(
          'Ownership consumer must expose its actual live host controls'
        )
      const original = controls.dispose
      const observed = {
        object: controls,
        disposals: 0,
        restore() {
          controls.dispose = original
        },
      }
      controls.dispose = function () {
        observed.disposals++
        return original.call(controls)
      }
      state.__lifecycleHostControls = observed
    })
    const ordinary = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.recover()
    )
    const newer = await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).gradientOwnership.replaceEnvironment()
    )
    expect(newer.host.environmentUuid).not.toBe(ordinary.host.environmentUuid)
    const removed = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.clear()
    )
    expectHostPreserved(initialHost, removed, newer.host.environmentUuid)
    await assertOwnedEvents(page, info, removed.resourceEvents)
    const controls = await page.evaluate(() => {
      const state = window as unknown as LifecycleWindow
      return {
        same:
          state.gradientOwnership.refs().controls ===
          state.__lifecycleHostControls!.object,
        disposals: state.__lifecycleHostControls!.disposals,
        enabled: state.gradientOwnership.refs().controls!.enabled,
      }
    })
    expect(controls).toEqual({ same: true, disposals: 0, enabled: true })
    const cameraPosition = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership
        .refs()
        .camera()
        .position.toArray()
    )
    const canvas = page.locator('canvas').first()
    await canvas.scrollIntoViewIfNeeded()
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      box.x + box.width / 2 + 80,
      box.y + box.height / 2 + 30,
      { steps: 8 }
    )
    await page.mouse.up()
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as LifecycleWindow).gradientOwnership
            .refs()
            .camera()
            .position.toArray()
        )
      )
      .not.toEqual(cameraPosition)
    const behavior = await page.evaluate(() => {
      const refs = (
        window as unknown as LifecycleWindow
      ).gradientOwnership.refs()
      const gl = refs.renderer.getContext()
      const camera = refs.camera()
      const sample = () => {
        const pixel = new Uint8Array(4)
        let hash = 2166136261
        let alpha = 0
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 12; x++) {
            gl.readPixels(
              Math.min(
                gl.drawingBufferWidth - 1,
                Math.floor(((x + 0.5) * gl.drawingBufferWidth) / 12)
              ),
              Math.min(
                gl.drawingBufferHeight - 1,
                Math.floor(((y + 0.5) * gl.drawingBufferHeight) / 12)
              ),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixel
            )
            alpha += pixel[3]
            for (const byte of pixel)
              hash = Math.imul(hash ^ byte, 16777619) >>> 0
          }
        return { hash, alpha }
      }
      refs.renderer.render(refs.scene, camera)
      const beforePixels = sample()
      const before = camera.matrixWorldInverse.elements.slice()
      camera.position.x += 1
      camera.lookAt(refs.hostMesh.position)
      camera.updateMatrixWorld()
      refs.renderer.render(refs.scene, camera)
      return {
        changed: before.some(
          (value, index) => value !== camera.matrixWorldInverse.elements[index]
        ),
        beforePixels,
        afterPixels: sample(),
        controlsEnabled: refs.controls?.enabled ?? null,
        lost: gl.isContextLost(),
        error: gl.getError(),
        hostMeshAlive:
          refs.scene.getObjectByProperty('uuid', refs.hostMesh.uuid) ===
          refs.hostMesh,
      }
    })
    expect(behavior.changed).toBe(true)
    expect(behavior.hostMeshAlive).toBe(true)
    expect(behavior.lost).toBe(false)
    expect(behavior.error).toBe(0)
    expect(behavior.afterPixels.alpha).toBeGreaterThan(0)
    expect(behavior.afterPixels.hash).not.toBe(behavior.beforePixels.hash)
    expect(behavior.controlsEnabled).toBe(true)
  })

  test('initial pre-onMount managed sibling failure leaves no ambient/helper lease and permits recovery plus normal teardown', async ({
    page,
  }, info) => {
    await supportOwnership(page, info)
    const initial = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.snapshot()
    )
    const failed = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.run(
        'failed-initial-managed'
      )
    )
    expect(failed.mode).toBe('failed-initial-managed')
    expect(
      failed.errors.some(
        (error) => error.code.length > 0 && error.message.length > 0
      )
    ).toBe(true)
    expectHostPreserved(initial, failed)
    expect(failed.nativeMeshCount).toBe(0)
    expect(failed.nativeLightCount).toBe(0)
    expect(
      await page.evaluate(() => {
        let helpers = 0
        ;(window as unknown as LifecycleWindow).gradientOwnership
          .refs()
          .scene.traverse((object) => {
            if (object.type === 'AxesHelper') helpers++
          })
        return helpers
      })
    ).toBe(0)
    const recovered = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.recover()
    )
    expect(recovered.host.sceneUuid).toBe(initial.host.sceneUuid)
    expect(recovered.nativeMeshCount).toBe(1)
    expect(recovered.nativeLightCount).toBeGreaterThan(0)
    expect(recovered.host.contextLost).toBe(false)
    const newer = await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).gradientOwnership.replaceEnvironment()
    )
    const cleared = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.clear()
    )
    expectHostPreserved(initial, cleared, newer.host.environmentUuid)
    expect(cleared.nativeMeshCount).toBe(0)
    expect(cleared.nativeLightCount).toBe(0)
    const events = cleared.resourceEvents
    await assertOwnedEvents(page, info, events)
    const secondClear = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.clear()
    )
    for (const event of events)
      expect(
        secondClear.resourceEvents.find(
          (candidate) => candidate.id === event.id
        )?.disposals
      ).toBe(event.owner === 'native' ? 1 : 0)
    await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.recover()
    )
    const final = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientOwnership.clear()
    )
    expect(final.nativeMeshCount).toBe(0)
    expect(final.nativeLightCount).toBe(0)
    expectHostPreserved(initial, final, newer.host.environmentUuid)
    await assertOwnedEvents(page, info, final.resourceEvents)
  })

  test('initial synchronous Canvas child failure permits documented renderer recreation with a new live gradient surface', async ({
    page,
  }, info) => {
    await openBindingRegression(page, 'initialization')
    await expect
      .poll(async () => (await bindingSnapshot(page)).phase)
      .toBe('initial-failure')
    const failed = await bindingSnapshot(page)
    expect(failed.failures).toBe(1)
    expect(
      failed.rendererId,
      'The synchronous child must fail below an actual initialized native renderer'
    ).toBeTruthy()
    const failedRenderer = failed.rendererId!

    await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__shadergradientBindingProbe.recoverInitialization()
    )
    await expect
      .poll(async () => (await bindingSnapshot(page)).phase)
      .toBe('ready')
    const recovered = await bindingSnapshot(page)
    expect(recovered.failures).toBe(1)
    expect(recovered.rendererId).toBeTruthy()
    expect(recovered.rendererId).not.toBe(failedRenderer)
    const recoveredRenderer = recovered.rendererId!
    expect(recovered.rendererDisposals[failedRenderer]).toBe(1)
    expect(recovered.rendererDisposals[recoveredRenderer]).toBe(0)
    const output = await bindingFrame(page)
    const completed = await bindingSnapshot(page)
    expect(completed.phase).toBe('ready')
    expect(completed.failures).toBe(1)
    expect(completed.rendererId).toBe(recoveredRenderer)
    expect(completed.rendererDisposals[failedRenderer]).toBe(1)
    expect(completed.rendererDisposals[recoveredRenderer]).toBe(0)
    await attachEvidence(info, 'binding-initialization-recovered.png', {
      body: output.image,
      contentType: 'image/png',
    })
    await attachEvidence(info, 'binding-initialization-renderer-transition', {
      body: JSON.stringify(
        { failed, recovered, completed, frame: output.frame },
        null,
        2
      ),
      contentType: 'application/json',
    })
  })

  test('host autoRender re-enable keeps grain single-draw and releases to the retained host renderer and surface', async ({
    page,
  }, info) => {
    await openBindingRegression(page, 'render-path')
    await expect
      .poll(async () => (await bindingSnapshot(page)).phase)
      .toBe('ready')
    const initial = await bindingSnapshot(page)
    expect(initial.failures).toBe(0)
    expect(initial.rendererId).toBeTruthy()
    const renderer = initial.rendererId!
    expect(initial.rendererDisposals[renderer]).toBe(0)
    expect(initial.hostAutoRender).toBe(false)
    const baseline = await bindingFrame(page)

    await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__shadergradientBindingProbe.setHostAutoRender(true)
    )
    const reenabled = await bindingFrame(page)
    expect(
      pixelDifference(baseline.image, reenabled.image),
      'Changing only host autoRender must preserve the selected grain surface, not substitute plain rendering (same-engine 0.5% / RGB8 criterion)'
    ).toBeLessThanOrEqual(0.005)
    const active = await bindingSnapshot(page)
    expect(active.phase).toBe('ready')
    expect(active.failures).toBe(0)
    expect(active.hostAutoRender).toBe(true)
    expect(active.rendererId).toBe(renderer)
    expect(active.rendererDisposals[renderer]).toBe(0)

    await page.evaluate(() =>
      (
        window as unknown as LifecycleWindow
      ).__shadergradientBindingProbe.removeGradient()
    )
    const released = await bindingSnapshot(page)
    expect(released.hostAutoRender).toBe(true)
    expect(released.rendererId).toBe(renderer)
    expect(released.rendererDisposals[renderer]).toBe(0)
    const host = await bindingFrame(page)
    const completed = await bindingSnapshot(page)
    expect(completed.phase).toBe('ready')
    expect(completed.failures).toBe(0)
    expect(completed.hostAutoRender).toBe(true)
    expect(completed.rendererId).toBe(renderer)
    expect(completed.rendererDisposals[renderer]).toBe(0)
    expect(
      pixelDifference(reenabled.image, host.image),
      'Removing the gradient must visibly change the actual canvas to nonblank host-only output (same-engine 0.5% / RGB8 criterion)'
    ).toBeGreaterThan(0.005)
    for (const [name, output] of [
      ['grain-baseline', baseline],
      ['grain-host-auto-render-enabled', reenabled],
      ['host-after-grain-release', host],
    ] as const) {
      await attachEvidence(info, `binding-render-path-${name}.png`, {
        body: output.image,
        contentType: 'image/png',
      })
    }
    await attachEvidence(info, 'binding-render-path-draws-and-renderer', {
      body: JSON.stringify(
        {
          initial,
          active,
          released,
          completed,
          frames: {
            baseline: baseline.frame,
            reenabled: reenabled.frame,
            host: host.frame,
          },
        },
        null,
        2
      ),
      contentType: 'application/json',
    })
  })

  for (const mode of ['missing-context', 'duplicate-managed-owner'] as const) {
    test(`${mode} is a real typed consumer failure, not a swallowed success or damaged host`, async ({
      page,
    }, info) => {
      await supportOwnership(page, info)
      const initial = await page.evaluate(() =>
        (window as unknown as LifecycleWindow).gradientOwnership.snapshot()
      )
      const failed = await page.evaluate(
        (mode) =>
          (window as unknown as LifecycleWindow).gradientOwnership.run(mode),
        mode
      )
      const expectedCode =
        mode === 'duplicate-managed-owner'
          ? 'duplicate-managed'
          : 'missing-context'
      expect(
        failed.errors.some(
          (error) => error.code === expectedCode && error.message.length > 0
        )
      ).toBe(true)
      expect(failed.host.contextLost).toBe(false)
      if (mode === 'duplicate-managed-owner') {
        expect(failed.nativeMeshCount).toBe(1)
        expect(failed.nativeLightCount).toBeGreaterThan(0)
      }
      const cleared = await page.evaluate(() =>
        (window as unknown as LifecycleWindow).gradientOwnership.clear()
      )
      expectHostPreserved(initial, cleared)
      expect(cleared.nativeMeshCount).toBe(0)
      expect(cleared.nativeLightCount).toBe(0)
    })
  }
})

test('orchestrator-owned actual Vite hot edit updates the live public scene and restores without reload or duplicated work', async ({
  page,
  request,
}, info) => {
  const config = project(info)!
  test.skip(
    config.mode !== 'development',
    'Real Vite HMR runs only against the temporary development consumer'
  )
  expect(
    config.hmrURL,
    'Real HMR requires an orchestrator-owned temporary copy/control endpoint'
  ).toBeTruthy()
  const base = config.hmrURL.replace(/\/$/, '')
  const updates: unknown[] = []
  let connected = false
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(payload.toString())
        if (message.type === 'connected') connected = true
        if (message.type === 'update') updates.push(message)
      } catch {
        /* Non-JSON websocket traffic is not evidence of a Vite update. */
      }
    })
  )
  const errors = browserErrors(page)
  await page.goto(`${base}/`)
  await page.waitForFunction(
    () => !!(window as unknown as LifecycleWindow).gradientHmr
  )
  await expect
    .poll(() => connected, {
      message:
        'Wait for the actual Vite connected protocol frame before editing',
    })
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixture = (window as unknown as LifecycleWindow).gradientHmr
        const snapshot = fixture.snapshot()
        const { renderer } = fixture.refs()
        return (
          snapshot.frames > 0 &&
          snapshot.meshUuid.length > 0 &&
          !renderer.getContext().isContextLost() &&
          renderer.domElement.width > 0 &&
          renderer.domElement.height > 0
        )
      })
    )
    .toBe(true)
  await page.evaluate(() => {
    ;(window as unknown as LifecycleWindow).__lifecycleDocument =
      'hmr-not-navigation'
  })
  const before = await page.evaluate(() =>
    (window as unknown as LifecycleWindow).gradientHmr.snapshot()
  )
  const beforeImage = await page.locator('canvas').first().screenshot()
  const readColor = () =>
    page.evaluate(() => {
      const refs = (window as unknown as LifecycleWindow).gradientHmr.refs()
      const meshes: Mesh[] = []
      refs.scene.traverse((object) => {
        if (object.name === 'shadergradient-mesh') meshes.push(object as Mesh)
      })
      const material = meshes[0].material as Material
      return {
        meshes: meshes.length,
        color: [
          material.userData.uC1r.value,
          material.userData.uC1g.value,
          material.userData.uC1b.value,
        ],
      }
    })
  const initialColor = await readColor()
  const action = async (
    name: 'apply' | 'restore',
    client: APIRequestContext = request
  ) => {
    const response = await client.post(`${base}/${name}`)
    expect(response.ok()).toBe(true)
    return response.json()
  }
  try {
    const applied = await action('apply')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).gradientHmr.snapshot().marker
        )
      )
      .toBe(applied.marker)
    await expect.poll(() => updates.length).toBeGreaterThan(0)
    await expect
      .poll(async () => (await readColor()).color)
      .not.toEqual(initialColor.color)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).gradientHmr.snapshot().frames
        )
      )
      .toBeGreaterThan(before.frames)
    expect(
      await page.evaluate(
        () => (window as unknown as LifecycleWindow).__lifecycleDocument
      )
    ).toBe('hmr-not-navigation')
    expect((await readColor()).meshes).toBe(1)
    expect(
      (await page.locator('canvas').first().screenshot()).equals(beforeImage)
    ).toBe(false)
    const live = await page.evaluate(() =>
      (window as unknown as LifecycleWindow).gradientHmr.snapshot()
    )
    expect(live.errors).toEqual([])
    expect(live.canvasIdentity).toBe(before.canvasIdentity)
    expect(live.rendererIdentity).toBe(before.rendererIdentity)
    expect(live.meshUuid).toBe(before.meshUuid)
    expect(live.color1.toLowerCase()).toBe(applied.color1.toLowerCase())
    const statusResponse = await request.get(`${base}/status`)
    expect(statusResponse.ok()).toBe(true)
    const status = await statusResponse.json()
    expect(status.revision).toBe(applied.revision)
    expect(
      status.updates.some(
        (event: { type: string; path: string }) =>
          event.type === 'update' && event.path.length > 0
      )
    ).toBe(true)
    await attachEvidence(info, 'real-hot-edit-vite-update-and-live-scene', {
      body: JSON.stringify({
        before,
        applied,
        live,
        status,
        websocketUpdates: updates,
      }),
      contentType: 'application/json',
    })
  } finally {
    const restored = await action('restore')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as LifecycleWindow).gradientHmr.snapshot().marker
        )
      )
      .toBe(restored.marker)
    await expect
      .poll(async () => (await readColor()).color)
      .toEqual(initialColor.color)
    expect((await readColor()).meshes).toBe(1)
    expect(
      await page.evaluate(
        () => (window as unknown as LifecycleWindow).__lifecycleDocument
      )
    ).toBe('hmr-not-navigation')
  }
  expect(errors).toEqual([])
})
