'use client'

import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ACESFilmicToneMapping,
  InstancedMesh,
  Object3D,
  SRGBColorSpace,
} from 'three'
import styles from './page.module.css'

type Geometry = 'sphere' | 'plane' | 'waterPlane'
type Backdrop = 'lines' | 'checker' | 'plain'
type SceneStatus = 'loading' | 'ready' | 'error'
type CameraView = {
  cAzimuthAngle: number
  cPolarAngle: number
  cDistance: number
  cameraZoom: number
}

// Distance and zoom are normalized to the responsive framing factor below.
const homeCameraView: CameraView = {
  cAzimuthAngle: 0,
  cPolarAngle: 90,
  cDistance: 4.7,
  cameraZoom: 4.2,
}

const geometries: { value: Geometry; label: string; description: string }[] = [
  {
    value: 'sphere',
    label: 'Sphere',
    description:
      'A closed volume. Look for the scene bending through its center and reflections along its edge.',
  },
  {
    value: 'plane',
    label: 'Plane',
    description:
      'An open glass sheet, not a solid lens. Its gentle folds interrupt the straight lines behind it.',
  },
  {
    value: 'waterPlane',
    label: 'Water',
    description:
      'An open rippled sheet. Small surface waves bend the backdrop; this is not a closed body of water.',
  },
]
const tints = [
  { label: 'Clear', colors: ['#f0f5f2', '#e1ede8', '#f6f8f3'] },
  { label: 'Glacier', colors: ['#c7e9ed', '#afd8e4', '#e2f3f0'] },
  { label: 'Rose', colors: ['#f1d4df', '#e6bed1', '#f9e7e7'] },
  { label: 'Amber', colors: ['#f7e4bd', '#edcd97', '#fff1d7'] },
] as const
const backdropOptions: { value: Backdrop; label: string }[] = [
  { value: 'lines', label: 'Lines' },
  { value: 'checker', label: 'Checker' },
  { value: 'plain', label: 'Plain' },
]
const gridOffsets = Array.from({ length: 41 }, (_, index) => (index - 20) * 0.4)
const checkerCount = 288

class SceneBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('Glass Studio could not initialize its scene.', error)
    this.props.onError(
      'The 3D scene or its HDR environment could not load. Check your connection and WebGL support, then reload to try again.'
    )
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

// This observes the SDK's renderer; it does not create a second render loop.
function SceneHealth({
  onReady,
  onError,
}: {
  onReady: () => void
  onError: (message: string) => void
}) {
  const gl = useThree((state) => state.gl)
  const reported = useRef(false)
  const failed = useRef(false)

  useLayoutEffect(() => {
    const oldColorSpace = gl.outputColorSpace
    const oldToneMapping = gl.toneMapping
    const oldExposure = gl.toneMappingExposure
    const oldShaderError = gl.debug.onShaderError
    gl.outputColorSpace = SRGBColorSpace
    gl.toneMapping = ACESFilmicToneMapping
    gl.toneMappingExposure = 1
    gl.debug.onShaderError = (context, program, vertex, fragment) => {
      failed.current = true
      console.error('Glass Studio shader compilation failed.', {
        program: context.getProgramInfoLog(program),
        vertex: context.getShaderInfoLog(vertex),
        fragment: context.getShaderInfoLog(fragment),
      })
      onError(
        'The glass shader could not compile on this graphics device. The scene is unavailable; no fallback material is being shown.'
      )
      oldShaderError?.(context, program, vertex, fragment)
    }
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      failed.current = true
      onError(
        'The WebGL graphics context was lost. Reload to restore the studio.'
      )
    }
    gl.domElement.addEventListener('webglcontextlost', handleContextLost)
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', handleContextLost)
      gl.debug.onShaderError = oldShaderError
      gl.outputColorSpace = oldColorSpace
      gl.toneMapping = oldToneMapping
      gl.toneMappingExposure = oldExposure
    }
  }, [gl, onError])

  useFrame(({ scene }) => {
    if (
      !reported.current &&
      !failed.current &&
      scene.environment &&
      scene.getObjectByName('shadergradient-mesh') &&
      gl.info.render.frame > 2 &&
      !gl.getContext().isContextLost()
    ) {
      reported.current = true
      onReady()
    }
  })
  return null
}

