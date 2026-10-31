export type ShaderName = 'defaults' | 'positionMix' | 'cosmic' | 'glass'
export type GradientType = 'plane' | 'sphere' | 'waterPlane'
export type EnvironmentPreset = 'city' | 'dawn' | 'lobby'
export type LightType = '3d' | 'env'
export type Toggle = 'on' | 'off'
export type PresetName =
  | 'halo'
  | 'pensive'
  | 'mint'
  | 'interstella'
  | 'nightyNight'
  | 'violaOrientalis'
  | 'universe'
  | 'sunset'
  | 'mandarin'
  | 'cottonCandy'

export interface ShaderSource {
  readonly vertex: string
  readonly fragment: string
}
export type ShaderFamily = Readonly<Record<GradientType, ShaderSource>>
export type ShaderCollection = Readonly<Record<ShaderName, ShaderFamily>>

export interface PresetProps {
  type: GradientType
  shader: ShaderName
  animate: Toggle
  uTime: number
  uSpeed: number
  uStrength: number
  uDensity: number
  uFrequency: number
  uAmplitude: number
  range: 'enabled' | 'disabled'
  rangeStart: number
  rangeEnd: number
  positionX: number
  positionY: number
  positionZ: number
  rotationX: number
  rotationY: number
  rotationZ: number
  color1: string
  color2: string
  color3: string
  reflection: number
  wireframe: boolean
  brightness: number
  cAzimuthAngle: number
  cPolarAngle: number
  cDistance: number
  cameraZoom: number
  lightType: LightType
  envPreset: EnvironmentPreset
  grain: Toggle
  pixelDensity: number
  fov: number
  // Retained legacy tool metadata, never native feature promises.
  frameRate: number
  destination: string
  format: string
  axesHelper: string
  embedMode: string
  gizmoHelper?: string
  bgColor1?: string
  bgColor2?: string
  // Preserve optional temporal data if supplied by a data consumer.
  loop?: Toggle
  loopDuration?: number
}
export interface GradientPreset {
  title: string
  color: string
  props: PresetProps
}
export type PresetCollection = Record<PresetName, GradientPreset>

export type EnvironmentManifest = Readonly<Record<EnvironmentPreset, string>>

export interface ShaderUniform<T> {
  value: T
}
export interface HalftoneUniforms {
  tDiffuse: ShaderUniform<unknown>
  shape: ShaderUniform<number>
  radius: ShaderUniform<number>
  rotateR: ShaderUniform<number>
  rotateG: ShaderUniform<number>
  rotateB: ShaderUniform<number>
  scatter: ShaderUniform<number>
  width: ShaderUniform<number>
  height: ShaderUniform<number>
  blending: ShaderUniform<number>
  blendingMode: ShaderUniform<number>
  greyscale: ShaderUniform<boolean>
  disable: ShaderUniform<boolean>
}
export interface HalftoneShaderDefinition {
  uniforms: HalftoneUniforms
  vertexShader: string
  fragmentShader: string
}
