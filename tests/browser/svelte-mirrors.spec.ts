import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import type { GradientSettingsInput } from '@shadergradient/svelte'
import { attachEvidence } from './evidence'

/**
 * F25 consumes the frozen F19 v1 fixture directly: no F23 fixture helpers, preparation,
 * SDK internals, or basic-starter assumptions. F28 selects full workspace and
 * independently packed plain/production-Kit consumers on all three engines with
 * nativeSvelte:true, nativeLifecycle:{kind,mode}, and optional fixturePath.
 * Context creation below is real getContext passthrough, not the fixture's
 * ready-frame observed count. Held test GL references prove only their own loss;
 * fixture registrations and latest-context bounds are not universal leak proof.
 * Primary API references: playwright.dev/docs/api/class-page#page-add-init-script,
 * developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getUniform,
 * developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage,
 * svelte.dev/docs/kit/state-management. Preparation belongs to test:e2e once.
 */
type SourceId = 'A' | 'B' | 'C'
type TreeId = 'main' | 'independent'
type ViewId = 'square' | 'wide' | 'tall' | 'independent'
type Failure = { code: string; message: string }
interface SourceConfig {
  mounted: boolean
  source: SourceId
  gradient: GradientSettingsInput
  width: number
  height: number
  pixelDensity: number
  maxDimension: number
  canvas: {
    fov?: number
    envBasePath?: string
    respectReducedMotion?: boolean
    preserveDrawingBuffer?: boolean
    powerPreference?: WebGLPowerPreference
  }
}
interface ViewConfig {
  mounted: boolean
  source: SourceId
  visible: boolean
  width: number
  height: number
  pixelDensity: number
  maxDimension: number
}
interface Observation {
  version: number
  sources: Record<
    SourceId,
    {
      state: {
        status: 'absent' | 'loading' | 'ready' | 'error' | 'disposed'
        generation: number
        error?: Failure
      }
      demand: { visibleViews: number; pendingFrames: number }
      frames: number
      contextIdentity: number | null
      lastFrame: null | {
        sequence: number
        generation: number
        width: number
        height: number
        contextIdentity: number | null
        preserveDrawingBuffer: boolean | null
      }
    }
  >
  trees: Record<TreeId, SourceConfig>
  views: Record<
    ViewId,
    {
      config: ViewConfig
      attached: boolean
      copies: number
      clears: number
      buffer: null | { width: number; height: number }
      pixels: null | { hash: number; nonzeroAlpha: number }
      lastCopy: null | {
        source: SourceId
        generation: number
        sourceWidth: number
        sourceHeight: number
        crop: number[]
        width: number
        height: number
      }
      oracle: null | {
        differingBytes: number
        maxChannelError: number
        width: number
        height: number
      }
      error: Failure | null
    }
  >
  contexts: {
    observed: number
    live: number
    lost: number
    entries: { identity: number; lost: boolean }[]
  }
  resources: Record<string, null>
  duplicate: { enabled: boolean; errors: Failure[] }
  errors: Failure[]
  instrumentation: {
    frameSubscriptions: number
    viewWrappers: number
    pendingRequests: number
    oracleEnabled: boolean
  }
}
interface Mirrors {
  version: number
  snapshot(): Observation
  configureSource(
    tree: TreeId,
    patch: Partial<SourceConfig>
  ): Promise<Observation>
  configureView(id: ViewId, patch: Partial<ViewConfig>): Promise<Observation>
  setDuplicate(enabled: boolean): Promise<Observation>
  setOracle(enabled: boolean): Promise<Observation>
  requestFrame(id: SourceId): Promise<Observation>
  disposeHandle(id: SourceId): Promise<Observation>
  context(id: SourceId): WebGL2RenderingContext | null
}
interface GLRecord {
  id: number
  gl: WebGLRenderingContext | WebGL2RenderingContext
  canvas: HTMLCanvasElement
  scope: string | null
  draws: number
  gradient: null | {
    time: number
    projection: number[]
    program: number
    linked: boolean
  }
}
interface Probe {
  contexts: GLRecord[]
  contexts2D: WeakSet<HTMLCanvasElement>
  refresh(): void
}
interface MirrorWindow {
  gradientFixture: {
    version: number
    mirrors: Mirrors
    lifecycle: { setMounted(value: boolean): Promise<unknown> }
    externalHost: {
      configure(value: { enabled: boolean; gradients: [] }): Promise<unknown>
    }
  }
  __mirrorProbe: Probe
  __mirrorOld?: Mirrors
  __mirrorDocument?: string
  __mirrorPending?: {
    settled: boolean
    result: Observation | null
    error: Failure | null
  }
}
interface Project {
  nativeSvelte?: boolean
  fixturePath?: string
  nativeLifecycle?: {
    kind: 'plain' | 'kit'
    mode: 'development' | 'production'
  }
}
const mainViews: ViewId[] = ['square', 'wide', 'tall']
const allViews: ViewId[] = [...mainViews, 'independent']
const sourceIds: SourceId[] = ['A', 'B', 'C']
const browserErrors = new WeakMap<Page, string[]>()

function project(info: TestInfo) {
  return info.project.metadata as Project
}

async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const host = window as unknown as MirrorWindow
    const contexts: GLRecord[] = []
    const identities = new WeakMap<object, number>()
    const programs = new WeakMap<WebGLProgram, number>()
    const contexts2D = new WeakSet<HTMLCanvasElement>()
    let nextProgram = 0
    const classify = (record: GLRecord) => {
      const region = record.canvas.closest(
        '[data-testid^="mirror-source-"], [data-testid="mirror-duplicate"], [data-testid^="mirror-view-"]'
      )
      if (region) record.scope = region.getAttribute('data-testid')
    }
    const refresh = () => {
      for (const record of contexts) classify(record)
    }
    host.__mirrorProbe = { contexts, contexts2D, refresh }
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        const result: unknown = Reflect.apply(original, this, args)
        if (args[0] === '2d' && result) contexts2D.add(this)
        if (
          (args[0] === 'webgl' ||
            args[0] === 'webgl2' ||
            args[0] === 'experimental-webgl') &&
          result &&
          !identities.has(result as object)
        ) {
          const id = contexts.length + 1
          identities.set(result as object, id)
          const record: GLRecord = {
            id,
            gl: result as GLRecord['gl'],
            canvas: this,
            scope: null,
            draws: 0,
            gradient: null,
          }
          classify(record)
          contexts.push(record)
        }
        return result
      },
    })
    // Retain the last real gradient draw, not the last grain/composer program.
    // uTime and projectionMatrix are queried from actual linked GL programs.
    for (const prototype of [
      typeof WebGLRenderingContext === 'undefined'
        ? null
        : WebGLRenderingContext.prototype,
      typeof WebGL2RenderingContext === 'undefined'
        ? null
        : WebGL2RenderingContext.prototype,
    ]) {
      if (!prototype) continue
      for (const key of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ] as const) {
        const draw = Object.getOwnPropertyDescriptor(prototype, key)?.value as
          ((...args: number[]) => void) | undefined
        if (typeof draw !== 'function') continue
        Object.defineProperty(prototype, key, {
          configurable: true,
          writable: true,
          value: function (this: GLRecord['gl'], ...args: number[]) {
            const result: unknown = Reflect.apply(draw, this, args)
            const identity = identities.get(this)
            if (!identity || this.isContextLost()) return result
            const record = contexts[identity - 1]
            classify(record)
            record.draws++
            const program = this.getParameter(
              this.CURRENT_PROGRAM
            ) as WebGLProgram | null
            if (!program) return result
            const timeLocation = this.getUniformLocation(program, 'uTime')
            if (timeLocation === null) return result
            const time: unknown = this.getUniform(program, timeLocation)
            if (typeof time !== 'number') return result
            const projectionLocation = this.getUniformLocation(
              program,
              'projectionMatrix'
            )
            const projection: unknown =
              projectionLocation === null
                ? null
                : this.getUniform(program, projectionLocation)
            if (!programs.has(program)) programs.set(program, ++nextProgram)
            record.gradient = {
              time,
              projection:
                projection instanceof Float32Array
                  ? Array.from(projection)
                  : [],
              program: programs.get(program)!,
              linked: !!this.getProgramParameter(program, this.LINK_STATUS),
            }
            return result
          },
        })
      }
    }
    new MutationObserver(refresh).observe(document, {
      subtree: true,
      childList: true,
    })
  })
}

