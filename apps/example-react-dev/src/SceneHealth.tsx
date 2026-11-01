import React, {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, Mesh, SRGBColorSpace } from 'three'

export type ShaderPhaseReader = () => number | undefined

export class SceneBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Color Studio scene initialization failed.', error)
    this.props.onError(
      'The WebGL scene or its HDR assets could not initialize. Check WebGL 2 support and your connection, then reload the studio.'
    )
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

// Observes the SDK-owned renderer and uses Fiber's own loop, never a second RAF.
export function SceneHealth({
  glass,
  needsEnvironment,
  revision,
  paused,
  ready,
  onReady,
  onError,
  phaseReader,
}: {
  glass: boolean
  needsEnvironment: boolean
  revision: number
  paused: boolean
  ready: boolean
  onReady: () => void
  onError: (message: string) => void
  phaseReader: MutableRefObject<ShaderPhaseReader | null>
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const setFrameloop = useThree((state) => state.setFrameloop)
  const frameloop = useThree((state) => state.frameloop)
  const invalidate = useThree((state) => state.invalidate)
  const reported = useRef(false)
  const failed = useRef(false)
  const firstFrame = useRef(0)
  const cameraMatrices = useRef<Float64Array | null>(null)
  if (cameraMatrices.current === null)
    cameraMatrices.current = new Float64Array(32)
  const settledFrames = useRef(0)

  useLayoutEffect(() => {
    // Read at the interaction boundary, not from a second clock or stale frame
    // sample. The SDK writes its rendered shader time to this Three uniform.
    const readPhase: ShaderPhaseReader = () => {
      const mesh = scene.getObjectByName('shadergradient-mesh')
      if (!(mesh instanceof Mesh) || Array.isArray(mesh.material)) return
      const time: unknown = mesh.material.userData.uTime?.value
      return typeof time === 'number' && Number.isFinite(time)
        ? time
        : undefined
    }
    phaseReader.current = readPhase
    return () => {
      if (phaseReader.current === readPhase) phaseReader.current = null
    }
  }, [scene, phaseReader])

  useLayoutEffect(() => {
    reported.current = false
    firstFrame.current = gl.info.render.frame
    invalidate()
  }, [gl, revision, invalidate])

  useLayoutEffect(() => {
    const oldShaderError = gl.debug.onShaderError
    gl.debug.onShaderError = (context, program, vertex, fragment) => {
      failed.current = true
      console.error('Color Studio shader compilation failed.', {
        program: context.getProgramInfoLog(program),
        vertex: context.getShaderInfoLog(vertex),
        fragment: context.getShaderInfoLog(fragment),
      })
      onError(
        'This shader could not compile on your graphics device. No substitute material is being displayed.'
      )
      oldShaderError?.(context, program, vertex, fragment)
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      failed.current = true
      onError(
        'The WebGL graphics context was lost. Reload the studio to create a new context.'
      )
    }
    gl.domElement.addEventListener('webglcontextlost', contextLost)
    return () => {
      gl.debug.onShaderError = oldShaderError
      gl.domElement.removeEventListener('webglcontextlost', contextLost)
    }
  }, [gl, onError])

  useLayoutEffect(() => {
    if (!glass) return
    const colorSpace = gl.outputColorSpace
    const toneMapping = gl.toneMapping
    const exposure = gl.toneMappingExposure
    gl.outputColorSpace = SRGBColorSpace
    gl.toneMapping = ACESFilmicToneMapping
    gl.toneMappingExposure = 1
    invalidate()
    return () => {
      gl.outputColorSpace = colorSpace
      gl.toneMapping = toneMapping
      gl.toneMappingExposure = exposure
    }
  }, [gl, glass, invalidate])

  useEffect(() => {
    // Canvas can reconfigure this Fiber root after an app/camera commit and
    // restore its default loop. Observe that actual mode and reassert policy
    // on every scene commit, not only when paused/ready themselves change.
    const desiredLoop = paused && ready ? 'demand' : 'always'
    if (frameloop !== desiredLoop) setFrameloop(desiredLoop)
    // Prop edits can start camera damping while shader time remains paused.
    settledFrames.current = 0
    invalidate()
  })

  useLayoutEffect(() => {
    if (!paused || !ready) return
    const canvas = gl.domElement
    let dragging = false
    const wake = () => {
      settledFrames.current = 0
      invalidate()
    }
    const down = () => {
      dragging = true
      wake()
    }
    const move = () => {
      if (dragging) wake()
    }
    const up = () => {
      if (dragging) {
        dragging = false
        wake()
      }
    }
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('wheel', wake, { passive: true, capture: true })
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('wheel', wake, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [gl, paused, ready, invalidate])

  useFrame(({ scene }) => {
    if (paused && ready) {
      // Camera-controls updates inside this same Fiber loop. Follow both view
      // and projection until two unchanged frames, then return to idle demand.
      camera.updateMatrixWorld()
      const cached = cameraMatrices.current!
      const world = camera.matrixWorld.elements
      const projection = camera.projectionMatrix.elements
      let moved = false
      for (let index = 0; index < 16; index++) {
        if (
          Math.abs(cached[index] - world[index]) > 1e-8 ||
          Math.abs(cached[index + 16] - projection[index]) > 1e-8
        )
          moved = true
        cached[index] = world[index]
        cached[index + 16] = projection[index]
      }
      settledFrames.current = moved ? 0 : settledFrames.current + 1
      if (settledFrames.current < 2) invalidate()
    }
    if (
      !reported.current &&
      !failed.current &&
      (!needsEnvironment || scene.environment !== null) &&
      scene.getObjectByName('shadergradient-mesh') &&
      gl.info.render.frame > firstFrame.current + 2 &&
      !gl.getContext().isContextLost()
    ) {
      reported.current = true
      onReady()
    }
  })
  return null
}
