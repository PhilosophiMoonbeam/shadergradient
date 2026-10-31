import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import type { PresetName } from '@shadergradient/core'
import type * as Core from '@shadergradient/core'
import type { GradientSettingsInput } from '@shadergradient/svelte'
import type { Camera, Mesh, Scene, WebGLRenderer } from 'three'
import {
  test,
  expect,
  nonblank,
  pixelDifference,
  installDrawObserver,
  axesPixelEvidence,
  readAxesProjection,
} from './svelte-fixtures'
import type {
  AxisPixelEvidence,
  NativeProjectMetadata,
} from './svelte-fixtures'
import { attachEvidence } from './evidence'

test.setTimeout(90_000)

// F28 integration: testMatch this file only on nativeSvelte:true workspace/packed
// plain + Kit projects, Chromium/Firefox/WebKit desktop and touch. No suite-level
// engine skips; only Chromium offers CDP trusted touch movement (separate case).
// Real F02 recipe: tests/svelte/baseline/scenarios.mjs. Frozen successful images
// are compared only with their own engine/backend, never across framework GL revisions.
const shaders = ['defaults', 'positionMix', 'cosmic', 'glass'] as const
const geometries = ['plane', 'sphere', 'waterPlane'] as const
let presets: typeof Core.presets
let defaultEnvBasePath: typeof Core.defaultEnvBasePath
let environmentManifest: typeof Core.environmentManifest
let frozen: GradientSettingsInput

test.beforeAll(async () => {
  // Core is intentionally ESM/import-only; Playwright collects this root TS file
  // through its CJS loader, so load public runtime data at the async boundary.
  const core = await import('@shadergradient/core')
  presets = core.presets
  defaultEnvBasePath = core.defaultEnvBasePath
  environmentManifest = core.environmentManifest
  frozen = {
    ...presets.halo.props,
    control: 'props',
    animate: 'off',
    grain: 'off',
    enableTransition: false,
    zoomOut: false,
    loop: 'off',
    range: 'disabled',
    uTime: 2,
    cameraZoom: 8,
  }
})

const presetNames: PresetName[] = [
  'halo',
  'pensive',
  'mint',
  'interstella',
  'nightyNight',
  'violaOrientalis',
  'universe',
  'sunset',
  'mandarin',
  'cottonCandy',
]

for (const shader of shaders)
  for (const type of geometries) {
    test(`native variant ${shader}/${type}: linked GPU and controlled color response`, async ({
      native,
    }) => {
      await native.update(
        { ...frozen, shader, type },
        (s) =>
          s.scene?.meshes[0]?.shader === shader &&
          s.scene.meshes[0].type === type
      )
      const before = await native.capture(`${shader}-${type}`)
      await native.update({
        color1: '#00ff00',
        color2: '#0000ff',
        color3: '#ff00ff',
      })
      await native.changed(before, `${shader}-${type}-controlled-colors`)
    })
  }

for (const type of geometries) {
  test(`native shader selection changes ${type} pixels at a fixed public-core pose and time`, async ({
    native,
  }) => {
    // Frozen F02 matrix recipe: canonical Halo props, time2, zoom8, ambient,
    // no grain/animation/transition. Keep every input except shader identical.
    await native.resize(480, 320)
    await native.configure({ pixelDensity: 1, fov: 45 })
    const images = new Map<(typeof shaders)[number], Buffer>()
    for (const shader of shaders) {
      await native.update(
        { ...frozen, type, shader },
        (state) =>
          state.scene?.meshes[0]?.shader === shader &&
          state.scene.meshes[0].type === type
      )
      images.set(shader, await native.capture(`selection-${type}-${shader}`))
    }
    const pairs: [(typeof shaders)[number], (typeof shaders)[number]][] = [
      ['defaults', 'cosmic'],
      ['defaults', 'glass'],
    ]
    // F02 captured defaults/positionMix sphere PNGs are identical (same hash);
    // do not invent a distinction that the established public variants lack.
    if (type !== 'sphere') pairs.push(['defaults', 'positionMix'])
    else pairs.push(['positionMix', 'cosmic'])
    for (const [left, right] of pairs) {
      expect(
        pixelDifference(images.get(left)!, images.get(right)!),
        `${type}: switching only ${left} -> ${right} changes actual pixels beyond RGB8 / 0.5%`
      ).toBeGreaterThan(0.005)
    }
    await native.update({ ...frozen, type, shader: 'defaults' })
    await native.equivalent(
      images.get('defaults')!,
      `selection-${type}-defaults-restored`
    )
  })
}

for (const name of presetNames) {
  test(`native preset ${name}: canonical consumer selection and deterministic replay`, async ({
    native,
    page,
  }) => {
    const preset = presets[name]
    await page
      .getByRole('combobox', { name: 'Preset', exact: true })
      .selectOption(name)
    await native.update(
      { animate: 'off', enableTransition: false },
      (s) =>
        s.scene?.meshes[0]?.shader === preset.props.shader &&
        s.scene.meshes[0].type === preset.props.type
    )
    if (preset.props.lightType === 'env')
      await native.wait(
        (s) => !!s.scene?.environmentUuid,
        'preset HDR has actually loaded'
      )
    const before = await native.capture(`preset-${name}`)
    const time = (await native.snapshot()).scene!.meshes[0].time
    await native.update({
      color1: '#00ff00',
      color2: '#0000ff',
      color3: '#ff00ff',
      grain: 'off',
    })
    await native.changed(before, `preset-${name}-controlled-change`)
    await native.update({
      ...preset.props,
      animate: 'off',
      enableTransition: false,
      uTime: time,
    })
    await native.equivalent(before, `preset-${name}-same-engine-replay`)
  })
}