async function snapshot(page: Page) {
  return page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.snapshot()
  )
}
async function source(page: Page, tree: TreeId, patch: Partial<SourceConfig>) {
  await page.evaluate(
    ({ tree, patch }) =>
      (
        window as unknown as MirrorWindow
      ).gradientFixture.mirrors.configureSource(tree, patch),
    { tree, patch }
  )
}
async function view(page: Page, id: ViewId, patch: Partial<ViewConfig>) {
  await page.evaluate(
    ({ id, patch }) =>
      (window as unknown as MirrorWindow).gradientFixture.mirrors.configureView(
        id,
        patch
      ),
    { id, patch }
  )
}
async function frame(page: Page, id: SourceId) {
  return page.evaluate(
    (id) =>
      (window as unknown as MirrorWindow).gradientFixture.mirrors.requestFrame(
        id
      ),
    id
  )
}
async function waitFor(
  page: Page,
  predicate: (state: Observation) => boolean,
  message: string
) {
  await expect
    .poll(async () => predicate(await snapshot(page)), {
      message,
      timeout: 20000,
    })
    .toBe(true)
  return snapshot(page)
}
async function idle(page: Page) {
  let previous = ''
  let equal = 0
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        const contexts = await probe(page)
        const value = JSON.stringify({
          sources: state.sources,
          views: allViews.map((id) => ({
            copies: state.views[id].copies,
            buffer: state.views[id].buffer,
          })),
          sourceDraws: contexts
            .filter((record) => record.scope?.startsWith('mirror-source-'))
            .map((record) => ({
              id: record.id,
              draws: record.draws,
              lost: record.lost,
              gradient: record.gradient,
            })),
          contextCreations: contexts.length,
        })
        equal = value === previous ? equal + 1 : 0
        previous = value
        return (
          equal >= 3 &&
          sourceIds.every((id) => {
            const source = state.sources[id]
            if (source.demand.pendingFrames === 0) return true
            // Visible Views may own stable deferred frame leases before their
            // producer exists. Those leases are demand, not ongoing GPU work.
            // Ready/loading producers must still drain all pending frame work;
            // explicit fixture requests must settle independently below.
            return (
              source.state.status === 'absent' &&
              source.demand.pendingFrames <= source.demand.visibleViews &&
              !Object.values(state.trees).some(
                (tree) => tree.mounted && tree.source === id
              ) &&
              !state.contexts.entries.some(
                (entry) =>
                  entry.identity === source.contextIdentity && !entry.lost
              )
            )
          }) &&
          state.instrumentation.pendingRequests === 0
        )
      },
      {
        message: 'paused real frame/copy work and one-shot requests settle',
        intervals: [50, 75, 100],
        timeout: 20000,
      }
    )
    .toBe(true)
  return snapshot(page)
}
async function probe(page: Page) {
  return page.evaluate(() => {
    const host = window as unknown as MirrorWindow
    const observed = host.__mirrorProbe
    observed.refresh()
    // Match the actual public completed-frame GL as well as the DOM scope.
    for (const id of ['A', 'B', 'C'] as const) {
      const gl = host.gradientFixture?.mirrors?.context(id)
      const record = observed.contexts.find((record) => record.gl === gl)
      if (record && !record.scope)
        record.scope = `mirror-source-${id === 'B' ? 'independent' : 'main'}`
    }
    return observed.contexts.map((record) => ({
      id: record.id,
      scope: record.scope,
      lost: record.gl.isContextLost(),
      connected: record.canvas.isConnected,
      width: record.canvas.width,
      height: record.canvas.height,
      draws: record.draws,
      gradient: record.gradient,
      preserveDrawingBuffer:
        record.gl.getContextAttributes()?.preserveDrawingBuffer ?? null,
    }))
  })
}
async function sourceGL(page: Page, id: SourceId) {
  const identity = await page.evaluate((id) => {
    const host = window as unknown as MirrorWindow
    return (
      host.__mirrorProbe.contexts.find(
        (record) => record.gl === host.gradientFixture.mirrors.context(id)
      )?.id ?? null
    )
  }, id)
  expect(
    identity,
    `Source ${id} must expose the real GL observed by pre-mount creation instrumentation`
  ).not.toBeNull()
  const record = (await probe(page)).find((record) => record.id === identity)!
  expect(record.lost).toBe(false)
  expect(record.gradient?.linked).toBe(true)
  expect(
    record.preserveDrawingBuffer,
    'all default Source copies work with actual PDB=false'
  ).toBe(false)
  return record
}
async function expectLost(page: Page, identity: number) {
  await expect
    .poll(
      async () =>
        (await probe(page)).find((record) => record.id === identity)?.lost,
      { message: 'held actual source GL is lost on its owned release' }
    )
    .toBe(true)
}
async function pixels(page: Page, id: ViewId, diversity = true) {
  const result = await page
    .getByTestId(`mirror-view-${id}`)
    .locator('canvas')
    .evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement
      const host = window as unknown as MirrorWindow
      const context = element.getContext('2d')
      if (!context) throw new Error('A native View must own a real 2D context')
      const bytes = context.getImageData(
        0,
        0,
        element.width,
        element.height
      ).data
      let alpha = 0
      const colors = new Set<number>()
      for (let index = 0; index < bytes.length; index += 4) {
        if (bytes[index + 3]) alpha++
        colors.add(
          (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2]
        )
      }
      return {
        alpha,
        colors: colors.size,
        recorded2D: host.__mirrorProbe.contexts2D.has(element),
        gpu: host.__mirrorProbe.contexts.some(
          (record) => record.canvas === element
        ),
      }
    })
  expect(result.recorded2D).toBe(true)
  expect(result.gpu, 'a View does not create its own WebGL scene').toBe(false)
  expect(result.alpha).toBeGreaterThan(0)
  if (diversity)
    expect(result.colors, 'actual mirrored RGB is nonuniform').toBeGreaterThan(
      8
    )
}
function cover(state: Observation, id: ViewId, sourceId: SourceId) {
  const current = state.views[id]
  const copy = current.lastCopy!
  const completed = state.sources[sourceId].lastFrame!
  expect(current.error).toBeNull()
  expect(copy.source).toBe(sourceId)
  expect(copy.generation).toBe(state.sources[sourceId].state.generation)
  expect([copy.sourceWidth, copy.sourceHeight]).toEqual([
    completed.width,
    completed.height,
  ])
  expect([copy.width, copy.height]).toEqual([
    current.buffer!.width,
    current.buffer!.height,
  ])
  // Independent geometric oracle: select the limiting source edge by aspect,
  // then require a centered rectangle exhausting that edge, not copied draw args.
  const sourceAspect = copy.sourceWidth / copy.sourceHeight
  const viewAspect = copy.width / copy.height
  const width =
    sourceAspect > viewAspect
      ? copy.sourceHeight * viewAspect
      : copy.sourceWidth
  const height =
    sourceAspect > viewAspect
      ? copy.sourceHeight
      : copy.sourceWidth / viewAspect
  const expected = [
    (copy.sourceWidth - width) / 2,
    (copy.sourceHeight - height) / 2,
    width,
    height,
    0,
    0,
    copy.width,
    copy.height,
  ]
  expect(copy.crop).toHaveLength(8)
  copy.crop.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index], 7)
  )
  expect(
    current.oracle,
    'oracle borrows this actual completed final frame synchronously'
  ).not.toBeNull()
  expect(current.oracle!.differingBytes).toBe(0)
  expect(current.oracle!.maxChannelError).toBe(0)
}
function copies(
  before: Observation,
  after: Observation,
  sourceId: SourceId,
  ids: ViewId[],
  resizeAllowance = 0
) {
  const completed =
    after.sources[sourceId].frames - before.sources[sourceId].frames
  expect(completed).toBeGreaterThanOrEqual(0)
  const count = ids.reduce(
    (sum, id) => sum + after.views[id].copies - before.views[id].copies,
    0
  )
  expect(
    count,
    'copies are bounded by real completed frames × eligible Views plus explicit resize invalidations'
  ).toBeLessThanOrEqual(completed * ids.length + resizeAllowance)
  return completed
}
function unchanged(
  before: Observation,
  after: Observation,
  sourceId: SourceId,
  ids: ViewId[]
) {
  expect(after.sources[sourceId]).toEqual(before.sources[sourceId])
  for (const id of ids) expect(after.views[id]).toEqual(before.views[id])
}
async function blank(page: Page, ids: ViewId[]) {
  await waitFor(
    page,
    (state) =>
      ids.every(
        (id) =>
          state.views[id].attached && state.views[id].pixels?.nonzeroAlpha === 0
      ),
    'old producer pixels clear rather than displaying a stale lastCopy'
  )
}
async function ready(
  page: Page,
  id: SourceId = 'A',
  ids: ViewId[] = mainViews
) {
  return waitFor(
    page,
    (state) =>
      state.sources[id].state.status === 'ready' &&
      ids.every((viewId) => {
        const value = state.views[viewId]
        return (
          value.attached &&
          value.copies > 0 &&
          (value.pixels?.nonzeroAlpha ?? 0) > 0 &&
          value.lastCopy?.source === id &&
          value.lastCopy.generation === state.sources[id].state.generation
        )
      }),
    `Source ${id} publishes real nonblank current-generation 2D copies`
  )
}
async function open(
  page: Page,
  info: TestInfo,
  path = project(info).fixturePath ?? '/'
) {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await installProbe(page)
  await page.goto(path)
  await page.waitForFunction(
    () =>
      (window as unknown as MirrorWindow).gradientFixture?.mirrors?.version ===
      1
  )
  // Other example Canvases are not Source constructors; quiesce only their public
  // fixture controls and still scope all GL evidence to real Source canvases.
  await page.evaluate(async () => {
    const fixture = (window as unknown as MirrorWindow).gradientFixture
    await fixture.lifecycle.setMounted(false)
    await fixture.externalHost.configure({ enabled: false, gradients: [] })
  })
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await waitFor(
    page,
    (state) =>
      state.sources.A.demand.visibleViews === 3 &&
      state.sources.B.demand.visibleViews === 1,
    'native intersection demand for all four actual View wrappers'
  )
  await ready(page, 'B', ['independent'])
  await page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.setOracle(true)
  )
  return idle(page)
}
async function mount(page: Page) {
  await source(page, 'main', { mounted: true })
  await ready(page)
  await frame(page, 'A')
  return idle(page)
}
async function noTicker(page: Page) {
  const before = await idle(page)
  const beforeDraws = (await probe(page)).filter((record) =>
    record.scope?.startsWith('mirror-source-')
  )
  await page.waitForTimeout(300)
  const after = await snapshot(page)
  const afterDraws = (await probe(page)).filter((record) =>
    record.scope?.startsWith('mirror-source-')
  )
  expect(
    afterDraws,
    'idle sources do not draw or advance actual GL uniforms'
  ).toEqual(beforeDraws)
  for (const id of sourceIds)
    expect(after.sources[id].frames).toBe(before.sources[id].frames)
  for (const id of allViews)
    expect(after.views[id].copies).toBe(before.views[id].copies)
  return after
}

