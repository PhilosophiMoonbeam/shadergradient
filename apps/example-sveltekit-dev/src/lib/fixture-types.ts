import type {
  CameraUpdate,
  CanvasFallbackState,
  ExternalSettingsInput,
  GradientSettingsInput,
  GradientType,
  ShaderName,
} from '@shadergradient/svelte'

export interface FixtureCanvasConfig {
  pixelDensity?: number
  fov?: number
  envBasePath?: string
  respectReducedMotion?: boolean
  lazyLoad?: boolean
  threshold?: number
  rootMargin?: string
  preserveDrawingBuffer?: boolean
  powerPreference?: WebGLPowerPreference
  pointerEvents?: 'none' | 'auto'
}
export interface FixtureExternalConfig {
  enabled: boolean
  gradients: ExternalSettingsInput[]
}
export interface FixtureMeshObservation {
  uuid: string
  geometryUuid: string
  materialUuid: string
  geometryType: string
  materialType: string
  shader: ShaderName
  type: GradientType
  position: [number, number, number]
  rotationRadians: [number, number, number]
  wireframe: boolean
  roughness: number
  time: number
  loop: number
  loopDuration: number
  colors: [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ]
  uniformsIdentity: number
}
export interface FixtureErrorObservation {
  code: string
  message: string
}
export interface FixtureObservation {
  revision: number
  mounted: boolean
  visible: boolean
  reducedMotion: boolean
  fallback: CanvasFallbackState['status'] | null
  canvas: null | {
    identity: number
    rendererIdentity: number
    cssWidth: number
    cssHeight: number
    bufferWidth: number
    bufferHeight: number
    dpr: number
    contextLost: boolean
  }
  scene: null | {
    uuid: string
    cameraUuid: string
    environmentUuid: string | null
    camera: {
      fov: number | null
      zoom: number
      position: [number, number, number]
    }
    meshes: FixtureMeshObservation[]
    axesVisible: boolean
  }
  externalHost: null | {
    sceneUuid: string
    cameraUuid: string
    environmentUuid: string | null
    initialCameraUuid: string
    initialEnvironmentUuid: string | null
    rendererIdentity: number
    initialRendererIdentity: number
    gradientMeshCount: number
  }
  cameraUpdates: CameraUpdate[]
  errors: FixtureErrorObservation[]
  counters: {
    completedFrames: number
    rendererCalls: number
    copyCalls: number | null
    geometryDisposals: number
    materialDisposals: number
    textureDisposals: number
    passDisposals: number | null
    targetDisposals: number | null
    rendererDisposals: number
    contextLosses: number
  }
}
export interface GradientFixture {
  readonly version: 1
  update(patch: GradientSettingsInput): Promise<FixtureObservation>
  configureCanvas(patch: FixtureCanvasConfig): Promise<FixtureObservation>
  snapshot(): FixtureObservation
  lifecycle: {
    setMounted(mounted: boolean): Promise<FixtureObservation>
    setIndependentMounted(mounted: boolean): Promise<void>
    setVisible(visible: boolean): Promise<FixtureObservation>
    requestFrame(): Promise<FixtureObservation>
  }
  externalHost: {
    configure(config: FixtureExternalConfig): Promise<FixtureObservation>
    clear(): Promise<FixtureObservation>
  }
  mirrors?: unknown
}
declare global {
  interface Window {
    gradientFixture?: GradientFixture
  }
}