const changes: { name: string; patch: GradientSettingsInput }[] = [
  { name: 'color1', patch: { color1: '#00eeff' } },
  { name: 'color2', patch: { color2: '#0011ff' } },
  { name: 'color3', patch: { color3: '#00ff22' } },
  { name: 'noise strength', patch: { uStrength: 0.2 } },
  { name: 'noise density', patch: { uDensity: 4.2 } },
  { name: 'noise frequency', patch: { uFrequency: 1.2 } },
  { name: 'noise amplitude', patch: { uAmplitude: 4 } },
  { name: 'reflection', patch: { reflection: 0.95 } },
  { name: 'wireframe', patch: { wireframe: true } },
  {
    name: 'position',
    patch: { positionX: 0.7, positionY: 0.5, positionZ: -0.8 },
  },
  {
    name: 'rotation degrees',
    patch: { rotationX: 35, rotationY: 65, rotationZ: 15 },
  },
]
for (const { name, patch } of changes) {
  test(`native reactive ${name}: visible effect without hot object replacement`, async ({
    native,
  }) => {
    // Frequency/amplitude drive the sphere spiral, not Halo's plane vertex
    // shader; exercise those knobs where public Core actually consumes them.
    await native.update({
      ...frozen,
      type:
        name === 'noise frequency' || name === 'noise amplitude'
          ? 'sphere'
          : 'plane',
      cameraZoom: 1,
    })
    if (name === 'reflection') {
      await native.update({ lightType: 'env', envPreset: 'city' })
      await native.wait(
        (s) => !!s.scene?.environmentUuid,
        'reflection comparison needs actual IBL'
      )
    }
    const before = await native.capture(`${name}-before`)
    const initial = await native.snapshot()
    await native.update(patch)
    const after = await native.snapshot()
    expect(after.canvas!.rendererIdentity).toBe(
      initial.canvas!.rendererIdentity
    )
    expect(after.scene!.meshes[0].uuid).toBe(initial.scene!.meshes[0].uuid)
    expect(after.scene!.meshes[0].materialUuid).toBe(
      initial.scene!.meshes[0].materialUuid
    )
    expect(after.scene!.meshes[0].uniformsIdentity).toBe(
      initial.scene!.meshes[0].uniformsIdentity
    )
    if (patch.rotationX !== undefined)
      expect(after.scene!.meshes[0].rotationRadians[0]).toBeCloseTo(
        (35 * Math.PI) / 180,
        8
      )
    if (patch.positionX !== undefined)
      expect(after.scene!.meshes[0].position).toEqual([0.7, 0.5, -0.8])
    if (patch.wireframe !== undefined)
      expect(after.scene!.meshes[0].wireframe).toBe(true)
    if (patch.reflection !== undefined)
      expect(after.scene!.meshes[0].roughness).toBeCloseTo(0.05, 8)
    await native.changed(before, `${name}-after`)
  })
}

test('native typed query precedence, false/zero, repeated keys, fragments and invalid values', async ({
  native,
}) => {
  await native.update({
    ...frozen,
    cameraZoom: 1,
    color1: '#abcdef',
    uStrength: 0,
    wireframe: false,
  })
  const direct = await native.capture('typed-query-direct')
  await native.update(
    {
      control: 'query',
      color1: '#123456',
      uStrength: 9,
      wireframe: true,
      urlString:
        'https://fixture.invalid/?color1=%23abcdef&color1=%23000000&uStrength=0&wireframe=false&uTime=2#uTime=99',
    },
    (s) =>
      s.scene?.meshes[0]?.time === 2 && s.scene.meshes[0].wireframe === false
  )
  await native.equivalent(direct, 'typed-query-override-equivalence')
  await native.update({ control: 'props', color1: '#123456', uStrength: 2.5 })
  const explicit = await native.capture('explicit-props')
  await native.update({
    control: 'query',
    urlString:
      '?shader=invalid&type=invalid&uTime=NaN&wireframe=maybe&uStrength=&unknown=1',
  })
  await native.equivalent(explicit, 'invalid-query-preserves-explicit')
  await native.update({ urlString: '?color1=%23abcdef' })
  await native.changed(explicit, 'partial-valid-query-changes-color')
})

