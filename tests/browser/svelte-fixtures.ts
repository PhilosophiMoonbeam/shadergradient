import { expect, test as base } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { PNG } from 'pngjs'
import type { GradientSettingsInput } from '@shadergradient/svelte'
import type {
  FixtureCanvasConfig,
  FixtureObservation,
} from '../../apps/example-svelte-dev/src/fixture-types'
import type { BufferGeometry, Camera, Object3D, Scene } from 'three'
import { attachEvidence } from './evidence'

export type Observation = FixtureObservation
export type Draw = {
  serial: number
  linked: boolean
  uniforms: Record<string, number | number[]>
  pixels: null | {
    width: number
    height: number
    nonclearPixels: number
    clear: number[]
  }
}
export interface NativeProjectMetadata {
  /** F28: set on workspace/packed plain and Kit projects only. No preparation here. */
  nativeSvelte: true
  fixturePath?: string
  f02BaselineIndex?: string
  nativeLifecycle: {
    kind: 'plain' | 'kit'
    mode: 'development' | 'production'
    supportURL: string
    hmrURL: string
  }
}
declare global {
  interface Window {
    nativeFeatureDraws: WeakMap<HTMLCanvasElement, Draw[]>
  }
}

/** Observe real public WebGL draw calls; do not replace rendering, uniforms or shaders. */
export async function installDrawObserver(page: Page) {
  await page.addInitScript(() => {
    const records = new WeakMap<HTMLCanvasElement, Draw[]>()
    window.nativeFeatureDraws = records
    const readbacks = new WeakMap<HTMLCanvasElement, Uint8Array>()
    let serial = 0
    const prototype = WebGL2RenderingContext.prototype
    for (const key of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ] as const) {
      const original = prototype[key]
      Object.defineProperty(prototype, key, {
        configurable: true,
        value: function (this: WebGL2RenderingContext, ...args: number[]) {
          Reflect.apply(original, this, args)
          const canvas = this.canvas
          if (!(canvas instanceof HTMLCanvasElement) || this.isContextLost())
            return
          const program = this.getParameter(
            this.CURRENT_PROGRAM
          ) as WebGLProgram | null
          if (!program) return
          const uniforms: Draw['uniforms'] = {}
          const count = this.getProgramParameter(
            program,
            this.ACTIVE_UNIFORMS
          ) as number
          for (let i = 0; i < count; i++) {
            const info = this.getActiveUniform(program, i)
            if (
              !info ||
              !/^(u(Time|Loop|LoopDuration|NoiseStrength|NoiseDensity|Frequency|Amplitude|C[123][rgb])|viewMatrix|projectionMatrix|modelMatrix|modelViewMatrix)$/.test(
                info.name
              )
            )
              continue
            const location = this.getUniformLocation(program, info.name)
            if (!location) continue
            const value: unknown = this.getUniform(program, location)
            if (typeof value === 'number') uniforms[info.name] = value
            else if (ArrayBuffer.isView(value))
              uniforms[info.name] = Array.from(
                value as unknown as ArrayLike<number>
              )
          }
          let pixels: Draw['pixels'] = null
          // Read while this actual default-framebuffer draw is still available:
          // preserveDrawingBuffer stays false. A reused <=4MiB central readback
          // covers normal fixtures and remains bounded at high consumer DPR.
          if (
            this.getParameter(this.DRAW_FRAMEBUFFER_BINDING) === null &&
            this.getParameter(this.READ_FRAMEBUFFER_BINDING) === null &&
            this.getParameter(this.PIXEL_PACK_BUFFER_BINDING) === null
          ) {
            const width = Math.min(1024, this.drawingBufferWidth)
            const height = Math.min(1024, this.drawingBufferHeight)
            if (width > 0 && height > 0) {
              let bytes = readbacks.get(canvas)
              if (!bytes || bytes.length !== width * height * 4) {
                bytes = new Uint8Array(width * height * 4)
                readbacks.set(canvas, bytes)
              }
              const clearValue = this.getParameter(
                this.COLOR_CLEAR_VALUE
              ) as Float32Array
              const clear = Array.from(clearValue, (value) =>
                Math.round(value * 255)
              )
              this.readPixels(
                Math.floor((this.drawingBufferWidth - width) / 2),
                Math.floor((this.drawingBufferHeight - height) / 2),
                width,
                height,
                this.RGBA,
                this.UNSIGNED_BYTE,
                bytes
              )
              let nonclearPixels = 0
              for (let offset = 0; offset < bytes.length; offset += 4) {
                if (
                  Math.abs(bytes[offset] - clear[0]) > 1 ||
                  Math.abs(bytes[offset + 1] - clear[1]) > 1 ||
                  Math.abs(bytes[offset + 2] - clear[2]) > 1 ||
                  Math.abs(bytes[offset + 3] - clear[3]) > 1
                )
                  nonclearPixels++
              }
              pixels = { width, height, nonclearPixels, clear }
            }
          }
          const draws = records.get(canvas) ?? []
          draws.push({
            serial: ++serial,
            linked: !!this.getProgramParameter(program, this.LINK_STATUS),
            uniforms,
            pixels,
          })
          if (draws.length > 64) draws.shift()
          records.set(canvas, draws)
        },
      })
    }
  })
}

