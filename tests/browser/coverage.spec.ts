import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'

declare global {
  interface Window {
    studioGradientDraw?: { count: number; view: number[]; time: number }
  }
}

async function installStudioDrawObserver(page: Page) {
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype
    const capture = (gl: WebGL2RenderingContext) => {
      const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram
      const view = program && gl.getUniformLocation(program, 'modelViewMatrix')
      const time = program && gl.getUniformLocation(program, 'uTime')
      if (view && time)
        window.studioGradientDraw = {
          count: (window.studioGradientDraw?.count ?? 0) + 1,
          view: Array.from(gl.getUniform(program, view) as Float32Array),
          time: gl.getUniform(program, time) as number,
        }
    }
    const elements = prototype.drawElements
    prototype.drawElements = function (...args) {
      capture(this)
      return elements.apply(this, args)
    }
    const arrays = prototype.drawArrays
    prototype.drawArrays = function (...args) {
      capture(this)
      return arrays.apply(this, args)
    }
  })
}

async function update(page: Page, props: Record<string, unknown>, count = 1) {
  await page.evaluate(
    async ({ props, count }) => {
      await (
        window as unknown as {
          gradientFixture: {
            update: (props: object, count: number) => Promise<void>
          }
        }
      ).gradientFixture.update(props, count)
    },
    { props, count }
  )
}

test('presets can be switched', async ({ page }, info) => {
  test.skip(!['vue-dev', 'nuxt-dev'].includes(info.project.name))
  await page.goto('/')
  await page.getByRole('checkbox', { name: 'Pause animation' }).check()
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const before = await canvas.screenshot()
  await page
    .getByRole('combobox', { name: /^(?:Core |Starting )?preset$/i })
    .selectOption('mint')
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before))
    .toBe(false)
})

test('Nuxt navigation unmounts and recreates the canvas', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'nuxt-dev')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await page.locator('a[href="/away"]').first().click()
  await expect(page).toHaveURL(/\/away$/)
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to gradient' }).click()
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('Vue camera reset restores the Core preset state and actual camera', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'vue-dev')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStudioDrawObserver(page)
  await page.goto('/')
  const canvas = page.locator('canvas')
  await page
    .getByRole('status')
    .filter({ hasText: /^Rendered/ })
    .waitFor()
  const sample = () => page.evaluate(() => window.studioGradientDraw)
  const idle = async () => {
    let previousCount = -1
    await expect
      .poll(
        async () => {
          const count = (await sample())!.count
          const stopped = count === previousCount
          previousCount = count
          return stopped
        },
        { intervals: [250, 250, 250] }
      )
      .toBe(true)
  }
  await expect.poll(async () => (await sample())?.view.length).toBe(16)
  await idle()
  const canonical = (await sample())!.view
  const heading = page.locator('h2#preview-title')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box.x + box.width / 2 + 85,
    box.y + box.height / 2 + 30,
    { steps: 12 }
  )
  await page.mouse.up()
  await expect
    .poll(async () =>
      Math.max(
        ...(await sample())!.view.map((value, index) =>
          Math.abs(value - canonical[index])
        )
      )
    )
    .toBeGreaterThan(0.01)
  // This is a semantic state assertion, not a pin of incidental page copy:
  // a genuine camera edit must differ, and restoring the preset must not.
  await expect(heading).not.toContainText('Core preset')
  await page.getByRole('button', { name: /^Reset to Halo$/ }).click()
  await expect
    .poll(async () =>
      Math.max(
        ...(await sample())!.view.map((value, index) =>
          Math.abs(value - canonical[index])
        )
      )
    )
    .toBeLessThan(0.000001)
  await idle()
  await expect(heading).toContainText('Core preset')
  // Spherical.makeSafe clamps this preset's declared 180-degree pole.
  // That supported camera representation is not a user customization.
  const beforePole = (await sample())!.count
  await page
    .getByRole('combobox', { name: /^Core preset$/i })
    .selectOption('interstella')
  await expect
    .poll(async () => (await sample())!.count)
    .toBeGreaterThan(beforePole)
  await idle()
  await expect(heading).toContainText('Core preset')
  await page.getByRole('button', { name: /^Reset to Interstella$/ }).click()
  await idle()
  await expect(heading).toContainText('Core preset')
})

