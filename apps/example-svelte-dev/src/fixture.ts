import { tick } from 'svelte'
import type {
  CameraUpdate,
  CanvasFallbackState,
  GradientError,
  GradientSettingsInput,
  GradientType,
  ShaderName,
} from '@shadergradient/svelte'
import {
  BufferGeometry,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Texture,
} from 'three'
import type { Camera, Scene, WebGLRenderer } from 'three'
import type {
  FixtureCanvasConfig,
  FixtureExternalConfig,
  FixtureMeshObservation,
  FixtureObservation,
  GradientFixture,
} from './fixture-types'

export interface SceneProbe {
  scene: Scene
  renderer: WebGLRenderer
  dom: HTMLElement
  camera(): Camera
  invalidate(): void
  frames: number
  width: number
  height: number
  bufferWidth: number
  bufferHeight: number
  dpr: number
  initialCameraUuid: string
  initialEnvironmentUuid: string | null
  initialRendererIdentity: number
}
export interface FixtureController {
  api: GradientFixture
  counters: FixtureObservation['counters']
  identity(value: object): number
  notify(): void
  frameEligible(channel: 'main' | 'external'): boolean
  attach(channel: 'main' | 'external', probe: SceneProbe): () => void
  setIntersection(value: boolean): void
  setReducedMotion(value: boolean): void
  setFallback(value: CanvasFallbackState['status'] | null): void
  cameraUpdate(update: CameraUpdate): void
  error(error: GradientError): void
  hostError(cause: unknown): void
  dispose(): void
}
interface FixtureBindings {
  wrapper(): HTMLElement | undefined
  config(): FixtureCanvasConfig
  mounted(): boolean
  external(): FixtureExternalConfig
  update(patch: GradientSettingsInput): void
  configure(patch: FixtureCanvasConfig): void
  setMounted(value: boolean): void
  setIndependentMounted(value: boolean): void
  setVisible(value: boolean): void
  setExternal(value: FixtureExternalConfig): void
}