export function pixelDifference(
  a: Buffer,
  b: Buffer,
  foregroundPixels?: number
) {
  const left = PNG.sync.read(a),
    right = PNG.sync.read(b)
  expect([right.width, right.height]).toEqual([left.width, left.height])
  let changed = 0
  for (let i = 0; i < left.data.length; i += 4) {
    if (
      [0, 1, 2].some((c) => Math.abs(left.data[i + c] - right.data[i + c]) > 8)
    )
      changed++
  }
  // Small host-only geometry can use its actual GPU nonclear footprint instead
  // of the entire mostly empty canvas; RGB8 remains the same pixel criterion.
  return changed / (foregroundPixels ?? left.width * left.height)
}

export async function nonblank(canvas: Locator) {
  const draw = await canvas.evaluate((element) =>
    window.nativeFeatureDraws
      .get(element as HTMLCanvasElement)
      ?.findLast((value) => value.linked && value.pixels !== null)
  )
  expect(
    draw,
    'actual linked default-framebuffer draw is observed before browser discards it'
  ).toBeTruthy()
  expect(
    draw!.pixels!.nonclearPixels,
    'real GPU RGBA differs from actual GL clear color/alpha; CSS background is not evidence'
  ).toBeGreaterThan(0)
  const bytes = await canvas.screenshot()
  const png = PNG.sync.read(bytes)
  expect(
    png.width * png.height,
    'real canvas pixel capture has nonzero area'
  ).toBeGreaterThan(0)
  // Uniform/low-contrast shader output is valid. Controlled-change and paused
  // replay assertions separately prove behavior; no entropy/gradient quota.
  return bytes
}

export interface AxisPixelEvidence {
  channel: number
  origin: { x: number; y: number }
  end: { x: number; y: number }
  changedPrimaryPixels: number
}

export interface AxesProjection {
  positions: number[][]
  colors: number[][]
  model: number[]
  view: number[]
  projection: number[]
}

export async function readAxesProjection(page: Page): Promise<AxesProjection> {
  return page.evaluate(() => {
    // This is the consumer's public Three scene, not native package context.
    const boundary = window as unknown as {
      gradientLifecycle: {
        refs(): { native: { scene: Scene; camera(): Camera } }
      }
    }
    const probe = boundary.gradientLifecycle.refs().native
    let axes: (Object3D & { geometry: BufferGeometry }) | undefined
    probe.scene.traverse((object) => {
      if (object.type === 'AxesHelper')
        axes = object as Object3D & { geometry: BufferGeometry }
    })
    if (!axes) throw new Error('Actual scene has no AxesHelper')
    const positions = axes.geometry.getAttribute('position')
    const colors = axes.geometry.getAttribute('color')
    const camera = probe.camera()
    return {
      positions: Array.from({ length: positions.count }, (_, index) => [
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
        1,
      ]),
      colors: Array.from({ length: colors.count }, (_, index) => [
        colors.getX(index),
        colors.getY(index),
        colors.getZ(index),
      ]),
      model: axes.matrixWorld.toArray(),
      view: camera.matrixWorldInverse.toArray(),
      projection: camera.projectionMatrix.toArray(),
    }
  })
}