test('Nuxt lazy recreation preserves inactive camera fields and complete preset seeks', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'nuxt-dev')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStudioDrawObserver(page)
  await page.goto('/')
  const preset = page.getByRole('combobox', { name: /^starting preset$/i })
  const shape = page.locator('#journal-shape')
  const canvas = page.locator('canvas')
  const rendered = page.getByRole('status').filter({ hasText: /^Rendered/ })
  // SSR controls are actionable before hydration has attached their handlers.
  // Start transactions only after a real client frame, then read the final
  // paused draw rather than the first intermediate draw of a prop transition.
  await rendered.waitFor()
  await expect
    .poll(async () =>
      page.evaluate(() => window.studioGradientDraw?.count ?? 0)
    )
    .toBeGreaterThan(0)
  const draw = async (action: () => Promise<unknown>) => {
    const before = await page.evaluate(
      () => window.studioGradientDraw?.count ?? 0
    )
    await action()
    await rendered.waitFor()
    // Observe the real gradient draw after this transaction, not whichever
    // postprocessing program happens to remain bound after several RAFs.
    await expect
      .poll(async () =>
        page.evaluate(() => window.studioGradientDraw?.count ?? 0)
      )
      .toBeGreaterThan(before)
    let previousCount = -1
    await expect
      .poll(
        async () => {
          const count = await page.evaluate(
            () => window.studioGradientDraw!.count
          )
          const idle = count === previousCount
          previousCount = count
          return idle
        },
        { intervals: [250, 250, 250] }
      )
      .toBe(true)
    return await page.evaluate(() => window.studioGradientDraw!)
  }
  const canonical = await draw(() => preset.selectOption('nightyNight'))
  await draw(() => preset.selectOption('pensive'))
  const directPlane = await draw(() => shape.selectOption('plane'))
  await draw(() => preset.selectOption('pensive'))
  const selected = page.getByRole('button', { name: /Pensive/ })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await canvas.evaluate((element) => {
    const wrapper = element.closest(
      'div[aria-hidden="true"]'
    ) as HTMLElement | null
    if (!wrapper)
      throw new Error('The SDK preview visibility wrapper is missing')
    wrapper.setAttribute('data-lazy-camera-check', '')
    wrapper.style.marginTop = '200vh'
  })
  await expect(canvas).toHaveCount(0)
  await page.locator('[data-lazy-camera-check]').evaluate((element) => {
    ;(element as HTMLElement).style.marginTop = ''
  })
  await rendered.waitFor()
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  const afterLazyPlane = await draw(() => shape.selectOption('plane'))
  for (let index = 0; index < directPlane.view.length; index++)
    expect(afterLazyPlane.view[index]).toBeCloseTo(directPlane.view[index], 6)
  expect((await draw(() => preset.selectOption('nightyNight'))).time).toBe(
    canonical.time
  )
})

test('HDR loading, failure fallback and texture disposal', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'vue-library')
  const requests: string[] = []
  const hdr = Buffer.concat([
    Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n'),
    Buffer.from([
      128, 64, 32, 129, 32, 128, 64, 129, 64, 32, 128, 129, 128, 128, 128, 129,
    ]),
  ])
  await page.route('**/hdr/*.hdr', async (route) => {
    requests.push(new URL(route.request().url()).pathname)
    await route.fulfill(
      route.request().url().endsWith('dawn.hdr')
        ? { status: 404, body: 'Not found' }
        : { status: 200, contentType: 'application/octet-stream', body: hdr }
    )
  })
  await page.goto('/coverage.html')
  await expect(page.locator('canvas')).toBeVisible()
  await update(page, { lightType: 'env', envPreset: 'city' })
  await expect.poll(() => requests).toEqual(['/hdr/city.hdr'])
  await page.locator('canvas').screenshot()
  await update(page, { envPreset: 'dawn' })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              gradientFixture: { events: { errors: number } }
            }
          ).gradientFixture.events.errors
      )
    )
    .toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              gradientFixture: { events: { texture: number } }
            }
          ).gradientFixture.events.texture
      )
    )
    .toBeGreaterThan(0)
  await expect(page.locator('canvas')).toBeVisible()
  expect(requests).toEqual(['/hdr/city.hdr', '/hdr/dawn.hdr'])
})

test('shader geometry matrix, query, camera, multiple canvases and disposal', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'vue-library')
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/coverage.html')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  for (const shader of ['defaults', 'positionMix', 'cosmic', 'glass']) {
    for (const type of ['plane', 'waterPlane', 'sphere']) {
      await update(page, { shader, type, cameraZoom: 8 })
      await expect
        .poll(
          async () => {
            const image = PNG.sync.read(await canvas.screenshot())
            const colors = new Set<string>()
            for (let offset = 0; offset < image.data.length; offset += 400)
              colors.add(
                image.data.subarray(offset, offset + 3).toString('hex')
              )
            return colors.size
          },
          { message: `${shader}/${type} renders pixels` }
        )
        .toBeGreaterThan(20)
      expect(errors, `${shader}/${type}`).toEqual([])
    }
  }
  await update(page, {
    shader: 'defaults',
    type: 'plane',
    enableTransition: false,
    control: 'props',
    color1: '#123456',
    uTime: 2,
  })
  const direct = await canvas.screenshot()
  await update(page, {
    control: 'query',
    urlString:
      '?shader=defaults&type=plane&color1=%23123456&uTime=2&enableTransition=false',
  })
  expect((await canvas.screenshot()).equals(direct)).toBe(true)
  await page.reload()
  await expect(canvas).toBeVisible()
  const cameraBefore = await canvas.screenshot()
  const eventCount = await page.evaluate(
    () =>
      (window as unknown as { gradientFixture: { events: { camera: number } } })
        .gradientFixture.events.camera
  )
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Missing canvas bounds')
  await page.mouse.move(box.x + 200, box.y + 150)
  await page.mouse.down()
  await page.mouse.move(box.x + 280, box.y + 180, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              gradientFixture: { events: { camera: number } }
            }
          ).gradientFixture.events.camera
      )
    )
    .toBeGreaterThan(eventCount)
  await expect
    .poll(async () => (await canvas.screenshot()).equals(cameraBefore))
    .toBe(false)
  await update(page, { control: 'props' }, 2)
  await expect(page.locator('canvas')).toHaveCount(2)
  const before = await page.evaluate(() => ({
    ...(
      window as unknown as {
        gradientFixture: { events: Record<string, number> }
      }
    ).gradientFixture.events,
  }))
  await update(page, {}, 0)
  await expect(page.locator('canvas')).toHaveCount(0)
  const after = await page.evaluate(
    () =>
      (
        window as unknown as {
          gradientFixture: { events: Record<string, number> }
        }
      ).gradientFixture.events
  )
  expect(after.geometry).toBeGreaterThan(before.geometry)
  expect(after.material).toBeGreaterThan(before.material)
  expect(errors).toEqual([])
})