test('native managed camera degrees, zoomOut, smooth transition and callback precision', async ({
  native,
}) => {
  await native.update({
    ...frozen,
    type: 'plane',
    cameraZoom: 1.23456,
    cAzimuthAngle: 47.2,
    cPolarAngle: 63.7,
    cDistance: 5.12345,
  })
  const target = (await native.snapshot()).scene!.camera.position
  const radius = Math.hypot(...target)
  expect(radius).toBeCloseTo(5.12345, 4)
  expect((Math.acos(target[1] / radius) * 180) / Math.PI).toBeCloseTo(63.7, 3)
  expect((Math.atan2(target[0], target[2]) * 180) / Math.PI).toBeCloseTo(
    47.2,
    3
  )
  const before = await native.capture('camera-degree-inputs')
  await native.wait(
    (s) =>
      s.cameraUpdates.some(
        (u) =>
          u.cAzimuthAngle === 47 && u.cPolarAngle === 64 && u.cDistance === 5.12
      ),
    'rounded typed plane camera callback'
  )
  const count = (await native.snapshot()).cameraUpdates.length
  await native.update({
    enableTransition: true,
    smoothTime: 0.15,
    cAzimuthAngle: -30,
    cPolarAngle: 75,
    cDistance: 7,
  })
  await native.wait(
    (s) =>
      s.cameraUpdates.length > count &&
      Math.abs(
        s.scene!.camera.position[1] - 7 * Math.cos((75 * Math.PI) / 180)
      ) < 0.02,
    'transition reaches requested camera, not unrelated next draw'
  )
  await native.changed(before, 'camera-transition-settled')
  await native.update({
    type: 'sphere',
    enableTransition: false,
    zoomOut: true,
  })
  await native.wait(
    (s) =>
      Math.abs(Math.hypot(...s.scene!.camera.position) - 14) < 0.01 &&
      Math.abs(s.scene!.camera.zoom - 5) < 0.01,
    'sphere zoomOut framing'
  )
  await native.capture('camera-zoomout')
  await native.update({
    zoomOut: false,
    cameraZoom: 1.23456,
    cAzimuthAngle: 47.2,
    cPolarAngle: 63.7,
  })
  await native.wait(
    (s) =>
      s.cameraUpdates.some((u) => u.cameraZoom === 1.23 && !('cDistance' in u)),
    'sphere callback zoom branch at two decimals'
  )
})

for (const envPreset of ['city', 'dawn', 'lobby'] as const) {
  test(`native selected HDR ${envPreset} and self-hosted HDR affect actual pixels`, async ({
    native,
    page,
  }) => {
    await native.update({
      ...frozen,
      cameraZoom: 1,
      lightType: '3d',
      brightness: 1.2,
      reflection: 0.9,
    })
    const ambient = await native.capture(`ambient-${envPreset}`)
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('.hdr')) requests.push(request.url())
    })
    await native.update({ lightType: 'env', envPreset })
    await native.wait(
      (s) => !!s.scene?.environmentUuid,
      'selected actual HDR texture installed'
    )
    expect(requests.some((url) => url.includes(envPreset))).toBe(true)
    const selected = await native.changed(ambient, `selected-${envPreset}`)
    // Serve the real selected asset through a consumer-local base path, not an echo texture.
    await page.route(
      `**/native-feature-hdr/${envPreset}.hdr`,
      async (route) => {
        const response = await page.request.get(
          `${defaultEnvBasePath.replace(/\/$/, '')}/${
            environmentManifest[envPreset]
          }`
        )
        expect(response.ok(), 'real HDR upstream asset fetch').toBe(true)
        await route.fulfill({
          status: response.status(),
          contentType: 'application/octet-stream',
          body: await response.body(),
        })
      }
    )
    const previous = (await native.snapshot()).scene!.environmentUuid
    await native.configure({ envBasePath: '/native-feature-hdr' })
    await native.wait(
      (s) => !!s.scene?.environmentUuid && s.scene.environmentUuid !== previous,
      'new self-hosted actual texture installed'
    )
    expect(
      requests.some((url) =>
        url.includes(`/native-feature-hdr/${envPreset}.hdr`)
      )
    ).toBe(true)
    await native.equivalent(selected, `self-hosted-${envPreset}-same-engine`)
    await native.update(
      { lightType: '3d' },
      (s) => s.scene?.environmentUuid === null
    )
    await native.equivalent(ambient, `ambient-${envPreset}-restored`)
  })
}

test('native grain blending endpoints and axes change rendered output', async ({
  native,
}) => {
  await native.update({ ...frozen, cameraZoom: 1, grain: 'off' })
  const clean = await native.capture('grain-off')
  await native.update({ grain: 'on', grainBlending: 0 })
  await native.equivalent(clean, 'grain-zero-endpoint')
  await native.update({ grainBlending: 1 })
  const grain = await native.changed(clean, 'grain-one-endpoint')
  await native.update({ grainBlending: 0.5 })
  await native.changed(grain, 'grain-half')
  await native.update(
    { grain: 'off', toggleAxis: true },
    (s) => s.scene?.axesVisible === true
  )
  let axisEvidence: AxisPixelEvidence[] = []
  const projection = await readAxesProjection(native.page)
  await expect
    .poll(
      async () => {
        axisEvidence = axesPixelEvidence(
          clean,
          await native.canvas.screenshot(),
          projection
        )
        return axisEvidence.filter((axis) => axis.changedPrimaryPixels >= 3)
          .length
      },
      {
        message:
          'at least two visible world axes produce changed primary-color strokes near actual scene-geometry/camera-projected segments',
      }
    )
    .toBeGreaterThanOrEqual(2)
  await native.capture('axes-visible')
  await attachEvidence(native.info, 'axes-projected-pixel-evidence.json', {
    body: JSON.stringify({ projection, axisEvidence }, null, 2),
    contentType: 'application/json',
  })
  await native.update(
    { toggleAxis: false },
    (s) => s.scene?.axesVisible === false
  )
  await native.equivalent(clean, 'axes-removed')
})