function Checkerboard({ visible }: { visible: boolean }) {
  const mesh = useRef<InstancedMesh>(null)
  const tile = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => {
    if (!mesh.current) return
    let index = 0
    for (let row = 0; row < 24; row++) {
      for (let column = 0; column < 24; column++) {
        if ((row + column) % 2 !== 0) continue
        tile.position.set((column - 11.5) * 0.6, (row - 11.5) * 0.6, -2.59)
        tile.updateMatrix()
        mesh.current.setMatrixAt(index++, tile.matrix)
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [tile])
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, checkerCount]}
      visible={visible}
    >
      <planeGeometry args={[0.6, 0.6]} />
      <meshBasicMaterial color='#61796b' toneMapped={false} />
    </instancedMesh>
  )
}

// All contrast objects are opaque renderer geometry, included in the physical
// material's transmission pass. A CSS backdrop cannot supply refracted detail.
function StudioBackdrop({ pattern }: { pattern: Backdrop }) {
  return (
    <>
      <color attach='background' args={['#dce4d8']} />
      <group>
        <mesh position={[0, 0, -2.6]}>
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial color='#dce4d8' toneMapped={false} />
        </mesh>
        <group visible={pattern === 'lines'}>
          {gridOffsets.map((offset, index) => (
            <group key={index}>
              <mesh position={[offset, 0, -2.58]}>
                <planeGeometry args={[0.018, 16]} />
                <meshBasicMaterial color='#6d8473' toneMapped={false} />
              </mesh>
              <mesh position={[0, offset, -2.57]}>
                <planeGeometry args={[16, 0.018]} />
                <meshBasicMaterial color='#6d8473' toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
        <Checkerboard visible={pattern === 'checker'} />
        <mesh position={[-0.72, 0.18, -1.7]} rotation={[0, 0, -0.22]}>
          <boxGeometry args={[0.44, 2.5, 0.16]} />
          <meshBasicMaterial color='#f16838' toneMapped={false} />
        </mesh>
        <mesh position={[0.72, -0.15, -1.9]} rotation={[0, 0, 0.17]}>
          <boxGeometry args={[0.55, 2.8, 0.16]} />
          <meshBasicMaterial color='#1e342d' toneMapped={false} />
        </mesh>
        <mesh position={[0.1, -0.7, -1.55]}>
          <boxGeometry args={[2.8, 0.2, 0.12]} />
          <meshBasicMaterial color='#fff9dc' toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

function GlassSubject({
  geometry,
  tint,
  roughness,
  deformation,
  paused,
  revision,
  viewRevision,
  showGlass,
}: {
  geometry: Geometry
  tint: number
  roughness: number
  deformation: number
  paused: boolean
  revision: number
  viewRevision: number
  showGlass: boolean
}) {
  const aspect = useThree(
    (state) => state.size.width / Math.max(state.size.height, 1)
  )
  const fit = Math.min(1, aspect / 1.15)
  const colors = tints[tint].colors
  const isSphere = geometry === 'sphere'
  const [cameraView, setCameraView] = useState(homeCameraView)

  useEffect(() => {
    setCameraView(homeCameraView)
  }, [geometry, revision, viewRevision])

  // The SDK reports user and programmatic camera rests. Keep the public props
  // in sync so resetting them changes the real pose without remounting glass.
  // Equal reports retain the same state, preventing a rest/prop feedback loop.
  const trackCamera = useCallback(
    (updates: Partial<CameraView>) => {
      setCameraView((current) => {
        const next: CameraView = {
          cAzimuthAngle: updates.cAzimuthAngle ?? current.cAzimuthAngle,
          cPolarAngle: updates.cPolarAngle ?? current.cPolarAngle,
          cDistance:
            updates.cDistance === undefined
              ? current.cDistance
              : updates.cDistance * fit,
          cameraZoom:
            updates.cameraZoom === undefined
              ? current.cameraZoom
              : updates.cameraZoom / fit,
        }
        return next.cAzimuthAngle === current.cAzimuthAngle &&
          next.cPolarAngle === current.cPolarAngle &&
          next.cDistance === current.cDistance &&
          next.cameraZoom === current.cameraZoom
          ? current
          : next
      })
    },
    [fit]
  )
  return (
    <group scale={isSphere ? 1 : 0.24} visible={showGlass}>
      <ShaderGradient
        key={revision}
        control='props'
        shader='glass'
        type={geometry}
        cAzimuthAngle={cameraView.cAzimuthAngle}
        cPolarAngle={cameraView.cPolarAngle}
        cDistance={cameraView.cDistance / fit}
        cameraZoom={cameraView.cameraZoom * fit}
        onCameraUpdate={trackCamera}
        enableTransition={false}
        positionX={0}
        positionY={0}
        positionZ={0}
        rotationX={isSphere ? 0 : 8}
        rotationY={isSphere ? 0 : -16}
        rotationZ={isSphere ? 0 : -7}
        color1={colors[0]}
        color2={colors[1]}
        color3={colors[2]}
        reflection={1 - roughness}
        uStrength={deformation}
        uDensity={1.5}
        uFrequency={3}
        uAmplitude={0.08}
        uSpeed={0.16}
        uTime={0}
        animate={paused ? 'off' : 'on'}
        lightType='env'
        envPreset='city'
        brightness={1}
        grain='off'
        zoomOut={false}
      />
    </group>
  )
}

export default function Home() {
  const [geometry, setGeometry] = useState<Geometry>('sphere')
  const [tint, setTint] = useState(0)
  const [roughness, setRoughness] = useState(0.08)
  const [deformation, setDeformation] = useState(0.18)
  const [backdrop, setBackdrop] = useState<Backdrop>('lines')
  const [showGlass, setShowGlass] = useState(true)
  const [paused, setPaused] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [revision, setRevision] = useState(0)
  const [viewRevision, setViewRevision] = useState(0)
  const [status, setStatus] = useState<SceneStatus>('loading')
  const [error, setError] = useState('')
  const [slowLoading, setSlowLoading] = useState(false)
  const markReady = useCallback(
    () => setStatus((current) => (current === 'error' ? current : 'ready')),
    []
  )
  const markError = useCallback((message: string) => {
    setError(message)
    setStatus('error')
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      setReducedMotion(preference.matches)
      setPaused(preference.matches)
    }
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (status !== 'loading') return
    const timer = window.setTimeout(() => setSlowLoading(true), 8000)
    return () => window.clearTimeout(timer)
  }, [status])

  function reset() {
    setGeometry('sphere')
    setTint(0)
    setRoughness(0.08)
    setDeformation(0.18)
    setBackdrop('lines')
    setShowGlass(true)
    setPaused(reducedMotion)
    setRevision((value) => value + 1)
    setViewRevision((value) => value + 1)
  }

  const selectedGeometry = geometries.find((item) => item.value === geometry)!

  return (
    <main className={styles.studio}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a className={styles.brand} href='/' aria-label='Glass Studio home'>
            <span className={styles.brandMark} aria-hidden='true'>
              G
            </span>
            <span>
              ShaderGradient <span className={styles.brandDivider}>/</span>{' '}
              <strong>Glass Studio</strong>
            </span>
          </a>
          <span className={styles.headerNote}>
            An interactive material study
          </span>
        </header>

        <section className={styles.intro} aria-labelledby='studio-title'>
          <div>
            <p className={styles.eyebrow}>TRANSMISSION / REFLECTION / FORM</p>
            <h1 id='studio-title'>
              Glass Studio.
              <br />
              <span>Reflection &amp; refraction.</span>
            </h1>
          </div>
          <p className={styles.introCopy}>
            Explore glass in real time. Change the surface, then watch what
            happens to the world behind it.
          </p>
        </section>

        <div className={styles.workspace}>
          <section
            className={styles.viewportPanel}
            aria-label='Interactive glass scene'
          >
            <div className={styles.viewportToolbar}>
              <span className={styles.sceneLabel}>
                01 <span>/</span> {selectedGeometry.label} study
              </span>
              <span
                className={styles.status}
                data-status={status}
                role='status'
              >
                <span className={styles.statusDot} />
                {status === 'ready'
                  ? showGlass
                    ? 'City HDR loaded'
                    : 'Backdrop only'
                  : status === 'error'
                  ? 'Scene unavailable'
                  : 'Loading scene & HDR'}
              </span>
            </div>
            <div className={styles.viewport}>
              {status !== 'error' && (
                <SceneBoundary onError={markError}>
                  <ShaderGradientCanvas
                    pixelDensity={1.5}
                    fov={45}
                    lazyLoad={false}
                  >
                    <SceneHealth onReady={markReady} onError={markError} />
                    <StudioBackdrop pattern={backdrop} />
                    <Suspense fallback={null}>
                      <GlassSubject
                        geometry={geometry}
                        tint={tint}
                        roughness={roughness}
                        deformation={deformation}
                        paused={paused}
                        revision={revision}
                        viewRevision={viewRevision}
                        showGlass={showGlass}
                      />
                    </Suspense>
                  </ShaderGradientCanvas>
                </SceneBoundary>
              )}
              {status !== 'ready' && (
                <div
                  className={styles.sceneOverlay}
                  role={status === 'error' ? 'alert' : 'status'}
                >
                  <span className={styles.overlaySymbol} aria-hidden='true'>
                    {status === 'error' ? '!' : 'G'}
                  </span>
                  <h2>
                    {status === 'error'
                      ? 'The studio could not render.'
                      : 'Preparing the glass study.'}
                  </h2>
                  <p>
                    {status === 'error'
                      ? error
                      : slowLoading
                      ? 'Still loading the real HDR environment. This needs a working network connection and WebGL 2; no preview is being substituted.'
                      : 'Starting WebGL and loading the city HDR environment. The scene will appear when both are ready.'}
                  </p>
                  {status === 'error' && (
                    <button
                      className={styles.reloadButton}
                      onClick={() => window.location.reload()}
                    >
                      Reload studio
                    </button>
                  )}
                </div>
              )}
              <div className={styles.viewportCaption} aria-hidden='true'>
                <span>
                  GLASS /{' '}
                  {String(
                    geometries.findIndex((item) => item.value === geometry) + 1
                  ).padStart(2, '0')}
                </span>
                <span>
                  {!showGlass
                    ? 'Backdrop comparison'
                    : paused
                    ? 'Motion paused'
                    : 'Live deformation'}
                </span>
              </div>
            </div>
            <div className={styles.sceneFooter}>
              <p>
                <span className={styles.crosshair} aria-hidden='true'>
                  +
                </span>{' '}
                Drag to orbit <span className={styles.footerDivider}>·</span>{' '}
                Scroll to zoom
              </p>
              <button
                onClick={() => setViewRevision((value) => value + 1)}
                disabled={status !== 'ready'}
              >
                Reset view <span aria-hidden='true'>↗</span>
              </button>
            </div>
          </section>

          <aside className={styles.controls} aria-labelledby='material-title'>
            <div className={styles.controlsHeading}>
              <div>
                <p className={styles.eyebrow}>THE MATERIAL</p>
                <h2 id='material-title'>Make it your own.</h2>
              </div>
              <span className={styles.settingsIcon} aria-hidden='true'>
                ≡
              </span>
            </div>
            <fieldset
              className={styles.controlFieldset}
              disabled={status === 'error'}
            >
              <legend className={styles.srOnly}>
                Glass material and scene controls
              </legend>
              <div className={styles.controlGroup}>
                <p className={styles.controlLabel} id='geometry-label'>
                  Geometry
                </p>
                <div
                  className={styles.segmented}
                  role='group'
                  aria-labelledby='geometry-label'
                >
                  {geometries.map((item) => (
                    <button
                      key={item.value}
                      aria-pressed={geometry === item.value}
                      onClick={() => setGeometry(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.controlGroup}>
                <p className={styles.controlLabel} id='tint-label'>
                  Glass tint <span>{tints[tint].label}</span>
                </p>
                <div
                  className={styles.swatches}
                  role='group'
                  aria-labelledby='tint-label'
                >
                  {tints.map((item, index) => (
                    <button
                      key={item.label}
                      className={styles.swatch}
                      aria-label={`${item.label} tint`}
                      aria-pressed={tint === index}
                      onClick={() => setTint(index)}
                      style={{ backgroundColor: item.colors[1] }}
                    >
                      <span aria-hidden='true'>
                        {tint === index ? '✓' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.controlGroup}>
                <label className={styles.controlLabel} htmlFor='roughness'>
                  Roughness{' '}
                  <output htmlFor='roughness'>{roughness.toFixed(2)}</output>
                </label>
                <input
                  id='roughness'
                  className={styles.range}
                  type='range'
                  min='0'
                  max='0.65'
                  step='0.01'
                  value={roughness}
                  onChange={(event) => setRoughness(Number(event.target.value))}
                />
                <div className={styles.rangeLabels}>
                  <span>Polished</span>
                  <span>Frosted</span>
                </div>
              </div>

              <div className={styles.controlGroup}>
                <label className={styles.controlLabel} htmlFor='deformation'>
                  Deformation{' '}
                  <output htmlFor='deformation'>
                    {deformation.toFixed(2)}
                  </output>
                </label>
                <input
                  id='deformation'
                  className={styles.range}
                  type='range'
                  min='0'
                  max='0.45'
                  step='0.01'
                  value={deformation}
                  onChange={(event) =>
                    setDeformation(Number(event.target.value))
                  }
                />
                <div className={styles.rangeLabels}>
                  <span>Still</span>
                  <span>Organic</span>
                </div>
              </div>

              <div className={styles.controlGroup}>
                <p className={styles.controlLabel} id='backdrop-label'>
                  Backdrop
                </p>
                <div
                  className={styles.segmented}
                  role='group'
                  aria-labelledby='backdrop-label'
                >
                  {backdropOptions.map((item) => (
                    <button
                      key={item.value}
                      aria-pressed={backdrop === item.value}
                      onClick={() => setBackdrop(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={styles.comparisonToggle}>
                <input
                  type='checkbox'
                  checked={showGlass}
                  disabled={status !== 'ready'}
                  onChange={(event) => setShowGlass(event.target.checked)}
                />
                <span>
                  Show glass <small>Compare with the unobstructed scene</small>
                </span>
              </label>

              <div className={styles.actions}>
                <button
                  className={styles.motionButton}
                  aria-pressed={!paused}
                  onClick={() => setPaused((value) => !value)}
                >
                  <span aria-hidden='true'>{paused ? '▷' : 'Ⅱ'}</span>{' '}
                  {paused ? 'Resume motion' : 'Pause motion'}
                </button>
                <button className={styles.resetButton} onClick={reset}>
                  Reset all
                </button>
              </div>
            </fieldset>
            <p className={styles.controlNote}>
              {status === 'error'
                ? 'The 3D scene is unavailable.'
                : status === 'loading'
                ? 'Waiting for city HDR lighting.'
                : showGlass
                ? 'City HDR lighting · physical transmission.'
                : 'Backdrop-only comparison. Glass is hidden, not removed.'}
              <br />
              {reducedMotion
                ? 'Motion starts paused to respect your preference.'
                : 'One scene. Real-time material response.'}
            </p>
          </aside>
        </div>

        <section
          className={styles.observation}
          aria-labelledby='observation-title'
        >
          <div>
            <p className={styles.eyebrow}>LOOK A LITTLE CLOSER</p>
            <h2 id='observation-title'>The backdrop tells the story.</h2>
          </div>
          <p>
            {selectedGeometry.description} Try the checker backdrop for
            refraction, or raise roughness to soften reflections.
          </p>
          <span className={styles.materialTag}>
            @shadergradient/react <span>shader='glass'</span>
          </span>
        </section>
        <footer className={styles.footer}>
          <span>Glass Studio</span>
          <span>Built with ShaderGradient · WebGL</span>
        </footer>
      </div>
    </main>
  )
}