test.beforeEach(async ({}, info) => {
  const metadata = project(info)
  if (/svelte/i.test(info.project.name))
    expect(
      metadata.nativeSvelte,
      'native project selection must be explicit, not a missing fixture skip'
    ).toBe(true)
  test.skip(
    metadata.nativeSvelte !== true,
    'F25 applies only to full native public consumer projects'
  )
  expect(
    metadata.nativeLifecycle?.kind,
    'F28 supplies plain/Kit metadata for every full qualification consumer'
  ).toMatch(/^(plain|kit)$/)
  expect(metadata.nativeLifecycle?.mode).toMatch(/^(development|production)$/)
})
test.afterEach(async ({ page, browserName }, info) => {
  if (project(info).nativeSvelte !== true) return
  const evidence = await page
    .evaluate(() => {
      const host = window as unknown as MirrorWindow
      const mirrors = host.gradientFixture?.mirrors
      return {
        capabilities: {
          webgl2: typeof WebGL2RenderingContext !== 'undefined',
          intersectionObserver: typeof IntersectionObserver !== 'undefined',
          resizeObserver: typeof ResizeObserver !== 'undefined',
          dpr: devicePixelRatio,
        },
        observation: mirrors?.snapshot() ?? null,
      }
    })
    .catch(() => null)
  const contexts = await probe(page).catch(() => null)
  await attachEvidence(info, 'native-mirrors-evidence', {
    contentType: 'application/json',
    body: JSON.stringify({
      browserName,
      project: info.project.name,
      metadata: project(info),
      evidence,
      contexts,
      browserErrors: browserErrors.get(page) ?? [],
    }),
  })
  expect(
    browserErrors.get(page) ?? [],
    'unexpected uncaught consumer/browser failures'
  ).toEqual([])
  if (evidence?.observation) {
    expect(
      evidence.observation.errors,
      'unexpected actual Source/View failures'
    ).toEqual([])
    expect(evidence.observation.contexts.entries.length).toBeLessThanOrEqual(3)
    expect(
      Object.values(evidence.observation.resources).every(
        (value) => value === null
      ),
      'unobservable resource inventories remain honest nulls'
    ).toBe(true)
  }
})