export function axesPixelEvidence(
  before: Buffer,
  after: Buffer,
  axes: AxesProjection
): AxisPixelEvidence[] {
  const initial = PNG.sync.read(before),
    image = PNG.sync.read(after)
  expect([image.width, image.height]).toEqual([initial.width, initial.height])
  function projectPosition(point: number[]) {
    let value = point
    for (const matrix of [axes.model, axes.view, axes.projection]) {
      const result = [0, 0, 0, 0]
      for (let row = 0; row < 4; row++)
        for (let column = 0; column < 4; column++)
          result[row] += matrix[column * 4 + row] * value[column]
      value = result
    }
    return {
      x: ((value[0] / value[3] + 1) * image.width) / 2,
      y: ((1 - value[1] / value[3]) * image.height) / 2,
    }
  }
  const evidence: AxisPixelEvidence[] = []
  for (let segment = 0; segment + 1 < axes.positions.length; segment += 2) {
    const origin = projectPosition(axes.positions[segment])
    const end = projectPosition(axes.positions[segment + 1])
    const color = axes.colors[segment]
    const channel = color.indexOf(Math.max(...color))
    const dx = end.x - origin.x,
      dy = end.y - origin.y
    const lengthSquared = dx * dx + dy * dy
    if (!Number.isFinite(lengthSquared) || lengthSquared < 16) continue
    let changedPrimaryPixels = 0
    const other1 = (channel + 1) % 3,
      other2 = (channel + 2) % 3
    for (let y = 1; y < image.height - 1; y++)
      for (let x = 1; x < image.width - 1; x++) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - origin.x) * dx + (y - origin.y) * dy) / lengthSquared
          )
        )
        if (Math.hypot(x - origin.x - t * dx, y - origin.y - t * dy) > 2)
          continue
        const offset = (y * image.width + x) * 4
        if (
          image.data[offset + channel] -
            Math.max(image.data[offset + other1], image.data[offset + other2]) >
            24 &&
          Math.max(
            Math.abs(image.data[offset] - initial.data[offset]),
            Math.abs(image.data[offset + 1] - initial.data[offset + 1]),
            Math.abs(image.data[offset + 2] - initial.data[offset + 2])
          ) > 8
        )
          changedPrimaryPixels++
      }
    evidence.push({ channel, origin, end, changedPrimaryPixels })
  }
  return evidence
}