test('native pause, negative seek, resume, range wrapping and loop-over-range', async ({
  native,
  page,
}) => {
  await native.update({ ...frozen, cameraZoom: 1, uTime: -2 })
  const paused = await native.capture('negative-seek')
  const serial = (await native.draws()).at(-1)!.serial
  await page.evaluate(() => window.gradientFixture!.lifecycle.requestFrame())
  await native.frame(native.canvas, serial, { uTime: -2 })
  await native.equivalent(paused, 'paused-explicit-redraw')
  await native.update({ animate: 'on', uTime: 2, uSpeed: 1 })
  await native.wait(
    (s) => s.scene!.meshes[0].time > 2.1,
    'animation actually advances'
  )
  await native.changed(paused, 'resumed')
  await native.update({ animate: 'off', uTime: 3 })
  await native.capture('seek-three')
  await native.update({
    animate: 'off',
    range: 'enabled',
    rangeStart: 1,
    rangeEnd: 1.25,
    uTime: -0.1,
  })
  await native.wait(
    (s) => Math.abs(s.scene!.meshes[0].time - 1.15) < 0.0001,
    'negative seek uses documented offset-origin range modulo'
  )
  await native.frame(native.canvas, 0, { uTime: 1.15 })
  const ranged = await native.capture('range-wrapped-negative')
  await native.update({ range: 'disabled', uTime: 1.15 })
  await native.equivalent(ranged, 'range-equivalent-explicit-time')
  await native.update({
    loop: 'on',
    loopDuration: 0.25,
    range: 'enabled',
    rangeStart: 4,
    rangeEnd: 5,
    uTime: 0.6,
    animate: 'off',
  })
  await native.wait(
    (s) =>
      s.scene!.meshes[0].loop === 1 &&
      s.scene.meshes[0].loopDuration === 0.25 &&
      Math.abs(s.scene.meshes[0].time - 0.1) < 0.0001,
    'loop takes precedence over enabled range'
  )
  await native.capture('loop-over-range')
  const start = (await native.draws()).at(-1)!.serial
  await native.update({ animate: 'on' })
  await expect
    .poll(
      async () => {
        const times = (await native.draws())
          .filter((draw) => draw.serial > start)
          .map((draw) => draw.uniforms.uTime)
          .filter((value): value is number => typeof value === 'number')
        return (
          times.length > 2 &&
          times.every((value) => value >= 0 && value < 0.25) &&
          times.some((value, i) => i > 0 && value < times[i - 1] - 0.05)
        )
      },
      {
        message:
          'actual linked GPU loop time wraps while enabled range remains overridden',
      }
    )
    .toBe(true)
  await native.capture('loop-animated-wrap')
})

test('native DPR/FOV/resize are reactive; only construction options replace renderer', async ({
  native,
  page,
}) => {
  await native.update({ ...frozen, cameraZoom: 1 })
  const initial = await native.snapshot()
  const before = await native.capture('sizing-initial')
  await native.configure({ pixelDensity: 1.5, fov: 65 })
  let state = await native.snapshot()
  expect(state.canvas!.rendererIdentity).toBe(initial.canvas!.rendererIdentity)
  expect(state.scene!.meshes[0].materialUuid).toBe(
    initial.scene!.meshes[0].materialUuid
  )
  expect(state.canvas!.bufferWidth).toBe(
    Math.floor(state.canvas!.cssWidth * 1.5)
  )
  expect(state.scene!.camera.fov).toBe(65)
  await native.changed(before, 'fov-change')
  await native.resize(360, 240)
  state = await native.wait(
    (s) => s.canvas?.bufferWidth === 540 && s.canvas.bufferHeight === 360,
    'actual resize drawing buffer'
  )
  expect(state.canvas!.rendererIdentity).toBe(initial.canvas!.rendererIdentity)
  await native.capture('resized')
  for (const patch of [
    { preserveDrawingBuffer: true },
    { preserveDrawingBuffer: false },
    { powerPreference: 'low-power' as const },
  ]) {
    const previous = (await native.snapshot()).canvas!.rendererIdentity
    await native.configure(patch)
    expect((await native.snapshot()).canvas!.rendererIdentity).not.toBe(
      previous
    )
    await native.capture(`recreated-${Object.keys(patch)[0]}`)
  }
})

