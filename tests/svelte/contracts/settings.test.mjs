import assert from 'node:assert/strict'
import { test } from 'node:test'

// UNIT ONLY: exercise the actual SDK build's internal pure module. These paths
// are not supported package subpaths, public exports, or packed-consumer proof.
// Parent orchestration builds core/native once before running these tests.
import {
  resolveExternalSettings,
  resolveGradientSettings,
} from '../../../packages/shadergradient-svelte/dist/settings.js'

const query = (urlString, explicit = {}) =>
  resolveGradientSettings({ ...explicit, control: 'query', urlString })

// Independent examples from the frozen F01 contract, not a copied default table.
test('halo < defined explicit props < recognized valid query, without wholesale replacement', () => {
  assert.equal(resolveGradientSettings().rotationZ, 50)
  assert.equal(resolveGradientSettings({ rotationZ: undefined }).rotationZ, 50)
  assert.equal(resolveGradientSettings({ rotationZ: -23 }).rotationZ, -23)
  const settings = query('rotationZ=137&shader=glass', {
    rotationZ: -23,
    shader: 'cosmic',
    color2: '#246',
    cDistance: 8.25,
  })
  assert.equal(settings.rotationZ, 137)
  assert.equal(settings.shader, 'glass')
  assert.equal(settings.color2, '#246')
  assert.equal(settings.cDistance, 8.25)
  assert.equal(settings.rotationY, 10)
})

test('props control (including omitted control) never enables query overrides', () => {
  for (const control of [undefined, 'props']) {
    const settings = resolveGradientSettings({
      control,
      urlString: '?uTime=42&wireframe=true',
      uTime: -3,
      wireframe: false,
    })
    assert.equal(settings.uTime, -3)
    assert.equal(settings.wireframe, false)
  }
})

test('partial invalid, empty, absent and unknown query entries preserve explicit values', () => {
  const settings = query(
    'uTime=NaN&uSpeed=Infinity&uStrength=&uDensity=+++&shader=Glass&type=cube&wireframe=1&grain=ON&unknown=12&positionY=9',
    {
      uTime: -9,
      uSpeed: 0,
      uStrength: 2.75,
      uDensity: -1,
      shader: 'positionMix',
      type: 'waterPlane',
      wireframe: true,
      grain: 'off',
      positionY: 4,
      color3: '#ab12cd',
    }
  )
  assert.equal(settings.uTime, -9)
  assert.equal(settings.uSpeed, 0)
  assert.equal(settings.uStrength, 2.75)
  assert.equal(settings.uDensity, -1)
  assert.equal(settings.shader, 'positionMix')
  assert.equal(settings.type, 'waterPlane')
  assert.equal(settings.wireframe, true)
  assert.equal(settings.grain, 'off')
  assert.equal(settings.positionY, 9)
  assert.equal(settings.color3, '#ab12cd')
  assert.equal(Object.hasOwn(settings, 'unknown'), false)
})

test('URL, path and raw query forms decode before applying values', () => {
  for (const url of [
    'uTime=-2.5&color1=%23aBc&positionX=+6+',
    '?uTime=-2.5&color1=%23aBc&positionX=+6+',
    '/demo?uTime=-2.5&color1=%23aBc&positionX=+6+#uTime=99',
    'https://example.test/demo?uTime=-2.5&color1=%23aBc&positionX=+6+#uTime=99',
  ]) {
    const settings = query(url)
    assert.equal(settings.uTime, -2.5, url)
    assert.equal(settings.color1, '#aBc', url)
    assert.equal(settings.positionX, 6, url)
  }
})

test('fragment stripping happens before finding a query; paths without queries have no overrides', () => {
  for (const url of [
    '/demo#?uTime=99',
    'https://example.test/#?uTime=99',
    '/uTime=99',
    'https://example.test/uTime=99',
    '#?uTime=99',
  ]) {
    assert.equal(query(url, { uTime: 6 }).uTime, 6, url)
  }
  const settings = query('color1=#fff&uTime=99', { color1: '#123', uTime: 6 })
  assert.equal(settings.color1, '#123')
  assert.equal(settings.uTime, 6)
})

