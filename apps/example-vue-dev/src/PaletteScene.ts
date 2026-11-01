import { useTresContext } from '@tresjs/core'
import { defineComponent, onScopeDispose, watch, type PropType } from 'vue'
import {
  BoxGeometry,
  Group,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  Spherical,
  type WebGLRenderer,
  type Texture,
} from 'three'
import type { ShaderGradientProps } from '@shadergradient/vue'

export interface PaletteSceneApi {
  snapshotCamera(): Partial<ShaderGradientProps> | undefined
}

/** App-owned scene context and lifecycle observation; never replaces the SDK material. */
export default defineComponent({
  name: 'PaletteScene',
  props: {
    settings: { type: Object as PropType<ShaderGradientProps>, required: true },
    paused: Boolean,
    hdrFailed: Boolean,
  },
  emits: {
    rendered: (_environment: boolean) => true,
    failure: (_message: string) => true,
    active: () => true,
    inactive: () => true,
    cameraUpdate: (_camera: Partial<ShaderGradientProps>) => true,
  },
  setup(props, { emit, expose }) {
    const { scene, camera, renderer, sizes } = useTresContext()
    const spherical = new Spherical()
    const cameraPosition = new Vector3()
    const api: PaletteSceneApi = {
      snapshotCamera() {
        const activeCamera = camera.activeCamera.value
        if (!activeCamera) return undefined
        activeCamera.getWorldPosition(cameraPosition)
        spherical.setFromVector3(cameraPosition)
        return {
          cAzimuthAngle: MathUtils.radToDeg(spherical.theta),
          cPolarAngle: MathUtils.radToDeg(spherical.phi),
          ...(props.settings.type === 'sphere'
            ? { cameraZoom: activeCamera.zoom }
            : { cDistance: spherical.radius }),
        }
      },
    }
    expose(api)
    emit('active')
    const gl = renderer.instance as WebGLRenderer
    const backing = new Group()
    backing.name = 'palette-studio-opaque-context'
    const geometry = new BoxGeometry(1, 1, 1)
    const materials: MeshBasicMaterial[] = []
    function block(
      color: string,
      x: number,
      y: number,
      z: number,
      width: number,
      height: number
    ) {
      const material = new MeshBasicMaterial({ color })
      materials.push(material)
      const mesh = new Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.scale.set(width, height, 0.08)
      backing.add(mesh)
    }
    block('#e9e4da', 0, 0, -0.2, 32, 24)
    for (let index = -16; index <= 16; index++) {
      block(
        index % 2 === 0 ? '#273a36' : '#70887c',
        index * 0.6,
        0,
        0,
        0.18,
        24
      )
    }
    block('#e36846', -1.5, 0.2, 0.2, 1.1, 2.1)
    block('#e7b951', 1.4, -0.5, 0.3, 1.3, 1.1)
    block('#324f9b', 0.2, 1.5, 0.1, 1.4, 0.5)
    scene.value.add(backing)
    const offset = new Vector3()
    function positionBacking() {
      const activeCamera = camera.activeCamera.value
      if (!activeCamera) return
      activeCamera.getWorldDirection(offset)
      // Place real opaque objects behind the origin, facing the actual SDK camera.
      backing.position.copy(offset).multiplyScalar(3.5)
      backing.quaternion.copy(activeCamera.quaternion)
      backing.visible = props.settings.shader === 'glass'
    }
    const positionSubscription = renderer.loop.onBeforeLoop(positionBacking)
    let lastEnvironment: boolean | undefined
    let hasRendered = false
    let lastTexture: Texture | null = null
    let previousRequestTexture: Texture | null = null
    let settledFrames = 0
    const cameraMatrix = new Matrix4()
    const projectionMatrix = new Matrix4()
    const activePointers = new Set<number>()
    function wake() {
      settledFrames = 0
      renderer.loop.start()
    }
    function pointerDown(event: PointerEvent) {
      activePointers.add(event.pointerId)
      wake()
    }
    function pointerFinished(event: PointerEvent) {
      if (activePointers.delete(event.pointerId)) wake()
    }
    function blur() {
      activePointers.clear()
      wake()
    }
    gl.domElement.addEventListener('pointerdown', pointerDown)
    gl.domElement.addEventListener('wheel', wake, { passive: true })
    window.addEventListener('pointerup', pointerFinished)
    window.addEventListener('pointercancel', pointerFinished)
    window.addEventListener('blur', blur)
    watch(
      [() => props.settings.lightType, () => props.settings.envPreset],
      () => {
        // Only a new texture can qualify the latest HDR request. A previously
        // rendered environment is not proof that the replacement has loaded.
        previousRequestTexture = lastTexture
        lastEnvironment = undefined
        wake()
      },
      { flush: 'sync' }
    )
    const renderSubscription = renderer.onRender(() => {
      const texture = scene.value.environment
      const environment = texture !== null && texture !== previousRequestTexture
      lastTexture = texture
      const activeCamera = camera.activeCamera.value
      if (activeCamera) {
        const stable =
          cameraMatrix.equals(activeCamera.matrixWorld) &&
          projectionMatrix.equals(activeCamera.projectionMatrix)
        settledFrames =
          stable && activePointers.size === 0 ? settledFrames + 1 : 0
        cameraMatrix.copy(activeCamera.matrixWorld)
        projectionMatrix.copy(activeCamera.projectionMatrix)
      }
      if (!hasRendered || environment !== lastEnvironment) {
        hasRendered = true
        lastEnvironment = environment
        emit('rendered', environment)
      }
      if (
        props.paused &&
        settledFrames >= 2 &&
        (props.settings.lightType !== 'env' || environment || props.hdrFailed)
      ) {
        renderer.loop.stop()
        // The paused loop can settle before CameraControls emits its rest event.
        // Publish the actual final pose once at this existing idle boundary.
        const pose = api.snapshotCamera()
        if (pose) emit('cameraUpdate', pose)
      }
    })
    const errorSubscription = renderer.onError((error) =>
      emit('failure', error.message)
    )
    const previousShaderError = gl.debug.onShaderError
    gl.debug.onShaderError = (context, program, vertex, fragment) => {
      previousShaderError?.(context, program, vertex, fragment)
      console.error('Palette Studio shader compilation failed', {
        program: context.getProgramInfoLog(program),
        vertex: context.getShaderInfoLog(vertex),
        fragment: context.getShaderInfoLog(fragment),
      })
      emit(
        'failure',
        `The shader could not compile. ${
          context.getProgramInfoLog(program) ||
          'See the browser console for GPU details.'
        }`
      )
    }
    function lost(event: Event) {
      event.preventDefault()
      renderer.loop.stop()
      emit(
        'failure',
        'The WebGL context was lost. Restore GPU availability, then reload the preview.'
      )
    }
    gl.domElement.addEventListener('webglcontextlost', lost)
    watch(
      [
        () => props.settings,
        () => props.paused,
        () => props.hdrFailed,
        sizes.width,
        sizes.height,
      ],
      () => {
        lastEnvironment = undefined
        positionBacking()
        wake()
      },
      { deep: true, flush: 'post', immediate: true }
    )
    onScopeDispose(() => {
      emit('inactive')
      positionSubscription.off()
      renderSubscription.off()
      errorSubscription.off()
      gl.debug.onShaderError = previousShaderError
      gl.domElement.removeEventListener('webglcontextlost', lost)
      gl.domElement.removeEventListener('pointerdown', pointerDown)
      gl.domElement.removeEventListener('wheel', wake)
      window.removeEventListener('pointerup', pointerFinished)
      window.removeEventListener('pointercancel', pointerFinished)
      window.removeEventListener('blur', blur)
      backing.removeFromParent()
      geometry.dispose()
      for (const material of materials) material.dispose()
    })
    return () => null
  },
})