test('native independent canvases keep GPU time and pixels isolated', async ({
  native,
  page,
}, info) => {
  const metadata = info.project.metadata as unknown as NativeProjectMetadata
  if (metadata.nativeLifecycle.kind === 'kit') {
    const viewport = page.viewportSize()!
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, 2000),
    })
    const wrapper = page.getByRole('img', { name: 'Independent teal gradient' })
    // Lazy consumers expose their accessible wrapper before creating a canvas.
    await wrapper.scrollIntoViewIfNeeded()
    const independent = wrapper.locator('canvas')
    await native.frame(independent)
    const a = await native.capture('kit-independent', independent)
    const main = await native.capture('kit-managed-before-independent-edit')
    // Drive the actual consumer color-input binding, not a native SDK/private
    // setter. Trusted pointer/keyboard behavior is exercised in dedicated rows.
    await page
      .getByLabel('Independent color', { exact: true })
      .evaluate((element) => {
        const input = element as HTMLInputElement
        input.value = '#ff2200'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
    await native.changed(a, 'kit-independent-color-edit', independent)
    expect(
      pixelDifference(main, await nonblank(native.canvas))
    ).toBeLessThanOrEqual(0.005)
    const b = await nonblank(independent)
    await native.update({ uTime: 17, color1: '#ee2211' })
    expect(pixelDifference(b, await nonblank(independent))).toBeLessThanOrEqual(
      0.005
    )
  } else {
    const left = page.getByTestId('independent-a').locator('canvas')
    const right = page.getByTestId('independent-b').locator('canvas')
    await native.frame(left, 0, { uTime: 2 })
    await native.frame(right, 0, { uTime: 7 })
    const a = await native.capture('independent-left', left)
    const b = await native.capture('independent-right', right)
    await page.getByLabel('Left instance seek').fill('13')
    await native.frame(left, 0, { uTime: 13 })
    await native.changed(a, 'independent-left-seek', left)
    expect(pixelDifference(b, await nonblank(right))).toBeLessThanOrEqual(0.005)
    await native.update({ uTime: 17, color1: '#ee2211' })
    await native.frame(right, 0, { uTime: 7 })
    expect(pixelDifference(b, await nonblank(right))).toBeLessThanOrEqual(0.005)
  }
})

test('native two external gradients leave host camera/environment/rendering usable at two, one and zero', async ({
  native,
  page,
}, info) => {
  const host = page.getByTestId('external-host').locator('canvas')
  const metadata = info.project.metadata as unknown as NativeProjectMetadata
  const gradients = [
    {
      type: 'sphere' as const,
      shader: 'defaults' as const,
      positionX: -1.6,
      animate: 'off' as const,
      uTime: 1,
    },
    {
      type: 'sphere' as const,
      shader: 'cosmic' as const,
      positionX: 1.6,
      animate: 'off' as const,
      uTime: 3,
    },
  ]
  await page.evaluate(
    (value) =>
      window.gradientFixture!.externalHost.configure({
        enabled: true,
        gradients: value,
      }),
    gradients
  )
  const original = (
    await native.wait(
      (s) => s.externalHost?.gradientMeshCount === 2,
      'two real external meshes'
    )
  ).externalHost!
  await native.capture('host-two-gradients', host)
  for (const count of [1, 0]) {
    await page.evaluate(
      (value) =>
        window.gradientFixture!.externalHost.configure({
          enabled: true,
          gradients: value,
        }),
      gradients.slice(0, count)
    )
    const state = await native.wait(
      (s) => s.externalHost?.gradientMeshCount === count,
      `${count} external meshes`
    )
    expect(state.externalHost).toMatchObject({
      sceneUuid: original.sceneUuid,
      cameraUuid: original.cameraUuid,
      environmentUuid: original.environmentUuid,
      rendererIdentity: original.rendererIdentity,
    })
    const before = await native.capture(`host-${count}-before-camera`, host)
    const priorDraw = (await native.draws(host)).at(-1)!
    const oldMatrix = priorDraw.uniforms.modelViewMatrix
    expect(
      oldMatrix,
      'host vertex shader consumes an actual model-view matrix'
    ).toBeDefined()
    if (metadata.nativeLifecycle.kind === 'plain') {
      await page
        .getByRole('slider', { name: 'Host camera orbit' })
        .press(count === 1 ? 'End' : 'Home')
    } else {
      await page.evaluate(
        (angle) => {
          // Parent fixture returns actual consumer-owned Three refs, never SDK context.
          const boundary = window as unknown as {
            gradientLifecycle: {
              refs(): { host: { camera(): Camera; invalidate(): void } }
            }
          }
          const probe = boundary.gradientLifecycle.refs().host
          const camera = probe.camera()
          camera.position.set(Math.sin(angle) * 8, 1, Math.cos(angle) * 8)
          camera.lookAt(0, 0, 0)
          probe.invalidate()
        },
        count === 1 ? 1.2 : -1.2
      )
    }
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (await native.draws(host)).at(-1)?.uniforms.modelViewMatrix
          ),
        {
          message:
            'host camera reached actual GPU draw, not pending removal frame',
        }
      )
      .not.toBe(JSON.stringify(oldMatrix))
    if (metadata.nativeLifecycle.kind === 'kit' && count === 0) {
      // The real Kit host is an unlit0.8-unit cube at(0,-1.3,1), only625
      // nonclear GPU pixels in the retained failure, not a full gradient surface.
      // Require camera motion to change >half its actual drawn footprint, not
      // >0.5% of the mostly empty canvas. No camera/scene or RGB tolerance edits.
      expect(priorDraw.pixels!.nonclearPixels).toBeGreaterThan(0)
      let foregroundPixels = 0
      await expect
        .poll(
          async () => {
            const draw = (await native.draws(host)).at(-1)!
            expect(draw.pixels!.nonclearPixels).toBeGreaterThan(0)
            foregroundPixels = Math.max(
              priorDraw.pixels!.nonclearPixels,
              draw.pixels!.nonclearPixels
            )
            return pixelDifference(
              before,
              await host.screenshot(),
              foregroundPixels
            )
          },
          {
            message:
              'actual host-only camera motion changes more than half the real GPU mesh footprint (RGB8)',
          }
        )
        .toBeGreaterThan(0.5)
      await native.capture('host-0-camera-operational', host)
      await attachEvidence(native.info, 'host-only-footprint.json', {
        body: JSON.stringify(
          {
            before: priorDraw.pixels,
            after: (await native.draws(host)).at(-1)!.pixels,
            foregroundPixels,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })
    } else {
      await native.changed(before, `host-${count}-camera-operational`, host)
    }
  }
})

