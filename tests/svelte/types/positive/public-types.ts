import type { ComponentProps, Snippet } from 'svelte'
import {
  ShaderGradient,
  ShaderGradientCanvas,
  ShaderGradientSource,
  ShaderGradientView,
  type CameraSettings,
  type CameraUpdate,
  type CanvasFallbackState,
  type EffectsSettings,
  type EnvironmentPreset,
  type ExternalSettingsInput,
  type GradientCallbacks,
  type GradientError,
  type GradientSettingsInput,
  type GradientSourceHandle,
  type GradientType,
  type LightingSettings,
  type MeshSettings,
  type PresetName,
  type ProducerToken,
  type QuerySettings,
  type ResolvedExternalSettings,
  type ResolvedGradientSettings,
  type ShaderName,
  type SourceProducer,
  type SourceState,
  type TimeSettings,
  type Toggle,
} from '@shadergradient/svelte'

export const errorCodes: GradientError['code'][] = [
  'missing-context', 'duplicate-managed', 'duplicate-producer', 'unsupported-webgl',
  'renderer', 'context-lost', 'environment', 'copy', 'source-disposed',
]
export const errorPayload: GradientError = {
  code: 'copy', message: 'Consumer diagnostic', cause: new Error('Original cause'),
}
export const callbackPayloads: CameraUpdate[] = [
  { cAzimuthAngle: -37, cPolarAngle: 81, cDistance: 3.14 },
  { cAzimuthAngle: -37, cPolarAngle: 81, cameraZoom: 1.25 },
  { cAzimuthAngle: -37, cPolarAngle: 81 },
]
export const shader: ShaderName = 'positionMix'
export const geometry: GradientType = 'waterPlane'
export const preset: PresetName = 'violaOrientalis'
export const environment: EnvironmentPreset = 'lobby'
export const animate: Toggle = 'off'

export function settingsConsumers(
  mesh: MeshSettings,
  time: TimeSettings,
  camera: CameraSettings,
  lighting: LightingSettings,
  effects: EffectsSettings,
  query: QuerySettings
): [GradientSettingsInput, ExternalSettingsInput, ResolvedGradientSettings, ResolvedExternalSettings] {
  return [
    { ...mesh, ...time, ...camera, ...lighting, ...effects, ...query },
    { ...mesh, ...time, ...query },
    { ...mesh, ...time, ...camera, ...lighting, ...effects },
    { ...mesh, ...time },
  ]
}

export function componentConsumers(
  handle: GradientSourceHandle,
  children: Snippet,
  fallback: Snippet<[CanvasFallbackState]>,
  sourceFallback: Snippet<[SourceState]>,
  callbacks: GradientCallbacks
): [
  ComponentProps<typeof ShaderGradientCanvas>,
  ComponentProps<typeof ShaderGradient>,
  ComponentProps<typeof ShaderGradientSource>,
  ComponentProps<typeof ShaderGradientView>,
] {
  return [
    { children, fallback, class: 'public', ...callbacks },
    { mode: 'external', shader, type: geometry, ...callbacks },
    { source: handle, children, fallback: sourceFallback, gradient: { shader, ...callbacks }, ...callbacks },
    { source: handle, fallback: sourceFallback, ...callbacks },
  ]
}

export function producerConsumer(handle: GradientSourceHandle, producer: SourceProducer): void {
  const token: ProducerToken = handle.attachProducer(producer)
  const accepted: boolean = handle.setProducerState(token, { status: 'error', error: errorPayload })
  const replacement: ProducerToken | undefined = handle.resetProducer(token)
  if (replacement) handle.detachProducer(replacement)
  console.info(accepted)
}
