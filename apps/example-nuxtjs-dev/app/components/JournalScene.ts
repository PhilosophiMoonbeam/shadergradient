import { useTresContext } from '@tresjs/core'
import type { ShaderGradientProps } from '@shadergradient/vue'
import {
  BoxGeometry,
  Color,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Spherical,
  Vector3,
} from 'three'
import type { WebGLRenderer } from 'three'
import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onScopeDispose,
  watch,
} from 'vue'
import type { PropType } from 'vue'

export type JournalSettings = {
  -readonly [Key in keyof ShaderGradientProps]: ShaderGradientProps[Key]
} & {
  fov?: number
  pixelDensity?: number
}

export type JournalSceneHandle = {
  readCamera: () => Partial<JournalSettings> | undefined
}

export type JournalSceneSnapshot = {
  camera?: Partial<JournalSettings>
  time?: number
}

/** Scene-owned glass context and lifecycle observation; the SDK owns its material. */
export default defineComponent({
  name: 'JournalScene',
  props: {
    settings: { type: Object as PropType<JournalSettings>, required: true },
    paused: { type: Boolean, required: true },
    failed: { type: Boolean, default: false },
  },
  emits: {
    frame: (_environmentReady: boolean) => true,
    failure: (_message: string) => true,
    restored: () => true,
    initializing: () => true,
    suspended: (_snapshot: JournalSceneSnapshot) => true,
  },
  setup(props, { emit, expose }) {
    const context = useTresContext()
    const renderer = context.renderer.instance as WebGLRenderer
    const group = new Group()
    group.name = 'journal-opaque-glass-context'
    const backGeometry = new PlaneGeometry(40, 40)
    const barGeometry = new BoxGeometry(0.32, 18, 0.12)
    const backMaterial = new MeshBasicMaterial({ color: '#e7ddce' })
    const darkMaterial = new MeshBasicMaterial({ color: '#182b38' })
    const coralMaterial = new MeshBasicMaterial({ color: '#de7759' })
    const backdrop = new Mesh(backGeometry, backMaterial)
    group.add(backdrop)
    for (let index = -5; index <= 5; index++) {
      const bar = new Mesh(
        barGeometry,
        index % 3 === 0 ? coralMaterial : darkMaterial
      )
      bar.position.set(index * 1.25, 0, 0.1)
      bar.rotation.z = -0.28
      group.add(bar)
    }
    const previousBackground = context.scene.value.background
    const background = new Color('#111b24')
    const direction = new Vector3()
    const origin = new Vector3()
    const previousCameraWorld = new Matrix4()
    const previousProjection = new Matrix4()
    const cameraPosition = new Vector3()
    const cameraSpherical = new Spherical()
    const sceneCamera = context.camera.activeCamera.value
    let gradientMesh: Mesh | undefined
    const readCamera = (): Partial<JournalSettings> | undefined => {
      const camera = context.camera.activeCamera.value ?? sceneCamera
      if (!(camera instanceof PerspectiveCamera)) return
      camera.getWorldPosition(cameraPosition)
      cameraSpherical.setFromVector3(cameraPosition)
      return {
        cAzimuthAngle: MathUtils.radToDeg(cameraSpherical.theta),
        cPolarAngle: MathUtils.radToDeg(cameraSpherical.phi),
        ...(props.settings.type === 'sphere'
          ? { cameraZoom: camera.zoom }
          : { cDistance: cameraSpherical.radius }),
      }
    }
    const readShaderTime = (): number | undefined => {
      const material = gradientMesh?.material
      if (!material || Array.isArray(material)) return
      const uniform: unknown = material.userData.uTime
      if (
        typeof uniform === 'object' &&
        uniform !== null &&
        'value' in uniform &&
        typeof uniform.value === 'number' &&
        Number.isFinite(uniform.value)
      )
        return uniform.value
    }
    expose({ readCamera } satisfies JournalSceneHandle)
    onMounted(() => emit('initializing'))
    let disposed = false
    let frameReported = false
    let environmentReported = false
    let contextLost = false
    let interacting = false
    let stableCameraFrames = 0
    let supersededEnvironment = context.scene.value.environment

    // Wake only Tres's existing loop; paused edits also allow camera damping to settle.
    const invalidate = () => {
      stableCameraFrames = 0
      void nextTick(() => {
        if (!disposed && !contextLost) context.renderer.loop.start()
      })
    }
    watch(
      () => props.settings,
      () => {
        frameReported = false
        environmentReported = false
        group.visible = props.settings.shader === 'glass'
        context.scene.value.background = group.visible
          ? background
          : previousBackground
        invalidate()
      },
      { deep: true, immediate: true, flush: 'post' }
    )
    watch(() => [props.paused, props.failed], invalidate, { flush: 'post' })
    watch([context.sizes.width, context.sizes.height], invalidate, {
      flush: 'post',
    })
    watch(
      () => [props.settings.lightType, props.settings.envPreset] as const,
      (selection, previous) => {
        if (
          previous &&
          selection[0] === previous[0] &&
          selection[1] === previous[1]
        )
          return
        // A non-null texture from the previous selection is not the requested HDR.
        supersededEnvironment = context.scene.value.environment
        frameReported = false
        environmentReported = false
        invalidate()
      },
      { immediate: true, flush: 'sync' }
    )
    const pointerStart = () => {
      interacting = true
      invalidate()
    }
    const pointerEnd = () => {
      if (!interacting) return
      interacting = false
      invalidate()
    }
    renderer.domElement.addEventListener('pointerdown', pointerStart)
    renderer.domElement.addEventListener('wheel', invalidate, { passive: true })
    window.addEventListener('pointerup', pointerEnd)
    window.addEventListener('pointercancel', pointerEnd)
    window.addEventListener('blur', pointerEnd)

    // The backing is real opaque geometry, kept behind the gradient relative to the camera.
    const beforeFrame = context.renderer.loop.onBeforeLoop(() => {
      if (!group.visible) return
      const camera = context.camera.activeCamera.value
      if (!camera) return
      origin.set(
        props.settings.positionX ?? 0,
        props.settings.positionY ?? 0,
        props.settings.positionZ ?? 0
      )
      camera.getWorldDirection(direction)
      group.position.copy(origin).addScaledVector(direction, 3)
      group.quaternion.copy(camera.quaternion)
    })
    const rendered = context.renderer.onRender(() => {
      if (contextLost) return
      const mesh = context.scene.value.getObjectByName('shadergradient-mesh')
      if (!(mesh instanceof Mesh)) return
      gradientMesh = mesh
      const environment = context.scene.value.environment
      const environmentReady =
        props.settings.lightType !== 'env' ||
        (environment !== null && environment !== supersededEnvironment)
      if (!frameReported || environmentReady !== environmentReported) {
        frameReported = true
        environmentReported = environmentReady
        emit('frame', environmentReady)
      }
      if (props.paused) {
        const camera = context.camera.activeCamera.value
        if (camera) {
          let moved = false
          // Matrix4 elements always contain exactly 16 entries.
          for (let index = 0; index < 16; index++) {
            if (
              Math.abs(
                camera.matrixWorld.elements[index]! -
                  previousCameraWorld.elements[index]!
              ) > 0.000001 ||
              Math.abs(
                camera.projectionMatrix.elements[index]! -
                  previousProjection.elements[index]!
              ) > 0.000001
            ) {
              moved = true
              break
            }
          }
          stableCameraFrames = moved ? 0 : stableCameraFrames + 1
          previousCameraWorld.copy(camera.matrixWorld)
          previousProjection.copy(camera.projectionMatrix)
        }
        if (
          !interacting &&
          stableCameraFrames >= 2 &&
          (environmentReady || props.failed)
        )
          context.renderer.loop.stop()
      }
    })
    const rendererError = context.renderer.onError((error) => {
      emit(
        'failure',
        `The WebGL renderer could not initialize: ${error.message}`
      )
    })
    const previousShaderError = renderer.debug.onShaderError
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      previousShaderError?.(gl, program, vertex, fragment)
      console.error(
        'Scene Journal shader error:',
        gl.getProgramInfoLog(program)
      )
      emit(
        'failure',
        'The selected shader could not compile on this graphics device. Try another shader or reload the scene.'
      )
    }
    const lost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      context.renderer.loop.stop()
      emit(
        'failure',
        'The WebGL context was lost. Reload the scene to create a fresh renderer.'
      )
    }
    const restored = () => {
      contextLost = false
      emit('restored')
      invalidate()
    }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    renderer.domElement.addEventListener('webglcontextrestored', restored)
    onScopeDispose(() => {
      emit('suspended', { camera: readCamera(), time: readShaderTime() })
      disposed = true
      beforeFrame.off()
      rendered.off()
      rendererError.off()
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('webglcontextrestored', restored)
      renderer.domElement.removeEventListener('pointerdown', pointerStart)
      renderer.domElement.removeEventListener('wheel', invalidate)
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerEnd)
      window.removeEventListener('blur', pointerEnd)
      renderer.debug.onShaderError = previousShaderError
      if (context.scene.value.background === background)
        context.scene.value.background = previousBackground
      backGeometry.dispose()
      barGeometry.dispose()
      backMaterial.dispose()
      darkMaterial.dispose()
      coralMaterial.dispose()
    })
    return () => h('primitive', { object: group, dispose: null })
  },
})