test('views before producer: late final-grain readiness, three independent cover geometries, one GPU and idle copy budget', async ({
  page,
}, info) => {
  const initial = await open(page, info)
  expect(initial.sources.A.state).toEqual({ status: 'absent', generation: 0 })
  expect(initial.sources.A.frames).toBe(0)
  for (const id of mainViews)
    expect(initial.views[id].pixels?.nonzeroAlpha).toBe(0)
  expect(
    (await probe(page)).filter(
      (record) => record.scope === 'mirror-source-main'
    )
  ).toHaveLength(0)
  const beforeCreations = (await probe(page)).length
  const result = await mount(page)
  const gl = await sourceGL(page, 'A')
  expect(gl.gradient!.time).toBeCloseTo(2, 6)
  expect((await sourceGL(page, 'B')).gradient!.time).toBeCloseTo(7, 6)
  expect((await sourceGL(page, 'B')).preserveDrawingBuffer).toBe(false)
  expect(gl.preserveDrawingBuffer).toBe(false)
  expect(result.sources.A.lastFrame!.preserveDrawingBuffer).toBe(false)
  expect(
    (await probe(page)).length - beforeCreations,
    'one actual Source constructor, not three View WebGL canvases'
  ).toBe(1)
  expect(
    (await probe(page)).filter(
      (record) => record.scope === 'mirror-source-main' && !record.lost
    )
  ).toHaveLength(1)
  expect(result.contexts.observed).toBe(2)
  expect(result.contexts.live).toBe(2)
  for (const id of mainViews) {
    await pixels(page, id)
    cover(result, id, 'A')
  }
  const ratios = mainViews.map(
    (id) => result.views[id].buffer!.width / result.views[id].buffer!.height
  )
  expect(ratios[0]).toBe(1)
  expect(ratios[1]).toBeGreaterThan(2)
  expect(ratios[2]).toBeLessThan(1)
  copies(initial, result, 'A', mainViews)
  const before = await idle(page)
  await frame(page, 'A')
  const after = await idle(page)
  expect(copies(before, after, 'A', mainViews)).toBe(1)
  for (const id of mainViews)
    expect(after.views[id].copies - before.views[id].copies).toBe(1)
  unchanged(before, after, 'B', ['independent'])
  await noTicker(page)
})

test('mirrors copy the final grain result, not a pre-composer raw frame', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const gl = await sourceGL(page, 'A')
  await source(page, 'main', { gradient: { grain: 'off' } })
  await frame(page, 'A')
  const clean = await idle(page)
  await source(page, 'main', { gradient: { grain: 'on', grainBlending: 1 } })
  await waitFor(
    page,
    (state) =>
      state.sources.A.frames > clean.sources.A.frames &&
      mainViews.every(
        (id) => state.views[id].pixels!.hash !== clean.views[id].pixels!.hash
      ),
    'grain changes actual final mirrored bytes while paused at identical shader time'
  )
  const final = await idle(page)
  for (const id of mainViews) {
    await pixels(page, id)
    cover(final, id, 'A')
  }
  copies(clean, final, 'A', mainViews)
  unchanged(clean, final, 'B', ['independent'])
  const current = await sourceGL(page, 'A')
  expect(current.id).toBe(gl.id)
  expect(current.gradient!.time).toBeCloseTo(2, 6)
  expect(current.preserveDrawingBuffer).toBe(false)
  expect(final.sources.A.state.generation).toBe(
    clean.sources.A.state.generation
  )
  await noTicker(page)
})

test('producer first reserves its handle without GPU; a pre-producer frame lease waits for real late readiness', async ({
  page,
}, info) => {
  await open(page, info)
  for (const id of mainViews) await view(page, id, { mounted: false })
  await waitFor(
    page,
    (state) =>
      state.sources.A.demand.visibleViews === 0 &&
      state.sources.A.demand.pendingFrames === 0,
    'last waiting View releases demand'
  )
  const constructors = (await probe(page)).length
  await source(page, 'main', { mounted: true })
  const loading = await waitFor(
    page,
    (state) => state.sources.A.state.status === 'loading',
    'producer registration without demand remains reserved/loading'
  )
  expect(loading.sources.A.frames).toBe(0)
  expect((await probe(page)).length).toBe(constructors)
  await page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.setDuplicate(
      true
    )
  )
  const reserved = await waitFor(
    page,
    (state) => state.duplicate.errors.length === 1,
    'zero-demand producer still owns its exclusive reservation'
  )
  expect(reserved.duplicate.errors[0].code).toBe('duplicate-producer')
  expect(reserved.sources.A.state).toEqual(loading.sources.A.state)
  expect((await probe(page)).length).toBe(constructors)
  await page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.setDuplicate(
      false
    )
  )
  await view(page, 'square', { mounted: true })
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await ready(page, 'A', ['square'])
  await pixels(page, 'square')
  expect((await probe(page)).length).toBe(constructors + 1)
  await source(page, 'main', { mounted: false })
  await blank(page, ['square'])
  await page.evaluate(() => {
    const host = window as unknown as MirrorWindow
    const pending = (host.__mirrorPending = {
      settled: false,
      result: null,
      error: null,
    } as NonNullable<MirrorWindow['__mirrorPending']>)
    void host.gradientFixture.mirrors.requestFrame('A').then(
      (result) => {
        pending.result = result
        pending.settled = true
      },
      (cause: Failure) => {
        pending.error = { code: cause.code, message: cause.message }
        pending.settled = true
      }
    )
  })
  await waitFor(
    page,
    (state) =>
      state.sources.A.state.status === 'absent' &&
      state.sources.A.demand.pendingFrames > 0 &&
      state.instrumentation.pendingRequests === 1,
    'actual request lease waits while producer is absent'
  )
  expect(
    await page.evaluate(
      () => (window as unknown as MirrorWindow).__mirrorPending!.settled
    )
  ).toBe(false)
  const before = await snapshot(page)
  await source(page, 'main', { mounted: true })
  await ready(page, 'A', ['square'])
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as MirrorWindow).__mirrorPending!.settled
      )
    )
    .toBe(true)
  const pending = await page.evaluate(
    () => (window as unknown as MirrorWindow).__mirrorPending
  )
  expect(pending!.error).toBeNull()
  expect(pending!.result!.sources.A.frames).toBeGreaterThan(
    before.sources.A.frames
  )
  expect((await idle(page)).instrumentation.pendingRequests).toBe(0)
  expect((await sourceGL(page, 'A')).gradient!.time).toBeCloseTo(2, 6)
  await noTicker(page)
})

