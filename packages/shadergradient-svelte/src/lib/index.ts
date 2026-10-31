export { presets, presetsArray } from '@shadergradient/core'
export { default as ShaderGradientCanvas } from './Canvas.svelte'
export { default as ShaderGradient } from './ShaderGradient.svelte'
export { default as ShaderGradientSource } from './ShaderGradientSource.svelte'
export { default as ShaderGradientView } from './ShaderGradientView.svelte'
export { createGradientSource } from './source.svelte.js'
export type {
  ShaderName,
  GradientType,
  PresetName,
  EnvironmentPreset,
  Toggle,
  MeshSettings,
  TimeSettings,
  CameraSettings,
  LightingSettings,
  EffectsSettings,
  ResolvedExternalSettings,
  ResolvedGradientSettings,
  QuerySettings,
  GradientSettingsInput,
  ExternalSettingsInput,
  CameraUpdate,
  GradientError,
  GradientCallbacks,
  ManagedGradientProps,
  ExternalGradientProps,
  ShaderGradientProps,
  CanvasFallbackState,
  WrapperAttributes,
  ShaderGradientCanvasProps,
  SourceState,
  SourceDemand,
  ProducerToken,
  CompletedFrame,
  FrameLease,
  SourceViewLease,
  SourceProducer,
  GradientSourceHandle,
  GradientSourceOptions,
  ShaderGradientSourceProps,
  ShaderGradientViewProps,
} from './types.js'
