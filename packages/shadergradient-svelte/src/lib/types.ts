import type { Snippet } from 'svelte'
import type { HTMLAttributes } from 'svelte/elements'
import type {
  AmbientLight,
  AxesHelper,
  BufferGeometry,
  Camera,
  IUniform,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'

/** Selected API contract; this module deliberately contains no runtime exports. */
export type ShaderName = 'defaults' | 'positionMix' | 'cosmic' | 'glass'
export type GradientType = 'plane' | 'sphere' | 'waterPlane'
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
export type EnvironmentPreset = 'city' | 'dawn' | 'lobby'
export type Toggle = 'on' | 'off'
export type Dispose = () => void
export type Read<T> = () => T

export interface MeshSettings {
  type: GradientType
  shader: ShaderName
  color1: string
  color2: string
  color3: string
  uSpeed: number
  uStrength: number
  uDensity: number
  uFrequency: number
  uAmplitude: number
  reflection: number
  wireframe: boolean
  positionX: number
  positionY: number
  positionZ: number
  /** Degrees, converted only when synchronizing the Three object. */
  rotationX: number
  rotationY: number
  rotationZ: number
}

export interface TimeSettings {
  animate: Toggle
  uTime: number
  loop: Toggle
  loopDuration: number
  range: 'enabled' | 'disabled'
  rangeStart: number
  rangeEnd: number
}

export interface CameraSettings {
  cAzimuthAngle: number
  cPolarAngle: number
  cDistance: number
  cameraZoom: number
  smoothTime: number
  enableTransition: boolean
  zoomOut: boolean
}

export interface LightingSettings {
  lightType: '3d' | 'env'
  brightness: number
  envPreset: EnvironmentPreset
}

export interface EffectsSettings {
  grain: Toggle
  grainBlending: number
  toggleAxis: boolean
}

export type ResolvedExternalSettings = Readonly<MeshSettings & TimeSettings>
export type ResolvedGradientSettings = Readonly<
  MeshSettings &
    TimeSettings &
    CameraSettings &
    LightingSettings &
    EffectsSettings
>
export interface QuerySettings {
  control?: 'props' | 'query'
  urlString?: string
}
export type GradientSettingsInput = Partial<
  MeshSettings &
    TimeSettings &
    CameraSettings &
    LightingSettings &
    EffectsSettings
> &
  QuerySettings
export type ExternalSettingsInput = Partial<MeshSettings & TimeSettings> &
  QuerySettings

/** Angles are integer degrees; optional distance/zoom are rounded to two decimals. */
export type CameraUpdate = {
  cAzimuthAngle: number
  cPolarAngle: number
} & (
  | { cDistance: number; cameraZoom?: never }
  | { cameraZoom: number; cDistance?: never }
  | { cDistance?: never; cameraZoom?: never }
)
export interface GradientError {
  code:
    | 'missing-context'
    | 'duplicate-managed'
    | 'duplicate-producer'
    | 'unsupported-webgl'
    | 'renderer'
    | 'context-lost'
    | 'environment'
    | 'copy'
    | 'source-disposed'
  message: string
  cause?: unknown
}
export interface GradientCallbacks {
  onError?: (error: GradientError) => void
}
export type ManagedGradientProps = GradientSettingsInput &
  GradientCallbacks & {
    mode?: 'managed'
    onCameraUpdate?: (update: CameraUpdate) => void
  }
export type ExternalGradientProps = ExternalSettingsInput &
  GradientCallbacks & {
    mode: 'external'
    onCameraUpdate?: never
  } & {
    [K in keyof (CameraSettings & LightingSettings & EffectsSettings)]?: never
  }
export type ShaderGradientProps = ManagedGradientProps | ExternalGradientProps

export type CanvasFallbackState =
  | { status: 'deferred'; error?: never }
  | { status: 'loading'; error?: never }
  | { status: 'unsupported'; error: GradientError }
  | { status: 'error'; error: GradientError }
export type WrapperAttributes = Omit<HTMLAttributes<HTMLDivElement>, 'children'>
export type ShaderGradientCanvasProps = WrapperAttributes &
  GradientCallbacks & {
    children?: Snippet
    fallback?: Snippet<[state: CanvasFallbackState]>
    pixelDensity?: number
    fov?: number
    pointerEvents?: 'none' | 'auto'
    envBasePath?: string
    respectReducedMotion?: boolean
    /** Gate temporal work, not explicit redraws; Source supplies visible-view demand. */
    active?: boolean
    lazyLoad?: boolean
    threshold?: number
    rootMargin?: string
    preserveDrawingBuffer?: boolean
    powerPreference?: WebGLPowerPreference
  }

export type SourceState =
  | { status: 'absent'; generation: number; error?: never }
  | { status: 'loading'; generation: number; error?: never }
  | { status: 'ready'; generation: number; error?: never }
  | { status: 'error'; generation: number; error: GradientError }
  | { status: 'disposed'; generation: number; error?: never }
export interface SourceDemand {
  readonly visibleViews: number
  readonly pendingFrames: number
}
export interface ProducerToken {
  readonly generation: number
  readonly identity: symbol
}
/** Borrowed only for the synchronous callback; never retain this object or its canvas. */
export interface CompletedFrame {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  readonly sequence: number
}
export interface FrameLease {
  /** Cancels an unfulfilled request; idempotent after completion or release. */
  release: Dispose
}
export interface SourceViewLease {
  setVisible(visible: boolean): void
  release: Dispose
}
export interface SourceProducer {
  invalidate(): void
  onDemandChange(demand: SourceDemand): void
}
export interface GradientSourceHandle {
  /** Reactive read; snapshots change only on lifecycle transitions, not every frame. */
  readonly state: SourceState
  readonly demand: SourceDemand
  subscribe(listener: (state: SourceState) => void): Dispose
  subscribeFrames(
    listener: (frame: CompletedFrame, token: ProducerToken) => void
  ): Dispose
  /** Rotate the current generation without surrendering the producer reservation. */
  resetProducer(token: ProducerToken): ProducerToken | undefined
  attachProducer(producer: SourceProducer): ProducerToken
  setProducerState(
    token: ProducerToken,
    state: { status: 'loading' } | { status: 'error'; error: GradientError }
  ): boolean
  /** Synchronous dispatch only for the currently attached generation. */
  publishFrame(token: ProducerToken, frame: CompletedFrame): boolean
  detachProducer(token: ProducerToken): void
  attachView(visible: boolean): SourceViewLease
  requestFrame(): FrameLease
  /** Explicit owner teardown, terminal; components never dispose caller-owned handles. */
  dispose(): void
}
export interface GradientSourceOptions {
  /** Diagnostic label only: never a lookup key. */
  label?: string
}
export type ShaderGradientSourceProps = WrapperAttributes &
  GradientCallbacks & {
    source: GradientSourceHandle
    gradient?: ManagedGradientProps
    canvas?: Omit<
      ShaderGradientCanvasProps,
      | keyof WrapperAttributes
      | 'children'
      | 'fallback'
      | 'active'
      | 'pixelDensity'
    >
    width?: number
    height?: number
    pixelDensity?: number
    maxDimension?: number
    children?: Snippet
    fallback?: Snippet<[state: SourceState]>
  }
export type ShaderGradientViewProps = WrapperAttributes &
  GradientCallbacks & {
    source: GradientSourceHandle
    pixelDensity?: number
    maxDimension?: number
    threshold?: number
    rootMargin?: string
    fallback?: Snippet<[state: SourceState]>
  }

/* Internal contracts. Import these directly from types.js, not the public index. */
export interface CanvasSettings {
  pixelDensity: number
  fov: number
  envBasePath: string
  respectReducedMotion: boolean
}
export interface CanvasContextInput {
  settings: Read<CanvasSettings>
  reducedMotion: Read<boolean>
  active: Read<boolean>
  onError: Read<((error: GradientError) => void) | undefined>
}
export interface FrameSize {
  /** CSS pixels. */
  width: number
  height: number
  /** Actual renderer DPR, not the requested device DPR. */
  dpr: number
}
export type FramePhase = 'controls' | 'animation'
export interface ScheduledWork {
  /** Called only while this owner has temporal work. Must not allocate per frame. */
  tick(delta: number): void
  active: Read<boolean>
}
export interface RenderReplacement {
  /** One completed render, including all passes. Throwing means no frame publication. */
  render(delta: number): void
}
export interface CanvasLifecycleContext {
  readonly settings: CanvasSettings
  readonly reducedMotion: boolean
  readonly active: boolean
  readonly canvas: HTMLCanvasElement | undefined
  readonly renderer: WebGLRenderer | undefined
  readonly rendererOwnership: 'canvas' | 'host'
  readonly size: FrameSize
  invalidate(): void
  registerWork(phase: FramePhase, work: ScheduledWork): Dispose
  /** At most one replacement; conditional restoration of host autoRender. */
  replaceRender(owner: symbol, replacement: RenderReplacement): Dispose
  subscribeAfterRender(listener: (frame: CompletedFrame) => void): Dispose
  readonly environmentState: EnvironmentState
  /** F13 forwards its managed environment owner; undefined conditionally releases it. */
  setEnvironmentState(owner: symbol, state: EnvironmentState | undefined): void
  subscribeEnvironment(listener: (state: EnvironmentState) => void): Dispose
  reportError(error: GradientError): void
}
export interface CanvasSceneProps {
  children?: Snippet
  onReady?: (lifecycle: CanvasLifecycleContext) => void
}
export interface ManagedSceneLease {
  readonly scene: Scene
  readonly owner: symbol
  readonly active: boolean
  release: Dispose
}
export interface SceneContext {
  acquireManaged(owner: symbol): ManagedSceneLease
}

export interface GradientUniforms {
  [name: string]: IUniform
  uTime: IUniform<number>
  uLoadingTime: IUniform<number>
  uSpeed: IUniform<number>
  uNoiseDensity: IUniform<number>
  uNoiseStrength: IUniform<number>
  uFrequency: IUniform<number>
  uAmplitude: IUniform<number>
  uLoop: IUniform<number>
  uLoopDuration: IUniform<number>
  uC1r: IUniform<number>
  uC1g: IUniform<number>
  uC1b: IUniform<number>
  uC2r: IUniform<number>
  uC2g: IUniform<number>
  uC2b: IUniform<number>
  uC3r: IUniform<number>
  uC3g: IUniform<number>
  uC3b: IUniform<number>
  uColor1: IUniform<Vector3>
  uColor2: IUniform<Vector3>
  uColor3: IUniform<Vector3>
  uIntensity: IUniform<number>
  uTransparency: IUniform<number>
  uRefraction: IUniform<number>
  uChromaticAberration: IUniform<number>
  uFresnelPower: IUniform<number>
  uReflectivity: IUniform<number>
  uWaveAmplitude: IUniform<number>
  uWaveFrequency: IUniform<number>
  uDistortion: IUniform<number>
  uFlowSpeed: IUniform<number>
  uFlowDirection: IUniform<Vector2>
  uLiquidEffect: IUniform<number>
  uFoamIntensity: IUniform<number>
}
export interface MaterialHandle {
  readonly material: MeshPhysicalMaterial
  readonly uniforms: GradientUniforms
  update(settings: ResolvedExternalSettings): void
  dispose: Dispose
}
export interface MeshHandle {
  readonly mesh: Mesh<BufferGeometry, MeshPhysicalMaterial>
  /** Live getters: a variant change may replace the material/uniform containers. */
  readonly material: MeshPhysicalMaterial
  readonly uniforms: GradientUniforms
  readonly uTime: IUniform<number>
}
export interface MeshProps {
  settings: ResolvedExternalSettings
  lifecycle: CanvasLifecycleContext
  onReady?: (handle: MeshHandle | undefined) => void
}
export interface AnimationInput {
  settings: Read<ResolvedExternalSettings>
  mesh: Read<MeshHandle | undefined>
  lifecycle: CanvasLifecycleContext
  /** Source demand, or true for an ordinary gradient. */
  enabled?: Read<boolean>
}
export interface AnimationHandle {
  readonly elapsed: number
  seek(time: number): void
  dispose: Dispose
}
export interface CameraInput {
  settings: Read<ResolvedGradientSettings>
  lifecycle: CanvasLifecycleContext
  lease: ManagedSceneLease
  getCamera: Read<Camera>
  setCamera(camera: Camera): void
  onCameraUpdate: Read<((update: CameraUpdate) => void) | undefined>
  onError: Read<((error: GradientError) => void) | undefined>
}
export interface CameraHandle {
  readonly camera: PerspectiveCamera
  dispose: Dispose
}
export type CameraProps = CameraInput
export type EnvironmentState =
  | { status: 'disabled'; error?: never }
  | { status: 'loading'; error?: never }
  | { status: 'ready'; error?: never }
  | { status: 'error'; error: GradientError }
export interface EnvironmentInput {
  settings: Read<ResolvedGradientSettings>
  lifecycle: CanvasLifecycleContext
  lease: ManagedSceneLease
  onState: Read<((state: EnvironmentState) => void) | undefined>
  onError: Read<((error: GradientError) => void) | undefined>
}
export interface EnvironmentHandle {
  readonly ambient: AmbientLight
  readonly state: EnvironmentState
  dispose: Dispose
}
export type LightsProps = EnvironmentInput
export interface GrainInput {
  settings: Read<ResolvedGradientSettings>
  lifecycle: CanvasLifecycleContext
  lease: ManagedSceneLease
  camera: Read<Camera>
}
export interface GrainHandle {
  dispose: Dispose
}
export type GrainProps = GrainInput
export interface AxesProps {
  enabled: boolean
  lifecycle: CanvasLifecycleContext
  lease: ManagedSceneLease
}
export interface AxesHandle {
  readonly axes: AxesHelper
  dispose: Dispose
}