test('delayed real HDR suppresses readiness and stale copies until the selected environment completes', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
  let requested = false
  await page.route('**/*.hdr', async (route) => {
    requested = true
    await gate
    await route.continue()
  })
  try {
    const before = await idle(page)
    await source(page, 'main', {
      gradient: { lightType: 'env', envPreset: 'city' },
    })
    await expect
      .poll(() => requested, {
        message: 'the actual selected HDR request reaches the gate',
      })
      .toBe(true)
    const loading = await waitFor(
      page,
      (state) => state.sources.A.state.status === 'loading',
      'environment readiness is not settings echo'
    )
    await blank(page, mainViews)
    await page.waitForTimeout(150)
    const delayed = await snapshot(page)
    expect(delayed.sources.A.frames).toBe(loading.sources.A.frames)
    for (const id of mainViews)
      expect(delayed.views[id].copies).toBe(loading.views[id].copies)
    unchanged(before, delayed, 'B', ['independent'])
    release()
    await ready(page)
    const result = await idle(page)
    for (const id of mainViews) {
      await pixels(page, id)
      cover(result, id, 'A')
    }
  } finally {
    release()
    await page.unroute('**/*.hdr')
  }
})

test('typed duplicate rejection preserves the real original and independent producers across repeated attempts and remount', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const original = await sourceGL(page, 'A')
  const independent = await sourceGL(page, 'B')
  const initial = await idle(page)
  const count = (await probe(page)).length
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.evaluate(() =>
      (window as unknown as MirrorWindow).gradientFixture.mirrors.setDuplicate(
        true
      )
    )
    const state = await waitFor(
      page,
      (state) => state.duplicate.errors.length === attempt,
      'dedicated onError captures exactly one original typed error before Kit boundary sanitization'
    )
    expect(state.duplicate.errors.map((error) => error.code)).toEqual(
      Array(attempt).fill('duplicate-producer')
    )
    expect(
      state.duplicate.errors.every((error) => error.message.trim().length > 0)
    ).toBe(true)
    const alert = page.getByTestId('mirror-duplicate-error')
    await expect(alert).toContainText('duplicate-producer')
    expect(state.sources.A.state).toEqual(initial.sources.A.state)
    expect((await sourceGL(page, 'A')).id).toBe(original.id)
    expect((await sourceGL(page, 'B')).id).toBe(independent.id)
    expect((await probe(page)).length).toBe(count)
    for (const id of mainViews) await pixels(page, id)
    await page.evaluate(() =>
      (window as unknown as MirrorWindow).gradientFixture.mirrors.setDuplicate(
        false
      )
    )
    await expect(alert).toHaveCount(0)
  }
  await page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.setDuplicate(
      true
    )
  )
  await waitFor(
    page,
    (state) => state.duplicate.errors.length === 3,
    'third explicit attempt'
  )
  await source(page, 'main', { mounted: false })
  await blank(page, mainViews)
  await expectLost(page, original.id)
  await source(page, 'main', { mounted: true })
  const remounted = await waitFor(
    page,
    (state) =>
      state.duplicate.errors.length === 4 &&
      state.sources.A.state.status === 'ready',
    'enabled duplicate remount gets a fresh typed attempt capture'
  )
  expect(remounted.duplicate.errors.map((error) => error.code)).toEqual(
    Array(4).fill('duplicate-producer')
  )
  await ready(page)
  expect((await sourceGL(page, 'A')).id).not.toBe(original.id)
  expect((await sourceGL(page, 'B')).id).toBe(independent.id)
  expect((await probe(page)).length).toBe(count + 1)
  expect(remounted.errors).toEqual([])
})

test('reactive parameters and View/producer rebinding isolate per-tree handles and clear stale pixels', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const initial = await idle(page)
  const gl = await sourceGL(page, 'A')
  const hash = initial.views.square.pixels!.hash
  await source(page, 'main', {
    gradient: {
      color1: '#0612ee',
      color2: '#ee1206',
      color3: '#1bee38',
      uTime: 3.25,
    },
  })
  await waitFor(
    page,
    (state) =>
      state.sources.A.frames > initial.sources.A.frames &&
      state.views.square.pixels!.hash !== hash,
    'reactive producer settings change actual copied pixels'
  )
  const changed = await idle(page)
  expect((await sourceGL(page, 'A')).id).toBe(gl.id)
  expect((await sourceGL(page, 'A')).gradient!.time).toBeCloseTo(3.25, 6)
  expect(changed.sources.A.state.generation).toBe(
    initial.sources.A.state.generation
  )
  unchanged(initial, changed, 'B', ['independent'])
  copies(initial, changed, 'A', mainViews)
  await view(page, 'wide', { source: 'B' })
  await ready(page, 'B', ['wide', 'independent'])
  const rebound = await idle(page)
  cover(rebound, 'wide', 'B')
  expect(rebound.views.wide.pixels!.hash).not.toBe(
    changed.views.wide.pixels!.hash
  )
  expect(rebound.sources.A.demand.visibleViews).toBe(2)
  expect(rebound.sources.B.demand.visibleViews).toBe(2)
  const creations = (await probe(page)).length
  await source(page, 'main', { source: 'C' })
  await waitFor(
    page,
    (state) =>
      state.sources.A.state.status === 'absent' &&
      state.sources.C.state.status === 'loading',
    'producer registration moves from A to explicit C handle'
  )
  await blank(page, ['square', 'tall'])
  await expectLost(page, gl.id)
  expect((await probe(page)).length).toBe(creations)
  expect((await snapshot(page)).sources.C.frames).toBe(0)
  for (const id of ['square', 'tall'] as const)
    await view(page, id, { source: 'C' })
  await ready(page, 'C', ['square', 'tall'])
  const current = await idle(page)
  for (const id of ['square', 'tall'] as const) {
    await pixels(page, id)
    cover(current, id, 'C')
  }
  cover(current, 'wide', 'B')
  expect((await sourceGL(page, 'C')).gradient!.time).toBeCloseTo(3.25, 6)
  expect((await sourceGL(page, 'B')).gradient!.time).toBeCloseTo(7, 6)
  const before = await idle(page)
  await source(page, 'independent', {
    gradient: { color1: '#06ef25', uTime: 9 },
  })
  await waitFor(
    page,
    (state) =>
      state.sources.B.frames > before.sources.B.frames &&
      state.views.wide.pixels!.hash !== before.views.wide.pixels!.hash,
    'B parameter update reaches both actual B views'
  )
  const after = await idle(page)
  unchanged(before, after, 'C', ['square', 'tall'])
  copies(before, after, 'B', ['wide', 'independent'])
  expect((await sourceGL(page, 'B')).gradient!.time).toBeCloseTo(9, 6)
})