export function createFixture(bindings: FixtureBindings): FixtureController {
  const identities = new WeakMap<object, number>()
  let nextIdentity = 0
  function identity(value: object): number {
    let id = identities.get(value)
    if (id === undefined) {
      id = ++nextIdentity
      identities.set(value, id)
    }
    return id
  }
  const counters: FixtureObservation['counters'] = {
    completedFrames: 0,
    rendererCalls: 0,
    copyCalls: null,
    geometryDisposals: 0,
    materialDisposals: 0,
    textureDisposals: 0,
    passDisposals: null,
    targetDisposals: null,
    rendererDisposals: 0,
    contextLosses: 0,
  }
  const probes: Partial<Record<'main' | 'external', SceneProbe>> = {}
  // Consumer-only diagnostics expose actual public Three objects. The package
  // itself has no debug context or global lifecycle/source registry.
  const lifecycle = {
    refs: () => ({
      native: probes.main ?? null,
      host: probes.external ?? null,
    }),
    classes: { Texture, BufferGeometry, Material },
  }
  type LifecycleWindow = Window & { gradientLifecycle?: typeof lifecycle }
  function exposeLifecycle() {
    if (
      typeof window !== 'undefined' &&
      (import.meta.env.DEV || import.meta.env.VITE_GRADIENT_FIXTURE === '1')
    )
      (window as LifecycleWindow).gradientLifecycle = lifecycle
  }
  const notifications = new Set<() => void>()
  let revision = 0
  let intersection = false
  let reducedMotion = false
  let fallback: CanvasFallbackState['status'] | null = 'deferred'
  let hostFailed = false
  const cameraUpdates: CameraUpdate[] = []
  const errors: { code: string; message: string }[] = []
  let alive = true
  function notify() {
    for (const listener of notifications) listener()
  }
  function meshes(scene: Scene): FixtureMeshObservation[] {
    const result: FixtureMeshObservation[] = []
    scene.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        object.name !== 'shadergradient-mesh' ||
        !(object.material instanceof MeshPhysicalMaterial)
      )
        return
      const material = object.material
      const uniforms = material.userData
      // Read the actual material's public compilation key and actual uniform container.
      const [shader, type] = material.customProgramCacheKey().split(':') as [
        ShaderName,
        GradientType
      ]
      const scalar = (name: string) => Number(uniforms[name]?.value)
      result.push({
        uuid: object.uuid,
        geometryUuid: object.geometry.uuid,
        materialUuid: material.uuid,
        geometryType: object.geometry.type,
        materialType: material.type,
        shader,
        type,
        position: [object.position.x, object.position.y, object.position.z],
        rotationRadians: [
          object.rotation.x,
          object.rotation.y,
          object.rotation.z,
        ],
        wireframe: material.wireframe,
        roughness: material.roughness,
        time: scalar('uTime'),
        loop: scalar('uLoop'),
        loopDuration: scalar('uLoopDuration'),
        colors: [
          [scalar('uC1r'), scalar('uC1g'), scalar('uC1b')],
          [scalar('uC2r'), scalar('uC2g'), scalar('uC2b')],
          [scalar('uC3r'), scalar('uC3g'), scalar('uC3b')],
        ],
        uniformsIdentity: identity(uniforms),
      })
    })
    return result
  }
  function snapshot(): FixtureObservation {
    const main = probes.main
    const host = probes.external
    const camera = main?.camera()
    const canvas = main?.renderer.domElement
    const rect = canvas?.getBoundingClientRect()
    let axesVisible = false
    main?.scene.traverse((object) => {
      if (object.type === 'AxesHelper' && object.visible) axesVisible = true
    })
    return {
      revision,
      mounted: !!bindings.wrapper()?.querySelector('[data-gradient-main]'),
      visible: intersection,
      reducedMotion,
      fallback,
      canvas:
        main && canvas && rect
          ? {
              identity: identity(canvas),
              rendererIdentity: identity(main.renderer),
              cssWidth: rect.width,
              cssHeight: rect.height,
              bufferWidth: canvas.width,
              bufferHeight: canvas.height,
              dpr: main.renderer.getPixelRatio(),
              contextLost: main.renderer.getContext().isContextLost(),
            }
          : null,
      scene:
        main && camera
          ? {
              uuid: main.scene.uuid,
              cameraUuid: camera.uuid,
              environmentUuid: main.scene.environment?.uuid ?? null,
              camera: {
                fov: camera instanceof PerspectiveCamera ? camera.fov : null,
                zoom: 'zoom' in camera ? Number(camera.zoom) : 1,
                position: [
                  camera.position.x,
                  camera.position.y,
                  camera.position.z,
                ],
              },
              meshes: meshes(main.scene),
              axesVisible,
            }
          : null,
      externalHost: host
        ? {
            sceneUuid: host.scene.uuid,
            cameraUuid: host.camera().uuid,
            environmentUuid: host.scene.environment?.uuid ?? null,
            initialCameraUuid: host.initialCameraUuid,
            initialEnvironmentUuid: host.initialEnvironmentUuid,
            rendererIdentity: identity(host.renderer),
            initialRendererIdentity: host.initialRendererIdentity,
            gradientMeshCount: meshes(host.scene).length,
          }
        : null,
      cameraUpdates: cameraUpdates.map((update) => ({ ...update })),
      errors: errors.map((error) => ({ ...error })),
      counters: { ...counters },
    }
  }
  // Subscribe before mutating; ticks synchronize effects but never certify output.
  async function operation(
    channel: 'main' | 'external',
    mutate: () => void,
    visibility?: boolean
  ): Promise<FixtureObservation> {
    revision += 1
    const previous = probes[channel]
    const previousFrames = previous?.frames ?? 0
    let synchronized = false
    let requested: SceneProbe | undefined
    const { promise, resolve, reject } =
      Promise.withResolvers<FixtureObservation>()
    const timer = setTimeout(() => {
      finish()
      reject(
        new Error(
          `gradientFixture revision ${revision}: no completed ${channel} output within 10000ms; ${JSON.stringify(
            snapshot()
          )}`
        )
      )
    }, 10_000)
    function finish() {
      clearTimeout(timer)
      notifications.delete(inspect)
    }
    function inspect() {
      if (!synchronized) return
      const probe = probes[channel]
      if (!alive) {
        finish()
        resolve(snapshot())
        return
      }
      if (visibility !== undefined && intersection !== visibility) return
      if (channel === 'external' && !bindings.external().enabled) {
        if (!probe) {
          finish()
          resolve(snapshot())
        }
        return
      }
      if (
        channel === 'external' &&
        (hostFailed || probe?.renderer.getContext().isContextLost())
      ) {
        finish()
        resolve(snapshot())
        return
      }
      if (channel === 'main') {
        if (!bindings.mounted()) {
          if (!probe) {
            finish()
            resolve(snapshot())
          }
          return
        }
        if (
          fallback === 'unsupported' ||
          fallback === 'error' ||
          probe?.renderer.getContext().isContextLost()
        ) {
          finish()
          resolve(snapshot())
          return
        }
        if (!intersection && bindings.config().lazyLoad !== false) {
          if (!probe && fallback === 'deferred') {
            finish()
            resolve(snapshot())
          }
          return
        }
      }
      if (!probe) return
      if (requested !== probe) {
        requested = probe
        probe.invalidate()
        return
      }
      if (probe === previous && probe.frames <= previousFrames) return
      if (probe !== previous && probe.frames === 0) return
      const rect = probe.dom.getBoundingClientRect()
      const dpr = probe.renderer.getPixelRatio()
      // DPR changes can complete one OLD-size frame before ResizeObserver settles.
      if (
        Math.abs(probe.width - rect.width) > 0.01 ||
        Math.abs(probe.height - rect.height) > 0.01 ||
        probe.dpr !== dpr ||
        probe.bufferWidth !== Math.max(1, Math.floor(rect.width * dpr)) ||
        probe.bufferHeight !== Math.max(1, Math.floor(rect.height * dpr))
      )
        return
      if (channel === 'main') {
        const config = bindings.config()
        const expectedDpr =
          Number.isFinite(config.pixelDensity) && config.pixelDensity! > 0
            ? config.pixelDensity!
            : 1
        const expectedFov =
          Number.isFinite(config.fov) && config.fov! > 0 && config.fov! < 180
            ? config.fov!
            : 45
        const camera = probe.camera()
        if (
          dpr !== expectedDpr ||
          (camera instanceof PerspectiveCamera && camera.fov !== expectedFov)
        )
          return
      }
      finish()
      resolve(snapshot())
    }
    notifications.add(inspect)
    try {
      mutate()
      await tick()
      await tick()
      synchronized = true
      inspect()
    } catch (cause) {
      finish()
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
    return promise
  }
  const api: GradientFixture = {
    version: 1,
    update: (patch) => operation('main', () => bindings.update(patch)),
    configureCanvas: (patch) =>
      operation('main', () => bindings.configure(patch)),
    snapshot,
    lifecycle: {
      setMounted: (value) =>
        operation('main', () => bindings.setMounted(value)),
      setIndependentMounted: async (value) => {
        bindings.setIndependentMounted(value)
        await tick()
      },
      setVisible: (value) =>
        operation('main', () => bindings.setVisible(value), value),
      requestFrame: () => operation('main', () => {}),
    },
    externalHost: {
      configure: (config) =>
        operation('external', () =>
          bindings.setExternal({
            enabled: config.enabled,
            gradients: config.gradients.map((gradient) => ({ ...gradient })),
          })
        ),
      clear: () =>
        operation('external', () =>
          bindings.setExternal({ enabled: true, gradients: [] })
        ),
    },
  }
  return {
    api,
    identity,
    counters,
    notify,
    frameEligible(channel: 'main' | 'external') {
      return channel === 'external'
        ? !hostFailed
        : fallback !== 'unsupported' && fallback !== 'error'
    },
    attach(channel: 'main' | 'external', probe: SceneProbe) {
      probes[channel] = probe
      if (channel === 'external') hostFailed = false
      exposeLifecycle()
      notify()
      return () => {
        if (probes[channel] === probe) delete probes[channel]
        notify()
      }
    },
    setIntersection(value: boolean) {
      intersection = value
      notify()
    },
    setReducedMotion(value: boolean) {
      reducedMotion = value
      notify()
    },
    setFallback(value: CanvasFallbackState['status'] | null) {
      if (fallback !== value) {
        fallback = value
        notify()
      }
    },
    cameraUpdate(update: CameraUpdate) {
      cameraUpdates.push({ ...update })
    },
    error(error: GradientError) {
      errors.push({ code: error.code, message: error.message })
      if (error.code === 'unsupported-webgl') fallback = 'unsupported'
      else if (error.code === 'renderer' || error.code === 'context-lost')
        fallback = 'error'
      notify()
    },
    hostError(cause: unknown) {
      hostFailed = true
      errors.push({
        code: 'renderer',
        message: `External host: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      })
      notify()
    },
    dispose() {
      alive = false
      notify()
      notifications.clear()
      if (typeof window !== 'undefined') {
        const target = window as LifecycleWindow
        if (target.gradientLifecycle === lifecycle)
          delete target.gradientLifecycle
      }
    },
  }
}