test('the first decoded repeated entry wins, even when empty or invalid', () => {
  assert.equal(query('uTime=4&uTime=8').uTime, 4)
  assert.equal(query('uTime=&uTime=8', { uTime: 3 }).uTime, 3)
  assert.equal(query('uTime=no&uTime=8', { uTime: 3 }).uTime, 3)
  assert.equal(query('%75Time=-2&uTime=8').uTime, -2)
  assert.equal(query('uTime[]=8&uTime[0]=9', { uTime: 3 }).uTime, 3)
  assert.equal(
    query('wireframe=TRUE&wireframe=false', { wireframe: true }).wireframe,
    true
  )
})

for (const [key, value] of [
  ['uTime', -7.5],
  ['uSpeed', 0],
  ['uStrength', -2],
  ['uDensity', 0],
  ['uFrequency', 1e-7],
  ['uAmplitude', -0.25],
  ['positionX', 0],
  ['positionY', -41],
  ['positionZ', 6],
  ['rotationX', -720],
  ['rotationY', 360.5],
  ['rotationZ', 0],
  ['reflection', -0.5],
  ['rangeStart', -10],
  ['rangeEnd', -20],
  ['loopDuration', 0],
  ['cAzimuthAngle', 725],
  ['cPolarAngle', -15],
  ['cDistance', 0],
  ['cameraZoom', -1],
  ['smoothTime', 0],
  ['brightness', -2],
  ['grainBlending', 3],
]) {
  test(`finite numeric ${key} retains zero/negative/degree boundaries without clamping`, () => {
    assert.equal(resolveGradientSettings({ [key]: value })[key], value)
    assert.equal(
      query(`${key}=${encodeURIComponent(` ${value} `)}`)[key],
      value
    )
  })
}

for (const invalid of [
  '',
  ' ',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e309',
  '12px',
]) {
  test(`invalid numeric query ${JSON.stringify(invalid)} retains the explicit layer`, () => {
    assert.equal(
      query(`uTime=${encodeURIComponent(invalid)}`, { uTime: -4 }).uTime,
      -4
    )
  })
}

test('numeric Number syntax is accepted, not parseFloat prefixes or a new range policy', () => {
  assert.equal(query('uTime=0x10&uSpeed=2e-3&rotationY=%2B450').uTime, 16)
  assert.equal(query('uSpeed=2e-3').uSpeed, 0.002)
  assert.equal(query('rotationY=%2B450').rotationY, 450)
})

for (const key of ['wireframe', 'enableTransition', 'zoomOut', 'toggleAxis']) {
  test(`boolean ${key} recognizes only exact true/false and retains explicit false`, () => {
    assert.equal(resolveGradientSettings({ [key]: false })[key], false)
    assert.equal(query(`${key}=false`, { [key]: true })[key], false)
    assert.equal(query(`${key}=true`, { [key]: false })[key], true)
    for (const invalid of ['TRUE', 'False', '1', '0', '', ' true ', 'on']) {
      assert.equal(
        query(`${key}=${encodeURIComponent(invalid)}`, { [key]: false })[key],
        false
      )
    }
  })
}

for (const [key, values] of [
  ['type', ['plane', 'sphere', 'waterPlane']],
  ['shader', ['defaults', 'positionMix', 'cosmic', 'glass']],
  ['animate', ['on', 'off']],
  ['loop', ['on', 'off']],
  ['range', ['enabled', 'disabled']],
  ['lightType', ['3d', 'env']],
  ['envPreset', ['city', 'dawn', 'lobby']],
  ['grain', ['on', 'off']],
]) {
  test(`enum ${key} accepts every frozen member and rejects case/space/unknown values`, () => {
    for (const value of values) {
      assert.equal(resolveGradientSettings({ [key]: value })[key], value)
      assert.equal(query(`${key}=${value}`)[key], value)
    }
    const explicit = values[values.length - 1]
    for (const invalid of [
      'not-a-member',
      values[0].toUpperCase(),
      ` ${values[0]} `,
    ]) {
      assert.equal(
        query(`${key}=${encodeURIComponent(invalid)}`, { [key]: explicit })[
          key
        ],
        explicit
      )
    }
  })
}