test('paused resize, DPR and edge caps refresh fresh final frames without time, context or generation churn', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const initial = await idle(page)
  const original = await sourceGL(page, 'A')
  const creations = (await probe(page)).length
  const cases = [
    {
      width: 320,
      height: 213,
      pixelDensity: 2,
      maxDimension: 320,
      expected: [320, 213],
    },
    {
      width: 192,
      height: 96,
      pixelDensity: 0.25,
      maxDimension: 2048,
      expected: [48, 24],
    },
    {
      width: 256,
      height: 128,
      pixelDensity: 2,
      maxDimension: 1,
      expected: [1, 1],
    },
  ]
  for (const entry of cases) {
    const before = await idle(page)
    const { expected, ...patch } = entry
    await view(page, 'wide', patch)
    await waitFor(
      page,
      (state) =>
        state.views.wide.copies > before.views.wide.copies &&
        state.views.wide.buffer?.width === expected[0] &&
        state.views.wide.buffer.height === expected[1],
      'paused View resize waits for a fresh real completed frame at bounded DPR'
    )
    const after = await idle(page)
    expect(after.sources.A.frames).toBeGreaterThan(before.sources.A.frames)
    copies(before, after, 'A', mainViews, 1)
    cover(after, 'wide', 'A')
    await pixels(page, 'wide', expected[0] > 1)
    expect(after.sources.A.state.generation).toBe(
      initial.sources.A.state.generation
    )
    expect((await sourceGL(page, 'A')).id).toBe(original.id)
    expect((await sourceGL(page, 'A')).gradient!.time).toBeCloseTo(2, 6)
    unchanged(before, after, 'B', ['independent'])
  }
  const sourceCases = [
    {
      width: 800,
      height: 400,
      pixelDensity: 2,
      maxDimension: 600,
      fov: 51,
      expected: [600, 300],
    },
    {
      width: 320,
      height: 160,
      pixelDensity: 0.25,
      maxDimension: 2048,
      fov: 39,
      expected: [80, 40],
    },
    {
      width: 1024,
      height: 512,
      pixelDensity: 2,
      maxDimension: 1,
      fov: 47,
      expected: [1, 1],
    },
    {
      width: 480,
      height: 320,
      pixelDensity: 1,
      maxDimension: 2048,
      fov: 45,
      expected: [480, 320],
    },
  ]
  for (const entry of sourceCases) {
    const before = await idle(page)
    const { expected, fov, ...patch } = entry
    await source(page, 'main', { ...patch, canvas: { fov } })
    await waitFor(
      page,
      (state) =>
        state.sources.A.frames > before.sources.A.frames &&
        state.sources.A.lastFrame?.width === expected[0] &&
        state.sources.A.lastFrame.height === expected[1] &&
        state.views.square.copies > before.views.square.copies,
      'source cap and positive 1×1 edge are real framebuffer dimensions'
    )
    const after = await idle(page)
    const current = await sourceGL(page, 'A')
    expect(current.id).toBe(original.id)
    expect(after.sources.A.state.generation).toBe(
      initial.sources.A.state.generation
    )
    expect(current.gradient!.time).toBeCloseTo(2, 6)
    const projection = current.gradient!.projection
    expect(projection).toHaveLength(16)
    expect(
      projection[5] / projection[0],
      'camera keeps CSS aspect even when raster quantization produces 1×1'
    ).toBeCloseTo(entry.width / entry.height, 5)
    expect(projection[5]).toBeCloseTo(1 / Math.tan((fov * Math.PI) / 360), 5)
    expect(current.preserveDrawingBuffer).toBe(false)
    for (const id of mainViews) {
      cover(after, id, 'A')
      await pixels(
        page,
        id,
        expected[0] > 1 && after.views[id].buffer!.width > 1
      )
    }
    copies(before, after, 'A', mainViews)
    unchanged(before, after, 'B', ['independent'])
  }
  expect((await probe(page)).length).toBe(creations)
  await noTicker(page)
})

test('actual offscreen demand releases GPU, hidden one-shot frames do not copy or advance time, reentry creates a fresh generation', async ({
  page,
}, info) => {
  await open(page, info)
  await mount(page)
  const initial = await idle(page)
  const gl = await sourceGL(page, 'A')
  for (const id of mainViews) await view(page, id, { visible: false })
  const hidden = await waitFor(
    page,
    (state) =>
      state.sources.A.demand.visibleViews === 0 &&
      state.sources.A.demand.pendingFrames === 0 &&
      state.sources.A.state.status === 'loading',
    'real IntersectionObserver demand reaches zero, retaining only producer reservation'
  )
  for (const id of mainViews) {
    const box = await page.getByTestId(`mirror-view-${id}`).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(0)
  }
  await expectLost(page, gl.id)
  await expect(
    page.getByTestId('mirror-source-main').locator('canvas')
  ).toHaveCount(0)
  expect(hidden.sources.A.state.generation).toBeGreaterThan(
    initial.sources.A.state.generation
  )
  const settled = await noTicker(page)
  const before = await idle(page)
  await source(page, 'independent', {
    gradient: { color1: '#08ef10', uTime: 8 },
  })
  await waitFor(
    page,
    (state) =>
      state.sources.B.frames > before.sources.B.frames &&
      state.views.independent.copies > before.views.independent.copies,
    'independent source still renders while main Views are truly offscreen'
  )
  const after = await idle(page)
  unchanged(before, after, 'A', mainViews)
  copies(before, after, 'B', ['independent'])
  const constructors = (await probe(page)).length
  const oneShot = await frame(page, 'A')
  expect(oneShot.sources.A.frames).toBeGreaterThan(settled.sources.A.frames)
  expect(oneShot.sources.A.lastFrame!.preserveDrawingBuffer).toBe(false)
  const released = await waitFor(
    page,
    (state) =>
      state.sources.A.state.status === 'loading' &&
      state.sources.A.demand.pendingFrames === 0 &&
      state.instrumentation.pendingRequests === 0,
    'hidden requestFrame waits for a real completed frame then releases its lease'
  )
  for (const id of mainViews)
    expect(released.views[id].copies).toBe(after.views[id].copies)
  expect((await probe(page)).length).toBe(constructors + 1)
  const hiddenGL = (await probe(page))
    .filter((record) => record.scope === 'mirror-source-main')
    .at(-1)!
  expect(hiddenGL.gradient!.time).toBeCloseTo(2, 6)
  await expectLost(page, hiddenGL.id)
  await expect(
    page.getByTestId('mirror-source-main').locator('canvas')
  ).toHaveCount(0)
  for (const id of mainViews) await view(page, id, { visible: true })
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await ready(page)
  const reentered = await idle(page)
  expect(reentered.sources.A.state.generation).toBeGreaterThan(
    initial.sources.A.state.generation
  )
  expect((await sourceGL(page, 'A')).id).not.toBe(gl.id)
  expect((await sourceGL(page, 'A')).gradient!.time).toBeCloseTo(2, 6)
  for (const id of mainViews) {
    await pixels(page, id)
    cover(reentered, id, 'A')
  }
  expect(reentered.contexts.observed).toBeGreaterThan(initial.contexts.observed)
  expect(reentered.contexts.entries.length).toBeLessThanOrEqual(3)
  await noTicker(page)
})