test('native trusted mouse orbit and keyboard-accessible surrounding controls', async ({
  native,
  page,
}, info) => {
  await native.configure({ pointerEvents: 'auto' })
  await native.update({ ...frozen, cameraZoom: 1 })
  const before = await native.capture('mouse-before')
  const position = (await native.snapshot()).scene!.camera.position
  await native.canvas.scrollIntoViewIfNeeded()
  const box = (await native.canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, {
    steps: 12,
  })
  await page.mouse.up()
  await native.wait(
    (s) =>
      JSON.stringify(s.scene!.camera.position) !== JSON.stringify(position),
    'trusted mouse changes actual managed camera'
  )
  await native.changed(before, 'mouse-orbit')
  const metadata = info.project.metadata as unknown as NativeProjectMetadata
  if (metadata.nativeLifecycle.kind === 'kit') {
    await page
      .getByRole('slider', { name: 'Noise strength', exact: true })
      .press('Home')
    await page.evaluate(() => window.gradientFixture!.lifecycle.requestFrame())
    await native.frame(native.canvas, 0, { uNoiseStrength: 0 })
    await native.capture('keyboard-noise-strength-zero')
  } else {
    const checkbox = page.getByRole('checkbox', {
      name: 'Wireframe',
      exact: true,
    })
    await checkbox.focus()
    await page.keyboard.press('Space')
    await native.wait(
      (s) => s.scene!.meshes[0].wireframe,
      'keyboard changes actual material'
    )
    await native.capture('keyboard-wireframe')
  }
})

test('native trusted touch drag changes actual camera where engine protocol supports movement', async ({
  native,
  page,
  browserName,
}, info) => {
  test.skip(
    !info.project.use.hasTouch,
    'desktop project has no touch device; desktop orbit has its own case'
  )
  test.skip(
    browserName !== 'chromium',
    `${browserName}: Playwright touchscreen provides trusted tap only, no trusted touchMove protocol; touch tap + keyboard case still runs`
  )
  await native.configure({ pointerEvents: 'auto' })
  await native.update({ ...frozen, cameraZoom: 1 })
  await native.canvas.scrollIntoViewIfNeeded()
  const before = await native.capture('touch-before')
  const position = (await native.snapshot()).scene!.camera.position
  const box = (await native.canvas.boundingBox())!
  const session = await page.context().newCDPSession(page)
  try {
    const x = box.x + box.width * 0.4,
      y = box.y + box.height * 0.5
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    })
    for (let i = 1; i <= 10; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 8, y: y + i * 2, id: 1 }],
      })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await native.wait(
      (s) =>
        JSON.stringify(s.scene!.camera.position) !== JSON.stringify(position),
      'trusted touch changes real camera'
    )
    await native.changed(before, 'touch-orbit')
  } finally {
    await session.detach()
  }
})

test('native touch-capable engines retain trusted tap and keyboard controls', async ({
  native,
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, 'touch device project only')
  const metadata = info.project.metadata as unknown as NativeProjectMetadata
  await native.update({ grain: 'off', wireframe: false })
  const before = await native.capture('touch-tap-before')
  const checkbox = page.getByRole('checkbox', {
    name: metadata.nativeLifecycle.kind === 'kit' ? 'Grain' : 'Wireframe',
    exact: true,
  })
  await checkbox.tap()
  await page.evaluate(() => window.gradientFixture!.lifecycle.requestFrame())
  await native.changed(before, 'touch-tap-effect')
  await checkbox.press('Space')
  await page.evaluate(() => window.gradientFixture!.lifecycle.requestFrame())
  await native.equivalent(before, 'touch-keyboard-recovery')
})

type OwnershipSnapshot = {
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
  resourceEvents: { id: string; kind: string; disposals: number }[]
}
type Ownership = {
  run(
    mode: 'missing-context' | 'duplicate-managed-owner'
  ): Promise<OwnershipSnapshot>
  recover(): Promise<OwnershipSnapshot>
  clear(): Promise<OwnershipSnapshot>
  snapshot(): OwnershipSnapshot
  refs(): {
    renderer: WebGLRenderer
    scene: Scene
    camera(): Camera
    hostMesh: Mesh
  }
}
interface OwnershipWindow extends Window {
  gradientOwnership: Ownership
}

