import { tick } from 'svelte'
import {
  BufferGeometry,
  Material,
  Mesh,
  PerspectiveCamera,
  Vector2,
  Texture,
  type Camera,
  type MeshPhysicalMaterial,
  type Scene,
  type WebGLRenderer,
} from 'three'
import type {
  CameraUpdate,
  GradientError,
  GradientType,
  ShaderName,
} from '@shadergradient/svelte'
import type {
  FixtureMeshObservation,
  FixtureObservation,
} from './fixture-types'

export interface SceneProbe {
  scene: Scene
  renderer: WebGLRenderer
  camera(): Camera
  invalidate(): void
  frames: number
  frameWidth: number
  frameHeight: number
  initialCameraUuid: string
  initialEnvironmentUuid: string | null
}

export interface FixtureObserver {
  counters: FixtureObservation['counters']
  identity(object: object): number
  connect(probe: SceneProbe, kind: 'native' | 'host'): () => void
  complete(probe: SceneProbe): void
  snapshot(): FixtureObservation
  operation(
    change: () => void,
    target?: 'native' | 'host',
    teardown?: boolean,
    expectedVisible?: boolean
  ): Promise<FixtureObservation>
  error(error: GradientError, target?: 'native' | 'host'): void
  observeVisibility(
    element: HTMLElement,
    options: IntersectionObserverInit
  ): () => void
  cameraUpdate(update: CameraUpdate): void
  notify(): void
  dispose(): void
}