test('source detach, last subscriber release, repeated mounts and caller-terminal disposal have distinct observable cleanup', async ({
  page,
}, info) => {
  const lifetimeWarnings: {
    diagnosticCode: 'derived_inert'
    text: string
    location: { url: string; lineNumber: number; columnNumber: number }
  }[] = []
  // Observe the real development runtime before the first mount. Production
  // Svelte omits this warning; the lifecycle behavior still runs everywhere.
  page.on('console', (message) => {
    if (message.type() !== 'warning') return
    const text = message.text()
    if (
      /\[svelte\]\s+derived_inert\b/.test(text) ||
      /https:\/\/svelte\.dev\/e\/derived_inert\b/.test(text)
    ) {
      lifetimeWarnings.push({
        diagnosticCode: 'derived_inert',
        text,
        location: message.location(),
      })
    }
  })
  await open(page, info)
  await mount(page)
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = await idle(page)
    const gl = await sourceGL(page, 'A')
    await source(page, 'main', { mounted: false })
    const absent = await waitFor(
      page,
      (state) => state.sources.A.state.status === 'absent',
      'Source detach is absent, not caller-terminal disposed'
    )
    await blank(page, mainViews)
    await expectLost(page, gl.id)
    unchanged(before, absent, 'B', ['independent'])
    expect(absent.sources.A.state.generation).toBeGreaterThan(
      before.sources.A.state.generation
    )
    await source(page, 'main', { mounted: true })
    await ready(page)
    const renewed = await idle(page)
    expect(renewed.sources.A.state.generation).toBeGreaterThan(
      absent.sources.A.state.generation
    )
    expect((await sourceGL(page, 'A')).id).not.toBe(gl.id)
    expect((await sourceGL(page, 'A')).gradient!.time).toBeCloseTo(2, 6)
    for (const id of mainViews) {
      await pixels(page, id)
      cover(renewed, id, 'A')
    }
    expect(renewed.instrumentation.viewWrappers).toBe(4)
    expect(renewed.instrumentation.frameSubscriptions).toBe(3)
    expect(renewed.contexts.observed).toBeGreaterThan(before.contexts.observed)
    expect(renewed.contexts.entries.length).toBeLessThanOrEqual(3)
  }
  const beforeRebind = await idle(page)
  const reboundGL = await sourceGL(page, 'A')
  await source(page, 'main', { source: 'C' })
  await waitFor(
    page,
    (state) =>
      state.sources.A.state.status === 'absent' &&
      state.sources.C.state.status === 'loading',
    'producer handle rebind tears down the old scene without reading destroyed derived state'
  )
  await blank(page, mainViews)
  await expectLost(page, reboundGL.id)
  await source(page, 'main', { source: 'A' })
  await ready(page)
  const afterRebind = await idle(page)
  unchanged(beforeRebind, afterRebind, 'B', ['independent'])
  for (const id of mainViews) await pixels(page, id)
  const last = await sourceGL(page, 'A')
  for (const id of mainViews) await view(page, id, { mounted: false })
  await waitFor(
    page,
    (state) =>
      state.sources.A.demand.visibleViews === 0 &&
      state.sources.A.demand.pendingFrames === 0 &&
      state.sources.A.state.status === 'loading' &&
      state.instrumentation.viewWrappers === 1,
    'last subscriber unmount releases GPU but preserves producer reservation'
  )
  await expectLost(page, last.id)
  for (const id of mainViews)
    await expect(page.getByTestId(`mirror-view-${id}`)).toHaveCount(0)
  await view(page, 'square', { mounted: true })
  await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
  await ready(page, 'A', ['square'])
  await pixels(page, 'square')
  const active = await sourceGL(page, 'A')
  const beforeDispose = await idle(page)
  await page.evaluate(() =>
    (window as unknown as MirrorWindow).gradientFixture.mirrors.disposeHandle(
      'A'
    )
  )
  await waitFor(
    page,
    (state) =>
      state.sources.A.state.status === 'disposed' &&
      state.sources.A.demand.visibleViews === 0 &&
      state.sources.A.demand.pendingFrames === 0,
    'only the explicit caller handle operation is terminal'
  )
  await blank(page, ['square'])
  await expectLost(page, active.id)
  const failure = await page.evaluate(async () => {
    try {
      await (
        window as unknown as MirrorWindow
      ).gradientFixture.mirrors.requestFrame('A')
      return null
    } catch (cause) {
      const error = cause as Failure
      return { code: error.code, message: error.message }
    }
  })
  expect(failure?.code).toBe('source-disposed')
  expect(failure!.message.trim().length).toBeGreaterThan(0)
  const disposed = await idle(page)
  unchanged(beforeDispose, disposed, 'B', ['independent'])
  expect(disposed.instrumentation.pendingRequests).toBe(0)
  await source(page, 'main', { mounted: false })
  await source(page, 'independent', { mounted: false })
  for (const id of allViews) await view(page, id, { mounted: false })
  const removed = await idle(page)
  expect(removed.instrumentation.viewWrappers).toBe(0)
  // These three public-frame subscriptions are fixture-owned until caller page
  // teardown, not a claim about SDK-private subscription inventories.
  expect(removed.instrumentation.frameSubscriptions).toBe(3)
  expect(removed.sources.A.state.status).toBe('disposed')
  expect(removed.sources.B.state.status).toBe('absent')
  for (const id of sourceIds)
    await page.evaluate(
      (id) =>
        (
          window as unknown as MirrorWindow
        ).gradientFixture.mirrors.disposeHandle(id),
      id
    )
  const terminal = await snapshot(page)
  for (const id of sourceIds) {
    expect(terminal.sources[id].state.status).toBe('disposed')
    expect(terminal.sources[id].demand).toEqual({
      visibleViews: 0,
      pendingFrames: 0,
    })
  }
  expect(terminal.instrumentation.pendingRequests).toBe(0)
  await expect(page.getByTestId('mirror-demo').locator('canvas')).toHaveCount(0)
  expect(
    (await probe(page))
      .filter((record) => record.scope?.startsWith('mirror-source-'))
      .every((record) => record.lost)
  ).toBe(true)
  await attachEvidence(info, 'source-derived-lifetime-warnings', {
    contentType: 'application/json',
    body: JSON.stringify(lifetimeWarnings),
  })
  expect(
    lifetimeWarnings,
    'Source unmount, handle rebind and remount must not emit Svelte derived_inert'
  ).toEqual([])
})