for (const mode of ['missing-context', 'duplicate-managed-owner'] as const) {
  test(`native actionable ${mode} failure preserves host and recovers`, async ({
    page,
  }, info) => {
    const metadata = info.project.metadata as unknown as NativeProjectMetadata
    expect(metadata.nativeSvelte).toBe(true)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await installDrawObserver(page)
    await page.goto(
      `${metadata.nativeLifecycle.supportURL.replace(/\/$/, '')}/ownership`
    )
    await page.waitForFunction(() => 'gradientOwnership' in window)
    const host = await page.evaluate(() => {
      // Parent-owned consumer page defines this typed boundary, never an SDK context.
      const boundary = window as OwnershipWindow
      const api = boundary.gradientOwnership
      api.refs().renderer.domElement.setAttribute('data-feature-ownership', '')
      return api.snapshot().host
    })
    const canvas = page.locator('canvas[data-feature-ownership]')
    await nonblank(canvas)
    const failed = await page.evaluate(async (value) => {
      const boundary = window as OwnershipWindow
      return boundary.gradientOwnership.run(value)
    }, mode)
    expect(
      failed.errors.some(
        (error) =>
          error.code ===
            (mode === 'missing-context'
              ? 'missing-context'
              : 'duplicate-managed') && error.message.length > 0
      )
    ).toBe(true)
    expect(
      failed.errors.some((error) =>
        mode === 'missing-context'
          ? /Canvas/.test(error.message)
          : /external|managed|scene/i.test(error.message)
      ),
      'error explains the consumer correction'
    ).toBe(true)
    if (mode === 'missing-context') expect(failed.host).toEqual(host)
    else {
      // The support scenario installs a legitimate managed incumbent before
      // challenging its reservation; that incumbent owns its managed camera.
      expect(failed.host).toMatchObject({
        sceneUuid: host.sceneUuid,
        environmentUuid: host.environmentUuid,
        meshUuid: host.meshUuid,
        rendererIdentity: host.rendererIdentity,
      })
      expect(failed.nativeMeshCount).toBe(1)
    }
    expect(failed.host.contextLost).toBe(false)
    // Same actual refs remain usable, including when all native branches are cleared.
    const recovered = await page.evaluate(() => {
      const boundary = window as OwnershipWindow
      return boundary.gradientOwnership.recover()
    })
    expect(recovered.host.contextLost).toBe(false)
    if (mode === 'duplicate-managed-owner')
      expect(recovered.host).toEqual(failed.host)
    await nonblank(canvas)
    const cleared = await page.evaluate(() => {
      const boundary = window as OwnershipWindow
      return boundary.gradientOwnership.clear()
    })
    expect(cleared.host).toEqual(host)
    expect(cleared.nativeMeshCount).toBe(0)
    const before = await nonblank(canvas)
    const priorDraws = await canvas.evaluate(
      (element) =>
        window.nativeFeatureDraws.get(element as HTMLCanvasElement) ?? []
    )
    await page.evaluate(() => {
      const boundary = window as OwnershipWindow
      const refs = boundary.gradientOwnership.refs()
      const camera = refs.camera()
      camera.position.x += 1.5
      camera.lookAt(refs.hostMesh.position)
      camera.updateMatrixWorld()
      refs.renderer.render(refs.scene, camera)
    })
    const after = await nonblank(canvas)
    expect(
      pixelDifference(before, after),
      'real host camera/render path survives caught ownership failures'
    ).toBeGreaterThan(0.005)
    const draws = await canvas.evaluate(
      (element) =>
        window.nativeFeatureDraws.get(element as HTMLCanvasElement) ?? []
    )
    expect(draws.at(-1)?.linked).toBe(true)
    expect(draws.at(-1)?.uniforms.modelViewMatrix).toBeDefined()
    expect(draws.at(-1)?.uniforms.modelViewMatrix).not.toEqual(
      priorDraws.at(-1)?.uniforms.modelViewMatrix
    )
    expect(
      errors,
      'boundary must catch native errors, not uncaught page exceptions'
    ).toEqual([])
    await attachEvidence(info, `${mode}-host.png`, {
      body: after,
      contentType: 'image/png',
    })
    await attachEvidence(info, `${mode}-observations.json`, {
      body: JSON.stringify({ failed, cleared, draws }, null, 2),
      contentType: 'application/json',
    })
  })
}

