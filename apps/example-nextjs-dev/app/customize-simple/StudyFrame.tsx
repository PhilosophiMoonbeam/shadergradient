'use client'

import {
  Component,
  Suspense,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from 'react'
import { ShaderGradient } from '@shadergradient/react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh, PerspectiveCamera } from 'three'
import '../../../demo-studio.css'
import './study.css'

// SDK materials are rebuilt on a scene-prop render; lens-only edits must not
// re-render the gradient and replace its paused material.
export const StudyGradient = memo(ShaderGradient)

export class StudyBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <div className='studio-error study-failure' role='alert'>
        <h3>Preview unavailable</h3>
        <p>{this.state.error}</p>
        <p>
          The controls remain available. Check graphics support and network
          access, then reload to try again.
        </p>
      </div>
    ) : (
      this.props.children
    )
  }
}

export function useStudyMotion() {
  const [playing, setPlaying] = useState(false)
  const [reduced, setReduced] = useState(false)
  const overridden = useRef(false)
  const materialTime = useRef(0)
  const [pausedTime, setPausedTime] = useState(0)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setReduced(preference.matches)
      if (!overridden.current) {
        setPausedTime(materialTime.current)
        setPlaying(!preference.matches)
      }
    }
    sync()
    preference.addEventListener('change', sync)
    return () => preference.removeEventListener('change', sync)
  }, [])
  return {
    playing,
    reduced,
    materialTime,
    pausedTime,
    toggle: () => {
      overridden.current = true
      setPausedTime(materialTime.current)
      setPlaying((value) => !value)
    },
  }
}

export function RendererControls({
  playing,
  fov = 45,
  density = 1,
  report,
  materialTime,
}: {
  playing: boolean
  fov?: number
  density?: number
  report: (message: string) => void
  materialTime: MutableRefObject<number>
}) {
  const { camera, gl, scene, get, setDpr, setFrameloop, invalidate } =
    useThree()
  const gradient = useRef<Mesh | null>(null)
  const observed = useRef(false)
  const requestedObservationFrame = useRef(false)
  const failed = useRef(false)
  const cameraMatrices = useRef<Float64Array | null>(null)
  if (cameraMatrices.current === null)
    cameraMatrices.current = new Float64Array(32)
  const settledFrames = useRef(0)
  // SDK Canvas configuration may restore its default lens, DPR and frame mode
  // on an outer React commit. Reassert the selected settings against actual
  // Fiber state each commit, guarding writes to avoid store-notification loops.
  useEffect(() => {
    const current = get()
    const perspective = current.camera as PerspectiveCamera
    if (perspective.isPerspectiveCamera && perspective.fov !== fov) {
      perspective.fov = fov
      perspective.updateProjectionMatrix()
    }
    if (current.viewport.dpr !== density) setDpr(density)
    const mode = playing ? 'always' : 'demand'
    if (current.frameloop !== mode) setFrameloop(mode)
    settledFrames.current = 0
    invalidate()
  })
  useEffect(() => {
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
  }, [gl, invalidate])
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => {
      event.preventDefault()
      failed.current = true
      report('Graphics context lost. Reload to restore this preview.')
    }
    const previous = gl.debug.onShaderError
    gl.debug.onShaderError = (...args) => {
      failed.current = true
      report(
        'Shader compilation failed. Check the browser console for graphics diagnostics.'
      )
      previous?.(...args)
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      gl.debug.onShaderError = previous
    }
  }, [gl, report])
  useFrame(() => {
    if (!playing) {
      // Camera-controls updates inside Fiber. Keep that same scheduler awake
      // until both the view and projection have stopped moving for two frames.
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
    if (!gradient.current)
      gradient.current = scene.getObjectByName(
        'shadergradient-mesh'
      ) as Mesh | null
    const material = gradient.current?.material
    if (material && !Array.isArray(material)) {
      const time = material.userData.uTime?.value
      if (typeof time === 'number' && Number.isFinite(time))
        materialTime.current = time
    }
    if (!failed.current && !observed.current && gl.info.render.calls > 0) {
      observed.current = true
      report('Scene draw observed')
    }
    if (!observed.current && !requestedObservationFrame.current) {
      requestedObservationFrame.current = true
      invalidate()
    }
  })
  return null
}

export function StudyPreview({
  children,
  label,
  status,
}: {
  children: ReactNode
  label: string
  status: string
}) {
  const error = /failed|lost/i.test(status)
  return (
    <section className='studio-panel' aria-label={label}>
      <header className='studio-panel-header'>
        <div>
          <span className='studio-eyebrow'>Live WebGL study</span>
          <h2>{label}</h2>
        </div>
        <span
          className={`study-status${error ? ' studio-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {status}
        </span>
      </header>
      <div className='studio-preview study-preview'>
        <StudyBoundary>
          <Suspense
            fallback={
              <div className='study-loading' role='status'>
                Loading scene and lighting…
              </div>
            }
          >
            {children}
          </Suspense>
        </StudyBoundary>
      </div>
      <div className='studio-panel-footer'>
        Rendered with the public React SDK · Camera and pixel-density edits keep
        the same scene instance.
      </div>
    </section>
  )
}

export function StudyShell({
  title,
  eyebrow,
  description,
  active,
  children,
}: {
  title: string
  eyebrow: string
  description: string
  active: 'canvas' | 'time'
  children: ReactNode
}) {
  return (
    <main className='demo-studio study-root'>
      <div className='studio-shell'>
        <header className='studio-header'>
          <a href='/' className='studio-brand'>
            Shadergradient / Studies
          </a>
          <span className='studio-badge'>Next.js · React</span>
          <nav className='studio-row' aria-label='Study navigation'>
            <a href='/'>Glass Studio</a>
            <a
              href='/customize-simple'
              aria-current={active === 'canvas' ? 'page' : undefined}
            >
              Canvas Study
            </a>
            <a
              href='/loop'
              aria-current={active === 'time' ? 'page' : undefined}
            >
              Time Study
            </a>
          </nav>
        </header>
        <section className='studio-intro'>
          <p className='studio-eyebrow'>{eyebrow}</p>
          <h1>{title}</h1>
          <p className='studio-lede'>{description}</p>
        </section>
        {children}
        <footer className='studio-footer'>
          A small change, a visible difference. These studies expose renderer
          and shader controls—not synthetic performance scores.
        </footer>
      </div>
    </main>
  )
}

export function StudyRange({
  id,
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
  disabled = false,
  unit = '',
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
  unit?: string
}) {
  return (
    <div className='studio-field'>
      <label htmlFor={id}>
        {label}{' '}
        <output htmlFor={id}>
          {value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}
          {unit}
        </output>
      </label>
      <input
        id={id}
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
