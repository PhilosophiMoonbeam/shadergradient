import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

type StudioDraw = {
  serial: number
  time: number
  roughness: number
  colors: number[]
  view: number[]
}

declare global {
  interface Window {
    reactStudioDraws: WeakMap<HTMLCanvasElement, StudioDraw[]>
  }
}

// Observe the GPU program after the SDK's actual mesh draw. Neither React state
// nor the material's userData alone proves that a held phase reached the GPU.
async function installDrawObserver(page: Page) {
  await page.addInitScript(() => {
    const records = new WeakMap<HTMLCanvasElement, StudioDraw[]>()
    window.reactStudioDraws = records
    let serial = 0
    const prototype = WebGL2RenderingContext.prototype
    for (const name of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ] as const) {
      const original = prototype[name]
      Object.defineProperty(prototype, name, {
        configurable: true,
        value: function (this: WebGL2RenderingContext, ...args: number[]) {
          Reflect.apply(original, this, args)
          if (
            !(this.canvas instanceof HTMLCanvasElement) ||
            this.isContextLost()
          )
            return
          const program = this.getParameter(
            this.CURRENT_PROGRAM
          ) as WebGLProgram | null
          if (!program || !this.getProgramParameter(program, this.LINK_STATUS))
            return
          const scalar = (key: string): number | undefined => {
            const location = this.getUniformLocation(program, key)
            if (location === null) return
            const value: unknown = this.getUniform(program, location)
            if (typeof value === 'number' && Number.isFinite(value))
              return value
          }
          const time = scalar('uTime')
          const roughness = scalar('roughness')
          const colors = [1, 2, 3].flatMap((index) =>
            ['r', 'g', 'b'].map((channel) => scalar(`uC${index}${channel}`))
          )
          // Exclude background, grain and postprocessing programs, not draws.
          if (
            time === undefined ||
            roughness === undefined ||
            !colors.every((value): value is number => value !== undefined)
          )
            return
          const viewLocation = this.getUniformLocation(
            program,
            'modelViewMatrix'
          )
          if (viewLocation === null) return
          const view = Array.from(
            this.getUniform(program, viewLocation) as Float32Array
          )
          const draws = records.get(this.canvas) ?? []
          draws.push({ serial: ++serial, time, roughness, colors, view })
          if (draws.length > 128) draws.shift()
          records.set(this.canvas, draws)
        },
      })
    }
  })
}

async function drawsAfter(page: Page, serial = 0): Promise<StudioDraw[]> {
  return page
    .locator('canvas')
    .evaluate(
      (canvas, after) =>
        (window.reactStudioDraws.get(canvas as HTMLCanvasElement) ?? []).filter(
          (draw) => draw.serial > after
        ),
      serial
    )
}

async function latestDraw(page: Page): Promise<StudioDraw> {
  const draws = await drawsAfter(page)
  expect(
    draws.length,
    'the real scalar-gradient mesh must have drawn'
  ).toBeGreaterThan(0)
  return draws[draws.length - 1]
}

// Drain interaction/React/Fiber invalidations without running a replacement
// render loop or changing the SDK clock. Demand rendering may then go idle.
async function settleInteraction(page: Page) {
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>()
    let remaining = 4
    const frame = () => {
      if (--remaining === 0) resolve()
      else requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    return promise
  })
}

function changedPixelFraction(before: Buffer, after: Buffer) {
  const left = PNG.sync.read(before)
  const right = PNG.sync.read(after)
  expect([right.width, right.height]).toEqual([left.width, left.height])
  let changed = 0
  for (let offset = 0; offset < left.data.length; offset += 4) {
    if (
      [0, 1, 2].some(
        (channel) =>
          Math.abs(left.data[offset + channel] - right.data[offset + channel]) >
          8
      )
    )
      changed++
  }
  return changed / (left.width * left.height)
}

function expectHeldPhase(draws: StudioDraw[], phase: number) {
  expect(
    draws.length,
    'the edit must produce an actual mesh draw'
  ).toBeGreaterThan(0)
  for (const draw of draws)
    expect(draw.time, `GPU phase at draw ${draw.serial}`).toBeCloseTo(phase, 5)
}

test.use({ reducedMotion: 'reduce', colorScheme: 'light' })
test.describe.configure({ mode: 'serial' })

