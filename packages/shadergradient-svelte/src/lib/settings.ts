import { presets } from '@shadergradient/core'
import type {
  ExternalSettingsInput,
  GradientSettingsInput,
  ResolvedExternalSettings,
  ResolvedGradientSettings,
} from './types.js'

type SettingsKey = keyof ResolvedGradientSettings
type MutableSettings = {
  -readonly [K in SettingsKey]: ResolvedGradientSettings[K]
}
type Rule = 'number' | 'boolean' | 'color' | readonly string[]

// The complete native key table also bounds preset projection and query overrides.
const rules = Object.freeze({
  type: ['plane', 'sphere', 'waterPlane'],
  shader: ['defaults', 'positionMix', 'cosmic', 'glass'],
  color1: 'color',
  color2: 'color',
  color3: 'color',
  uSpeed: 'number',
  uStrength: 'number',
  uDensity: 'number',
  uFrequency: 'number',
  uAmplitude: 'number',
  reflection: 'number',
  wireframe: 'boolean',
  positionX: 'number',
  positionY: 'number',
  positionZ: 'number',
  rotationX: 'number',
  rotationY: 'number',
  rotationZ: 'number',
  animate: ['on', 'off'],
  uTime: 'number',
  loop: ['on', 'off'],
  loopDuration: 'number',
  range: ['enabled', 'disabled'],
  rangeStart: 'number',
  rangeEnd: 'number',
  cAzimuthAngle: 'number',
  cPolarAngle: 'number',
  cDistance: 'number',
  cameraZoom: 'number',
  smoothTime: 'number',
  enableTransition: 'boolean',
  zoomOut: 'boolean',
  lightType: ['3d', 'env'],
  brightness: 'number',
  envPreset: ['city', 'dawn', 'lobby'],
  grain: ['on', 'off'],
  grainBlending: 'number',
  toggleAxis: 'boolean',
} as const satisfies Record<SettingsKey, Rule>)

function validColor(value: string): boolean {
  if (/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value)) return true
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value)
  if (rgb) {
    return (
      Number(rgb[1]) <= 255 && Number(rgb[2]) <= 255 && Number(rgb[3]) <= 255
    )
  }
  const hsl =
    /^hsl\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)%\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)%\s*\)$/.exec(
      value
    )
  if (!hsl) return false
  const hue = Number(hsl[1])
  const saturation = Number(hsl[2])
  const lightness = Number(hsl[3])
  return (
    Number.isFinite(hue) &&
    Number.isFinite(saturation) &&
    Number.isFinite(lightness) &&
    saturation >= 0 &&
    saturation <= 100 &&
    lightness >= 0 &&
    lightness <= 100
  )
}

function parseValue(rule: Rule, value: unknown, query: boolean): unknown {
  if (rule === 'number') {
    if (query && typeof value === 'string' && value.trim() !== '') {
      const number = Number(value.trim())
      return Number.isFinite(number) ? number : undefined
    }
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined
  }
  if (rule === 'boolean') {
    if (query)
      return value === 'true' ? true : value === 'false' ? false : undefined
    return typeof value === 'boolean' ? value : undefined
  }
  if (typeof value !== 'string') return undefined
  if (rule === 'color') {
    const color = value.trim()
    return validColor(color) ? color : undefined
  }
  return rule.includes(value) ? value : undefined
}

function queryParams(urlString: string): URLSearchParams {
  // A literal hash starts the fragment even in a bare query; colors need %23.
  const fragment = urlString.indexOf('#')
  const text = fragment === -1 ? urlString : urlString.slice(0, fragment)
  const question = text.indexOf('?')
  const query =
    question !== -1
      ? text.slice(question + 1)
      : text.includes('/') || text.includes('://')
        ? ''
        : text
  return new URLSearchParams(query)
}

function applyValue<K extends SettingsKey>(
  settings: Partial<MutableSettings>,
  key: K,
  value: unknown,
  query: boolean
): void {
  const parsed = parseValue(rules[key], value, query)
  // The key's rule is the runtime counterpart of its declared settings type.
  if (parsed !== undefined) settings[key] = parsed as MutableSettings[K]
}

function resolve<T extends ResolvedExternalSettings>(
  settings: T,
  input?: GradientSettingsInput
): T {
  const target: Partial<MutableSettings> = settings
  const params =
    input?.control === 'query' ? queryParams(input.urlString ?? '') : undefined
  for (const key of Object.keys(settings) as SettingsKey[]) {
    applyValue(target, key, input?.[key], false)
    // get() deliberately keeps the first decoded entry, including invalid/empty ones.
    if (params) applyValue(target, key, params.get(key), true)
  }
  return settings
}

function externalDefaults(): ResolvedExternalSettings {
  const halo = presets.halo.props
  return {
    type: halo.type,
    shader: halo.shader,
    color1: halo.color1,
    color2: halo.color2,
    color3: halo.color3,
    uSpeed: halo.uSpeed,
    uStrength: halo.uStrength,
    uDensity: halo.uDensity,
    uFrequency: halo.uFrequency,
    uAmplitude: halo.uAmplitude,
    reflection: halo.reflection,
    wireframe: halo.wireframe,
    positionX: halo.positionX,
    positionY: halo.positionY,
    positionZ: halo.positionZ,
    rotationX: halo.rotationX,
    rotationY: halo.rotationY,
    rotationZ: halo.rotationZ,
    animate: halo.animate,
    uTime: halo.uTime,
    loop: 'off',
    loopDuration: 5,
    range: 'disabled',
    rangeStart: 0,
    rangeEnd: 40,
  }
}

/** Halo < valid defined props < valid first query entries (only in query mode).
 * Derive on input changes, not frames; invalid values preserve the previous layer.
 */
export function resolveGradientSettings(
  input?: GradientSettingsInput
): ResolvedGradientSettings {
  const halo = presets.halo.props
  return resolve(
    {
      ...externalDefaults(),
      cAzimuthAngle: halo.cAzimuthAngle,
      cPolarAngle: halo.cPolarAngle,
      cDistance: halo.cDistance,
      cameraZoom: halo.cameraZoom,
      smoothTime: 0.05,
      enableTransition: true,
      zoomOut: false,
      lightType: halo.lightType,
      brightness: halo.brightness,
      envPreset: halo.envPreset,
      grain: halo.grain,
      grainBlending: 1,
      toggleAxis: false,
    },
    input
  )
}

/** Mesh/time-only projection with the same precedence; managed keys never enter it. */
export function resolveExternalSettings(
  input?: ExternalSettingsInput
): ResolvedExternalSettings {
  return resolve(externalDefaults(), input)
}