export class NativeFixture {
  readonly canvas: Locator
  readonly diagnostics: string[] = []
  private advancing = false
  private queryControlled = false
  constructor(
    readonly page: Page,
    readonly info: TestInfo
  ) {
    this.canvas = page.locator(
      '[data-gradient-main] canvas, [data-testid="managed-placement"] canvas'
    )
    page.on('pageerror', (error) => this.diagnostics.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') this.diagnostics.push(message.text())
    })
  }
  async open() {
    const metadata = this.info.project
      .metadata as unknown as NativeProjectMetadata
    expect(
      metadata.nativeSvelte,
      'F28 must select only native consumer projects'
    ).toBe(true)
    await installDrawObserver(this.page)
    await this.page.goto(metadata.fixturePath ?? '/')
    await this.page.waitForFunction(() => window.gradientFixture?.version === 1)
    await this.canvas.scrollIntoViewIfNeeded()
    await this.configure({ lazyLoad: false, pixelDensity: 1 })
    await this.update({
      animate: 'off',
      grain: 'off',
      enableTransition: false,
      control: 'props',
      uTime: 2,
    })
  }
  snapshot() {
    return this.page.evaluate(() => window.gradientFixture!.snapshot())
  }
  async wait(predicate: (state: Observation) => boolean, description: string) {
    await expect
      .poll(async () => predicate(await this.snapshot()), {
        message: description,
        timeout: 15000,
      })
      .toBe(true)
    return this.snapshot()
  }
  draws(canvas = this.canvas): Promise<Draw[]> {
    return canvas.evaluate(
      (element) =>
        window.nativeFeatureDraws.get(element as HTMLCanvasElement) ?? []
    )
  }
  async frame(
    canvas = this.canvas,
    after = 0,
    matches: Record<string, number> = {}
  ) {
    await expect
      .poll(
        async () =>
          (await this.draws(canvas)).some(
            (draw) =>
              draw.serial > after &&
              draw.linked &&
              Object.entries(matches).every(
                ([name, value]) =>
                  typeof draw.uniforms[name] === 'number' &&
                  Math.abs((draw.uniforms[name] as number) - value) < 0.0001
              )
          ),
        {
          message: `linked affected GPU draw ${JSON.stringify(matches)}`,
          timeout: 15000,
        }
      )
      .toBe(true)
  }
  async update(
    patch: GradientSettingsInput,
    predicate?: (state: Observation) => boolean
  ) {
    const before = (await this.draws()).at(-1)?.serial ?? 0
    await this.page.evaluate(
      (value) => window.gradientFixture!.update(value),
      patch
    )
    if (predicate)
      await this.wait(predicate, `actual scene after ${JSON.stringify(patch)}`)
    if (patch.animate !== undefined) this.advancing = patch.animate === 'on'
    if (patch.control !== undefined)
      this.queryControlled = patch.control === 'query'
    const uniforms: Record<string, number> = {}
    const mesh = (await this.snapshot()).scene!.meshes[0]
    if (!this.advancing) {
      // Observe resolved time: range/loop/query legitimately remap the input seek.
      uniforms.uTime = mesh.time
    }
    if (!this.queryControlled)
      for (const name of [
        'uStrength',
        'uDensity',
        'uFrequency',
        'uAmplitude',
      ] as const) {
        // Public Core vertex semantics: all variants consume strength; glass
        // consumes no density, and only defaults/positionMix sphere consume
        // the frequency/amplitude spiral. Absent knobs are not GL uniforms.
        if (name === 'uDensity' && mesh.shader === 'glass') continue
        if (
          (name === 'uFrequency' || name === 'uAmplitude') &&
          !(
            mesh.type === 'sphere' &&
            (mesh.shader === 'defaults' || mesh.shader === 'positionMix')
          )
        )
          continue
        const uniformName =
          name === 'uStrength'
            ? 'uNoiseStrength'
            : name === 'uDensity'
              ? 'uNoiseDensity'
              : name
        if (typeof patch[name] === 'number')
          uniforms[uniformName] = patch[name]!
      }
    await this.frame(this.canvas, before, uniforms)
    return this.snapshot()
  }
  async configure(patch: FixtureCanvasConfig) {
    await this.page.evaluate(
      (value) => window.gradientFixture!.configureCanvas(value),
      patch
    )
    await this.frame()
    return this.snapshot()
  }
  async resize(width: number, height: number) {
    await this.canvas.evaluate(
      (element, size) => {
        const wrapper = element.closest(
          '[data-testid="gradient-wrapper"], [data-testid="managed-placement"]'
        ) as HTMLElement
        wrapper.style.width = `${size.width}px`
        wrapper.style.height = `${size.height}px`
        for (
          let current = element.parentElement;
          current && current !== wrapper;
          current = current.parentElement
        ) {
          current.style.width = '100%'
          current.style.height = '100%'
        }
      },
      { width, height }
    )
    await this.page.evaluate(() =>
      window.gradientFixture!.lifecycle.requestFrame()
    )
    await this.wait(
      (state) =>
        Math.abs(state.canvas!.cssWidth - width) < 0.01 &&
        Math.abs(state.canvas!.cssHeight - height) < 0.01,
      'actual consumer CSS canvas resize'
    )
  }
  async capture(name: string, canvas = this.canvas) {
    await this.frame(canvas)
    const bytes = await nonblank(canvas)
    await attachEvidence(this.info, `${name}.png`, {
      body: bytes,
      contentType: 'image/png',
    })
    await attachEvidence(this.info, `${name}.json`, {
      body: JSON.stringify(
        { state: await this.snapshot(), draws: await this.draws(canvas) },
        null,
        2
      ),
      contentType: 'application/json',
    })
    return bytes
  }
  async changed(before: Buffer, name: string, canvas = this.canvas) {
    await expect
      .poll(async () => pixelDifference(before, await canvas.screenshot()), {
        message: `${name}: controlled pixels exceed same-engine 0.5% / RGB8 tolerance`,
        timeout: 15000,
      })
      .toBeGreaterThan(0.005)
    return this.capture(name, canvas)
  }
  async equivalent(before: Buffer, name: string) {
    const after = await this.capture(name)
    // F02 policy: RGB delta <=8 ignored, <=0.5% changed pixels. Never cross-engine equality.
    expect(pixelDifference(before, after), name).toBeLessThanOrEqual(0.005)
  }
}

export const test = base.extend<{ native: NativeFixture }>({
  native: async ({ page }, use, info) => {
    const fixture = new NativeFixture(page, info)
    await fixture.open()
    await use(fixture)
    expect(
      fixture.diagnostics,
      'unexpected page/shader/console errors'
    ).toEqual([])
    expect(
      (await fixture.snapshot()).errors,
      'unexpected typed native errors'
    ).toEqual([])
  },
})
export { expect }