test('paused scalar phase survives real palette and reflection draws', async ({
  page,
}, testInfo) => {
  await installDrawObserver(page)
  await page.goto('/')
  const resume = page.getByRole('button', {
    name: 'Resume motion',
    exact: true,
  })
  await expect(resume).toBeEnabled()
  await expect(resume).toHaveAttribute('aria-pressed', 'true')
  // Explicit preset selection is allowed to seek. Disable stochastic grain so
  // the palette image comparison measures the real color control, not noise.
  await page.locator('#preset').selectOption('halo')
  await expect(resume).toBeEnabled()
  await page.getByLabel('Film grain', { exact: true }).uncheck()
  await expect(resume).toBeEnabled()
  await expect
    .poll(async () => (await drawsAfter(page)).length)
    .toBeGreaterThan(0)
  await settleInteraction(page)
  const reduced = await latestDraw(page)
  await settleInteraction(page)
  expect((await latestDraw(page)).time).toBeCloseTo(reduced.time, 5)

  // Resume deliberately starts the SDK's new cycle. Wait for a nonzero GPU
  // phase, rather than a UI timer, so resetting to the old settings time fails.
  await resume.click()
  const pause = page.getByRole('button', { name: 'Pause motion', exact: true })
  await expect(pause).toBeEnabled()
  await expect
    .poll(async () => (await latestDraw(page)).time)
    .toBeGreaterThan(0.5)
  const running = await latestDraw(page)
  await pause.click()
  await expect(resume).toBeEnabled()
  await settleInteraction(page)
  const held = await latestDraw(page)
  expect(held.serial).toBeGreaterThan(running.serial)
  expect(
    held.time,
    'pause must capture the current rendered phase, not seek to zero'
  ).toBeGreaterThanOrEqual(running.time - 0.00001)
  await settleInteraction(page)
  expect((await latestDraw(page)).time).toBeCloseTo(held.time, 5)

  const canvas = page.locator('canvas')
  const beforePalette = await canvas.screenshot()
  await page.getByRole('button', { name: 'Lagoon', exact: true }).click()
  await expect
    .poll(async () => (await latestDraw(page)).serial)
    .toBeGreaterThan(held.serial)
  await settleInteraction(page)
  const paletteDraws = await drawsAfter(page, held.serial)
  expectHeldPhase(paletteDraws, held.time)
  const palette = await latestDraw(page)
  expect(
    palette.colors,
    'the palette must change actual GPU color uniforms'
  ).not.toEqual(held.colors)
  const afterPalette = await canvas.screenshot()
  expect(
    changedPixelFraction(beforePalette, afterPalette),
    'palette edit must visibly change a meaningful part of the rendered canvas'
  ).toBeGreaterThan(0.01)

  // Exercise the accessible range control with a real keyboard action. Its
  // effect is checked as GPU roughness, never by echoing the input/output DOM.
  const reflection = page.locator('#reflection')
  await reflection.focus()
  await reflection.press('End')
  await expect
    .poll(async () => (await latestDraw(page)).roughness)
    .toBeCloseTo(0, 5)
  await settleInteraction(page)
  const reflectionDraws = await drawsAfter(page, palette.serial)
  expectHeldPhase(reflectionDraws, held.time)
  expect((await latestDraw(page)).roughness).not.toBeCloseTo(
    palette.roughness,
    3
  )
  await expect(resume).toHaveAttribute('aria-pressed', 'true')

  // Camera commits once reset Fiber to "always" despite paused shader time.
  // Observe real GPU work, not just a stationary uniform or a CSS control.
  await canvas.scrollIntoViewIfNeeded()
  const beforeOrbit = await latestDraw(page)
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('The actual preview has no interaction surface')
  await page.mouse.move(
    bounds.x + bounds.width * 0.4,
    bounds.y + bounds.height * 0.45
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.55
  )
  await page.mouse.up()
  await expect
    .poll(async () => (await latestDraw(page)).view)
    .not.toEqual(beforeOrbit.view)
  let previousSerial = -1
  await expect
    .poll(
      async () => {
        await settleInteraction(page)
        const serial = (await latestDraw(page)).serial
        const idle = serial === previousSerial
        previousSerial = serial
        return idle
      },
      {
        message:
          'Paused camera damping must finish and return GPU rendering to idle',
      }
    )
    .toBe(true)
  const idle = await latestDraw(page)
  for (let sample = 0; sample < 12; sample++) await settleInteraction(page)
  expect(
    (await latestDraw(page)).serial,
    'Paused idle must not keep drawing GPU frames'
  ).toBe(idle.serial)
  expectHeldPhase(await drawsAfter(page, beforeOrbit.serial), held.time)

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    const overflow = await page.evaluate(
      () =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth
        ) - document.documentElement.clientWidth
    )
    expect(
      overflow,
      `${colorScheme} studio must fit the project viewport`
    ).toBeLessThanOrEqual(1)
  }
  await testInfo.attach('paused-phase-gpu', {
    body: JSON.stringify(
      { running, held, paletteDraws, reflectionDraws },
      null,
      2
    ),
    contentType: 'application/json',
  })
  await testInfo.attach('palette-before', {
    body: beforePalette,
    contentType: 'image/png',
  })
  await testInfo.attach('palette-after', {
    body: afterPalette,
    contentType: 'image/png',
  })
})