test('production Kit concurrent requests and separately hydrated mirror handles do not share readiness, frames or mutations', async ({
  browser,
  request,
  baseURL,
}, info) => {
  const metadata = project(info)
  test.skip(
    metadata.nativeLifecycle!.kind !== 'kit' ||
      metadata.nativeLifecycle!.mode !== 'production',
    'HTTP request isolation requires the production Kit consumer; plain behavior is covered above'
  )
  const base = metadata.fixturePath ?? '/'
  const alpha = `${base}${base.includes('?') ? '&' : '?'}request=mirror-alpha&color1=%231122ee`
  const beta = `${base}${base.includes('?') ? '&' : '?'}request=mirror-beta&color1=%23ee2211`
  const responses = await Promise.all([
    request.get(alpha),
    request.get(beta),
    request.get(alpha),
  ])
  const html = await Promise.all(responses.map((response) => response.text()))
  for (const response of responses) expect(response.status()).toBe(200)
  expect(html[0]).toBe(html[2])
  expect(html[0]).toContain('data-request="mirror-alpha"')
  expect(html[1]).toContain('data-request="mirror-beta"')
  expect(html[0]).toContain('data-color1="#1122ee"')
  expect(html[1]).toContain('data-color1="#ee2211"')
  for (const document of html) {
    expect(document).toContain('data-testid="mirror-view-square"')
    expect(document).not.toMatch(/<canvas(?:\s|>)/i)
  }
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL }),
  ])
  try {
    const pages = await Promise.all(
      contexts.map((context) => context.newPage())
    )
    await Promise.all(
      pages.map((page, index) => open(page, info, index ? beta : alpha))
    )
    const secondInitial = await idle(pages[1])
    await mount(pages[0])
    unchanged(secondInitial, await snapshot(pages[1]), 'A', mainViews)
    expect((await snapshot(pages[1])).sources.A.state.status).toBe('absent')
    await source(pages[0], 'main', {
      gradient: { color1: '#12ee30', uTime: 11 },
    })
    await frame(pages[0], 'A')
    await mount(pages[1])
    await source(pages[1], 'main', {
      gradient: { color1: '#ee1230', uTime: 23 },
    })
    await frame(pages[1], 'A')
    const before = await idle(pages[1])
    expect((await sourceGL(pages[0], 'A')).gradient!.time).toBeCloseTo(11, 6)
    expect((await sourceGL(pages[1], 'A')).gradient!.time).toBeCloseTo(23, 6)
    expect((await snapshot(pages[0])).views.square.pixels!.hash).not.toBe(
      before.views.square.pixels!.hash
    )
    await source(pages[0], 'main', { mounted: false })
    await blank(pages[0], mainViews)
    unchanged(before, await snapshot(pages[1]), 'A', mainViews)
    for (const id of mainViews) await pixels(pages[1], id)
    for (const [index, page] of pages.entries()) {
      const errors = browserErrors.get(page) ?? []
      await attachEvidence(info, `kit-mirror-request-${index}`, {
        contentType: 'application/json',
        body: JSON.stringify({
          snapshot: await snapshot(page),
          contexts: await probe(page),
          browserErrors: errors,
        }),
      })
      expect(
        errors,
        'separately hydrated request has no uncaught failures'
      ).toEqual([])
      expect((await snapshot(page)).errors).toEqual([])
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('production Kit SPA caller teardown clears owned registrations and terminal handles; return has no old frames or contexts', async ({
  page,
}, info) => {
  const metadata = project(info)
  test.skip(
    metadata.nativeLifecycle!.kind !== 'kit' ||
      metadata.nativeLifecycle!.mode !== 'production',
    'Real caller component teardown requires production Kit SPA navigation'
  )
  await open(page, info)
  for (let cycle = 0; cycle < 3; cycle++) {
    await mount(page)
    await page.evaluate(() => {
      const host = window as unknown as MirrorWindow
      host.__mirrorOld = host.gradientFixture.mirrors
      host.__mirrorDocument = 'same-mirror-spa-document'
    })
    const before = await idle(page)
    const sourceContexts = (await probe(page))
      .filter(
        (record) => record.scope?.startsWith('mirror-source-') && !record.lost
      )
      .map((record) => record.id)
    await page.evaluate(() => {
      const host = window as unknown as MirrorWindow
      const pending = (host.__mirrorPending = {
        settled: false,
        result: null,
        error: null,
      } as NonNullable<MirrorWindow['__mirrorPending']>)
      void host.gradientFixture.mirrors.requestFrame('C').then(
        (result) => {
          pending.result = result
          pending.settled = true
        },
        (cause: Failure) => {
          pending.error = { code: cause.code, message: cause.message }
          pending.settled = true
        }
      )
    })
    await waitFor(
      page,
      (state) =>
        state.sources.C.demand.pendingFrames === 1 &&
        state.instrumentation.pendingRequests === 1,
      'caller teardown has a real unfulfilled frame request to cancel'
    )
    await page.getByTestId('away-link').click()
    await expect(page).toHaveURL(/\/away(?:\?|$)/)
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => (window as unknown as MirrorWindow).gradientFixture === undefined
      )
    ).toBe(true)
    const canceled = await page.evaluate(
      () => (window as unknown as MirrorWindow).__mirrorPending
    )
    expect(canceled!.settled).toBe(true)
    expect(canceled!.error?.code).toBe('mirror-fixture-disposed')
    const old = await page.evaluate(() =>
      (window as unknown as MirrorWindow).__mirrorOld!.snapshot()
    )
    for (const id of sourceIds) {
      expect(old.sources[id].state.status).toBe('disposed')
      expect(old.sources[id].demand).toEqual({
        visibleViews: 0,
        pendingFrames: 0,
      })
    }
    expect(old.instrumentation).toEqual({
      frameSubscriptions: 0,
      viewWrappers: 0,
      pendingRequests: 0,
      oracleEnabled: true,
    })
    expect(old.contexts.entries).toEqual([])
    expect(old.contexts.observed).toBe(before.contexts.observed)
    for (const identity of sourceContexts) await expectLost(page, identity)
    await page.getByRole('link', { name: /back.*gradient/i }).click()
    await page.waitForFunction(
      () =>
        (window as unknown as MirrorWindow).gradientFixture?.mirrors
          ?.version === 1
    )
    expect(
      await page.evaluate(
        () => (window as unknown as MirrorWindow).__mirrorDocument
      )
    ).toBe('same-mirror-spa-document')
    const fresh = await snapshot(page)
    for (const id of ['A', 'C'] as const) {
      expect(fresh.sources[id].state).toEqual({
        status: 'absent',
        generation: 0,
      })
      expect(fresh.sources[id].frames).toBe(0)
      expect(fresh.sources[id].lastFrame).toBeNull()
    }
    expect(
      await page.evaluate(
        () =>
          (window as unknown as MirrorWindow).__mirrorOld ===
          (window as unknown as MirrorWindow).gradientFixture.mirrors
      )
    ).toBe(false)
    await page.getByTestId('mirror-view-square').scrollIntoViewIfNeeded()
    await ready(page, 'B', ['independent'])
    await page.evaluate(async () => {
      const fixture = (window as unknown as MirrorWindow).gradientFixture
      await fixture.lifecycle.setMounted(false)
      await fixture.externalHost.configure({ enabled: false, gradients: [] })
      await fixture.mirrors.setOracle(true)
    })
    expect(sourceContexts).not.toContain((await sourceGL(page, 'B')).id)
    const retired = await page.evaluate(() =>
      (window as unknown as MirrorWindow).__mirrorOld!.snapshot()
    )
    expect(retired.sources.A.state.status).toBe('disposed')
  }
})