export function createFixtureObserver(read: {
  mounted(): boolean
  wrapper(): HTMLElement | undefined
  respectReducedMotion(): boolean
  lazyLoad(): boolean
  density(): number
  fov(): number
}): FixtureObserver {
  let revision = 0
  let disposed = false
  let native: SceneProbe | undefined
  let host: SceneProbe | undefined
  // These are the consumer's real public Three refs, not package-private state.
  const lifecycle = {
    refs: () => ({ native: native ?? null, host: host ?? null }),
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
  let visible = false
  let media: MediaQueryList | undefined
  let currentError: GradientError | undefined
  let currentErrorTarget: 'native' | 'host' = 'native'
  const cameraUpdates: CameraUpdate[] = []
  const errors: { code: string; message: string }[] = []
  const listeners = new Set<() => void>()
  const identities = new WeakMap<object, number>()
  let nextIdentity = 1
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
  const size = new Vector2()
  function identity(object: object): number {
    let value = identities.get(object)
    if (!value) {
      value = nextIdentity++
      identities.set(object, value)
    }
    return value
  }
  function notify() {
    for (const listener of listeners) listener()
  }
  function error(error: GradientError, target: 'native' | 'host' = 'native') {
    currentError = error
    currentErrorTarget = target
    errors.push({ code: error.code, message: error.message })
    void tick().then(notify)
  }
  function meshObservation(mesh: Mesh): FixtureMeshObservation {
    const material = mesh.material as MeshPhysicalMaterial
    const uniforms = material.userData as Record<string, { value: number }>
    const variant = material.customProgramCacheKey().split(':')
    const scalar = (name: string) => Number(uniforms[name]?.value)
    return {
      uuid: mesh.uuid,
      geometryUuid: mesh.geometry.uuid,
      materialUuid: material.uuid,
      geometryType: mesh.geometry.type,
      materialType: material.type,
      shader: variant[0] as ShaderName,
      type: variant[1] as GradientType,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotationRadians: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
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
    }
  }
  function meshes(scene: Scene): FixtureMeshObservation[] {
    const result: FixtureMeshObservation[] = []
    scene.traverse((object) => {
      if (object instanceof Mesh && object.name === 'shadergradient-mesh')
        result.push(meshObservation(object))
    })
    return result
  }
  function fallback(): FixtureObservation['fallback'] {
    return (
      (read.wrapper()?.querySelector<HTMLElement>('[data-native-fallback]')
        ?.dataset.nativeFallback as FixtureObservation['fallback']) ?? null
    )
  }
  function snapshot(): FixtureObservation {
    const probe = native
    let canvas: FixtureObservation['canvas'] = null
    let scene: FixtureObservation['scene'] = null
    if (probe) {
      const renderer = probe.renderer
      const element = renderer.domElement
      const rect = element.getBoundingClientRect()
      const camera = probe.camera()
      let axesVisible = false
      probe.scene.traverse((object) => {
        if (object.type === 'AxesHelper' && object.visible) axesVisible = true
      })
      canvas = {
        identity: identity(element),
        rendererIdentity: identity(renderer),
        cssWidth: rect.width,
        cssHeight: rect.height,
        bufferWidth: element.width,
        bufferHeight: element.height,
        dpr: renderer.getPixelRatio(),
        contextLost: renderer.getContext().isContextLost(),
      }
      scene = {
        uuid: probe.scene.uuid,
        cameraUuid: camera.uuid,
        environmentUuid: probe.scene.environment?.uuid ?? null,
        camera: {
          fov: camera instanceof PerspectiveCamera ? camera.fov : null,
          zoom: 'zoom' in camera ? Number(camera.zoom) : 1,
          position: [camera.position.x, camera.position.y, camera.position.z],
        },
        meshes: meshes(probe.scene),
        axesVisible,
      }
    }
    return {
      revision,
      mounted: read.mounted(),
      visible,
      reducedMotion: read.respectReducedMotion() && (media?.matches ?? false),
      fallback: fallback(),
      canvas,
      scene,
      externalHost: host
        ? {
            sceneUuid: host.scene.uuid,
            cameraUuid: host.camera().uuid,
            environmentUuid: host.scene.environment?.uuid ?? null,
            initialCameraUuid: host.initialCameraUuid,
            initialEnvironmentUuid: host.initialEnvironmentUuid,
            rendererIdentity: identity(host.renderer),
            initialRendererIdentity: identity(host.renderer),
            gradientMeshCount: meshes(host.scene).length,
          }
        : null,
      cameraUpdates: cameraUpdates.slice(),
      errors: errors.slice(),
      counters: { ...counters },
    }
  }
  function finalSize(probe: SceneProbe): boolean {
    const element = probe.renderer.domElement
    const rect = element.getBoundingClientRect()
    probe.renderer.getSize(size)
    const dpr = probe.renderer.getPixelRatio()
    const expected =
      probe === native
        ? read.wrapper()?.getBoundingClientRect()
        : element.parentElement?.getBoundingClientRect()
    if (
      expected &&
      (Math.abs(rect.width - expected.width) >= 1 ||
        Math.abs(rect.height - expected.height) >= 1)
    )
      return false
    if (
      probe === native &&
      (dpr !== read.density() ||
        (probe.camera() instanceof PerspectiveCamera &&
          (probe.camera() as PerspectiveCamera).fov !== read.fov()))
    )
      return false
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(size.x - rect.width) < 1 &&
      Math.abs(size.y - rect.height) < 1 &&
      Math.abs(probe.frameWidth - rect.width) < 1 &&
      Math.abs(probe.frameHeight - rect.height) < 1 &&
      element.width === Math.max(1, Math.floor(size.x * dpr)) &&
      element.height === Math.max(1, Math.floor(size.y * dpr))
    )
  }
  async function operation(
    change: () => void,
    target: 'native' | 'host' = 'native',
    teardown = false,
    expectedVisible?: boolean
  ): Promise<FixtureObservation> {
    revision++
    const before = target === 'native' ? native : host
    const beforeFrames = before?.frames ?? 0
    let synchronized = false
    let ended = false
    const { promise, resolve, reject } =
      Promise.withResolvers<FixtureObservation>()
    const inspect = () => {
      if (!synchronized || ended) return
      const probe = target === 'native' ? native : host
      const status = fallback()
      if (
        !disposed &&
        expectedVisible !== undefined &&
        visible !== expectedVisible
      )
        return
      const terminal =
        (!!currentError && currentErrorTarget === target) ||
        (target === 'native' &&
          ((!read.mounted() && !probe) ||
            (!visible && read.lazyLoad() && status === 'deferred' && !probe) ||
            status === 'unsupported' ||
            status === 'error'))
      if (
        disposed ||
        (teardown && !probe) ||
        terminal ||
        (probe &&
          (probe !== before || probe.frames > beforeFrames) &&
          finalSize(probe))
      ) {
        ended = true
        resolve(snapshot())
      }
    }
    listeners.add(inspect)
    const timeout = window.setTimeout(() => {
      ended = true
      reject(
        new Error(
          `gradientFixture revision ${revision}: no completed ${target} frame with final CSS/buffer dimensions within 10000ms; fallback=${fallback()}, mounted=${read.mounted()}, visible=${visible}`
        )
      )
    }, 10000)
    try {
      change()
      await tick()
      // Child teardown and the framework's deferred resource disposal complete first.
      await Promise.resolve()
      synchronized = true
      inspect()
      // Explicit redraw is intentionally fixture-only; spontaneous native invalidations remain observable via snapshot.
      if (!ended) (target === 'native' ? native : host)?.invalidate()
      return await promise
    } finally {
      clearTimeout(timeout)
      listeners.delete(inspect)
    }
  }
  function connect(probe: SceneProbe, kind: 'native' | 'host') {
    if (kind === 'native') native = probe
    else host = probe
    exposeLifecycle()
    notify()
    return () => {
      if (kind === 'native' && native === probe) native = undefined
      if (kind === 'host' && host === probe) host = undefined
      void tick().then(notify)
    }
  }
  function complete(probe: SceneProbe) {
    probe.frames++
    counters.completedFrames++
    probe.renderer.getSize(size)
    probe.frameWidth = size.x
    probe.frameHeight = size.y
    if (
      (probe === native && currentErrorTarget === 'native') ||
      (probe === host && currentErrorTarget === 'host')
    )
      currentError = undefined
    notify()
  }
  function observeVisibility(
    element: HTMLElement,
    options: IntersectionObserverInit
  ) {
    const motion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : undefined
    media = motion
    const changed = () => notify()
    motion?.addEventListener('change', changed)
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            for (const entry of entries)
              if (entry.target === element) {
                visible =
                  entry.isIntersecting &&
                  entry.boundingClientRect.width > 0 &&
                  entry.boundingClientRect.height > 0
                void tick().then(notify)
              }
          }, options)
    if (observer) observer.observe(element)
    else {
      const rect = element.getBoundingClientRect()
      visible = rect.width > 0 && rect.height > 0
    }
    return () => {
      observer?.disconnect()
      motion?.removeEventListener('change', changed)
    }
  }
  return {
    counters,
    identity,
    connect,
    complete,
    snapshot,
    operation,
    error,
    observeVisibility,
    cameraUpdate(update: CameraUpdate) {
      cameraUpdates.push(update)
    },
    notify,
    dispose() {
      disposed = true
      void tick().then(notify)
      if (typeof window !== 'undefined') {
        const target = window as LifecycleWindow
        if (target.gradientLifecycle === lifecycle)
          delete target.gradientLifecycle
      }
    },
  }
}