for (const color of [
  '#aBc',
  '#012DEF',
  'rgb(0, 255, 1)',
  'hsl(-720.5, 0%, 100%)',
  'hsl(1e3,100%,0%)',
]) {
  test(`deterministic color subset accepts ${color}`, () => {
    assert.equal(
      query(`color2=${encodeURIComponent(` ${color} `)}`).color2,
      color
    )
    assert.equal(
      resolveGradientSettings({ color2: ` ${color} ` }).color2,
      color
    )
  })
}

for (const color of [
  'red',
  '#12',
  '#1234',
  '#12345678',
  'rgb(256,0,0)',
  'rgb(-1,0,0)',
  'rgb(1.5,0,0)',
  'rgba(0,0,0,1)',
  'hsl(0,101%,0%)',
  'hsl(0,0%,-1%)',
  'hsl(Infinity,0%,0%)',
  'var(--color)',
]) {
  test(`invalid color ${color} preserves explicit rather than using a browser parser`, () => {
    assert.equal(
      query(`color3=${encodeURIComponent(color)}`, { color3: '#135' }).color3,
      '#135'
    )
  })
}

test('frozen invalid explicit values retain halo, not partial or nonfinite state', () => {
  const settings = resolveGradientSettings({
    uTime: NaN,
    rotationZ: Infinity,
    shader: 'invalid',
    type: 'cube',
    color1: 'red',
  })
  assert.equal(settings.uTime, 0)
  assert.equal(settings.rotationZ, 50)
  assert.equal(settings.shader, 'defaults')
  assert.equal(settings.type, 'plane')
  assert.equal(settings.color1, '#ff5005')
})

test('query excludes ownership, callbacks, Canvas and tool settings', () => {
  const settings = query(
    'mode=external&control=props&urlString=uTime%3D99&onError=oops&pixelDensity=2&source=shared&hoverState=on&uTime=12'
  )
  assert.equal(settings.uTime, 12)
  for (const key of [
    'mode',
    'control',
    'urlString',
    'onError',
    'pixelDensity',
    'source',
    'hoverState',
  ]) {
    assert.equal(Object.hasOwn(settings, key), false, key)
  }
})

test('external normalization retains mesh/time overrides but never gains managed settings', () => {
  const settings = resolveExternalSettings({
    control: 'query',
    urlString:
      'uTime=-3&shader=glass&wireframe=false&brightness=99&grain=on&cDistance=9',
    uTime: 8,
    wireframe: true,
    rotationY: -185,
    brightness: 22,
    grain: 'on',
    cDistance: 12,
  })
  assert.equal(settings.uTime, -3)
  assert.equal(settings.shader, 'glass')
  assert.equal(settings.wireframe, false)
  assert.equal(settings.rotationY, -185)
  for (const key of [
    'brightness',
    'lightType',
    'envPreset',
    'grain',
    'grainBlending',
    'toggleAxis',
    'cDistance',
    'cameraZoom',
    'cAzimuthAngle',
    'cPolarAngle',
    'smoothTime',
    'enableTransition',
    'zoomOut',
  ]) {
    assert.equal(Object.hasOwn(settings, key), false, key)
  }
})

test('normalization is independent per call and does not mutate the explicit input', () => {
  const input = Object.freeze({
    control: 'query',
    urlString: 'uTime=11',
    uTime: -4,
    color1: '#246',
  })
  const first = resolveGradientSettings(input)
  assert.equal(input.uTime, -4)
  assert.equal(first.uTime, 11)
  const second = resolveGradientSettings({ uTime: 3 })
  assert.equal(second.uTime, 3)
  assert.equal(first.uTime, 11)
  assert.notEqual(first, second)
})