test('native replays successful real F02 Mint recipe with preserved artifact provenance', async ({
  native,
  page,
  browserName,
}, info) => {
  const metadata = info.project.metadata as unknown as NativeProjectMetadata
  const indexPath =
    metadata.f02BaselineIndex ??
    process.env.SHADERGRADIENT_F02_INDEX ??
    resolve(__dirname, 'fixtures/f02-mint/evidence-index.json')
  type Baseline = {
    provenance: { browser: { name: string; version: string } }
    results: {
      id: string
      status: string
      artifacts: { role: string; path: string; sha256: string }[]
      observation?: {
        inputs: { props: GradientSettingsInput }
        latest: {
          uniforms: Record<string, number>
          transform: { position: number[]; rotation: (number | string)[] }
          geometry: { type: string }
          material: { roughness: number }
          renderer: { device: string; backend: string }
        }
      }
    }[]
  }
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as Baseline
  // Select a successful row; never baseline or suppress the preexisting failed rows.
  const row = index.results.find(
    (value) => value.id === 'vue/preset-mint' && value.status === 'passed'
  )!
  expect(row, 'preserved F02 successful Mint evidence is required').toBeTruthy()
  const artifact = row.artifacts.find((value) => value.role === 'canvas')!
  const reference = await readFile(resolve(dirname(indexPath), artifact.path))
  expect(createHash('sha256').update(reference).digest('hex')).toBe(
    artifact.sha256
  )
  await native.resize(480, 320)
  await native.canvas.evaluate((element) => {
    const wrapper = element.closest(
      '[data-testid="gradient-wrapper"], [data-testid="managed-placement"]'
    ) as HTMLElement
    // Fix the actual consumer layout to integer physical raster bounds. Do not
    // crop/resample either capture or reference to hide fractional screenshots.
    Object.assign(wrapper.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      margin: '0px',
      padding: '0px',
      border: '0px',
      borderRadius: '0px',
      transform: 'none',
      zIndex: '1000',
    })
  })
  await native.configure({ pixelDensity: 1, fov: 45 })
  await native.update({
    ...row.observation!.inputs.props,
    control: 'props',
    animate: 'off',
    enableTransition: false,
  })
  expect(
    await native.canvas.boundingBox(),
    'integer-aligned consumer canvas, not resampled pixels'
  ).toMatchObject({ x: 0, y: 0, width: 480, height: 320 })
  const raster = (await native.snapshot()).canvas!
  expect([raster.bufferWidth, raster.bufferHeight]).toEqual([480, 320])
  const current = await native.capture('F02-mint-native')
  const state = await native.snapshot()
  const expected = row.observation!.latest
  expect(state.scene!.meshes[0].geometryType).toBe(expected.geometry.type)
  expect(state.scene!.meshes[0].position).toEqual(expected.transform.position)
  expect(state.scene!.meshes[0].roughness).toBeCloseTo(
    expected.material.roughness,
    8
  )
  for (let i = 0; i < 3; i++)
    expect(state.scene!.meshes[0].rotationRadians[i]).toBeCloseTo(
      expected.transform.rotation[i] as number,
      8
    )
  await native.frame(
    native.canvas,
    0,
    Object.fromEntries(
      Object.entries(expected.uniforms).filter(([name]) =>
        /^(uTime|uNoiseDensity|uNoiseStrength|uC[123][rgb])$/.test(name)
      )
    )
  )
  const device = await native.canvas.evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2')!
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    return extension
      ? (gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) as string)
      : null
  })
  const sameEngine =
    browserName === index.provenance.browser.name &&
    page.context().browser()?.version() === index.provenance.browser.version &&
    device === expected.renderer.device
  const referenceImage = PNG.sync.read(reference)
  const currentImage = PNG.sync.read(current)
  const contextDpr = await page.evaluate(() => window.devicePixelRatio)
  const referenceRaster = {
    dpr: 1,
    width: referenceImage.width,
    height: referenceImage.height,
  }
  const currentRaster = {
    dpr: contextDpr,
    width: currentImage.width,
    height: currentImage.height,
  }
  const sameRaster =
    contextDpr === referenceRaster.dpr &&
    currentImage.width === referenceImage.width &&
    currentImage.height === referenceImage.height
  // F02's real context was DPR1. Native GPU buffer DPR and browser screenshot
  // DPR are distinct: a touch context may capture the same480x320 CSS/GPU scene
  // as720x480 PNG pixels. Never resample/crop or claim cross-DPR byte parity.
  // Matching desktop contexts retain the frozen RGB8/0.5% assertion; other
  // raster/engine contexts still exercise every actual GPU/semantic check above.
  if (sameEngine && sameRaster)
    expect(pixelDifference(reference, current)).toBeLessThanOrEqual(0.005)
  else
    info.annotations.push({
      type: 'F02-pixel-comparison',
      description: `Behavioral only; byte comparison requires the recorded engine AND DPR/raster: recorded ${
        index.provenance.browser.name
      }/${index.provenance.browser.version}/${
        expected.renderer.device
      }/${JSON.stringify(referenceRaster)}; current ${browserName}/${page
        .context()
        .browser()
        ?.version()}/${device}/${JSON.stringify(currentRaster)}`,
    })
  await attachEvidence(info, 'F02-preserved-mint.png', {
    body: reference,
    contentType: 'image/png',
  })
  await attachEvidence(info, 'F02-reference.json', {
    body: JSON.stringify(
      {
        indexPath,
        id: row.id,
        artifact,
        sameEngine,
        sameRaster,
        referenceRaster,
        currentRaster,
      },
      null,
      2
    ),
    contentType: 'application/json',
  })
})
