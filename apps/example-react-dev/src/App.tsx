import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  ShaderGradient,
  ShaderGradientCanvas,
  presets,
  type GradientT,
  type ShaderGradientType,
} from '@shadergradient/react'
import {
  SceneBoundary,
  SceneHealth,
  type ShaderPhaseReader,
} from './SceneHealth'

type Settings = typeof presets.halo.props
type PresetName = keyof typeof presets
type ShaderName = Settings['shader']
type Status = 'initializing' | 'loading' | 'ready' | 'error'

const presetEntries = Object.entries(presets) as [
  PresetName,
  (typeof presets)[PresetName]
][]
const shaders: { value: ShaderName; label: string; description: string }[] = [
  {
    value: 'defaults',
    label: 'Classic gradient',
    description:
      'Soft color fields shaped by layered noise. Try a warm and cool palette together.',
  },
  {
    value: 'positionMix',
    label: 'Position mix',
    description:
      'Color follows the surface position. Rotate the form to reveal how its coordinates shape the blend.',
  },
  {
    value: 'cosmic',
    label: 'Cosmic',
    description:
      'High-contrast, flowing detail. Slow the motion to inspect the structure of the color field.',
  },
  {
    value: 'glass',
    label: 'Glass study',
    description:
      'Real physical transmission with a city HDR and opaque scene objects behind the surface, not a CSS imitation.',
  },
]
const shapes: { value: ShaderGradientType; label: string }[] = [
  { value: 'plane', label: 'Plane' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'waterPlane', label: 'Water plane' },
]
const palettes = [
  { name: 'Ember', colors: ['#ff5005', '#dbba95', '#d0bce1'] },
  { name: 'Lagoon', colors: ['#0c8d91', '#a1edbd', '#496edb'] },
  { name: 'Orchid', colors: ['#8d42d1', '#ffabbc', '#4740a8'] },
  { name: 'Clear glass', colors: ['#f0f5f2', '#e1ede8', '#f6f8f3'] },
] as const
const colorKeys = ['color1', 'color2', 'color3'] as const
const stripes = Array.from({ length: 17 }, (_, index) => (index - 8) * 0.45)

// Ordinary opaque Fiber scene objects: the SDK alone owns the glass material.
// Fiber disposes these declaratively created geometries and materials on unmount.
function GlassBackdrop() {
  return (
    <>
      <color attach='background' args={['#dce4d8']} />
      <mesh position={[0, 0, -2.6]}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color='#dce4d8' toneMapped={false} />
      </mesh>
      {stripes.map((x) => (
        <mesh key={x} position={[x, 0, -2.58]}>
          <planeGeometry args={[0.024, 16]} />
          <meshBasicMaterial color='#698073' toneMapped={false} />
        </mesh>
      ))}
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
    </>
  )
}

// Status updates must not recreate the SDK's scalar-gradient material.
const Subject = memo(function Subject({
  settings,
  paused,
  resetRevision,
  onCameraUpdate,
}: {
  settings: Settings
  paused: boolean
  resetRevision: number
  onCameraUpdate: (updates: Partial<GradientT>) => void
}) {
  return (
    <group
      scale={
        settings.shader === 'glass' && settings.type !== 'sphere' ? 0.24 : 1
      }
    >
      <ShaderGradient
        key={resetRevision}
        {...settings}
        control='props'
        animate={paused ? 'off' : 'on'}
        enableTransition={false}
        smoothTime={0}
        zoomOut={false}
        onCameraUpdate={onCameraUpdate}
      />
    </group>
  )
})

export default function App() {
  const [preset, setPreset] = useState<PresetName>('halo')
  const [settings, setSettings] = useState<Settings>(() => ({
    ...presets.halo.props,
  }))
  const [customized, setCustomized] = useState(false)
  // Safe first paint: no animation begins before the browser preference is read.
  const [paused, setPaused] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [motionKnown, setMotionKnown] = useState(false)
  const [status, setStatus] = useState<Status>('initializing')
  const [error, setError] = useState('')
  const [slowLoading, setSlowLoading] = useState(false)
  const [sceneRevision, setSceneRevision] = useState(0)
  const [resetRevision, setResetRevision] = useState(0)
  const phaseReader = useRef<ShaderPhaseReader | null>(null)
  const markReady = useCallback(() => {
    setStatus((current) => (current === 'error' ? current : 'ready'))
  }, [])
  const markError = useCallback((message: string) => {
    setError(message)
    setStatus('error')
  }, [])
  const trackCamera = useCallback(
    (updates: Partial<GradientT>) => {
      const next = {
        ...settings,
        uTime: paused
          ? phaseReader.current?.() ?? settings.uTime
          : settings.uTime,
        cAzimuthAngle:
          updates.cAzimuthAngle === undefined
            ? settings.cAzimuthAngle
            : ((updates.cAzimuthAngle % 360) + 360) % 360,
        cPolarAngle: updates.cPolarAngle ?? settings.cPolarAngle,
        cDistance: updates.cDistance ?? settings.cDistance,
        cameraZoom: updates.cameraZoom ?? settings.cameraZoom,
      }
      if (
        next.cAzimuthAngle !== settings.cAzimuthAngle ||
        next.cPolarAngle !== settings.cPolarAngle ||
        next.cDistance !== settings.cDistance ||
        next.cameraZoom !== settings.cameraZoom
      ) {
        setSettings(next)
        setCustomized(true)
      }
    },
    [settings, paused]
  )

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      const phase = phaseReader.current?.()
      setSettings((current) => ({
        ...current,
        uTime: preference.matches ? phase ?? current.uTime : 0,
      }))
      setReducedMotion(preference.matches)
      setPaused(preference.matches)
    }
    update()
    setMotionKnown(true)
    setStatus('loading')
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (status !== 'loading' && status !== 'initializing') return
    setSlowLoading(false)
    const timer = window.setTimeout(() => setSlowLoading(true), 8000)
    return () => window.clearTimeout(timer)
  }, [status, sceneRevision])

  function updateSettings(patch: Partial<Settings>) {
    const phase = paused ? phaseReader.current?.() : undefined
    setSettings((current) => ({
      ...current,
      uTime: phase ?? current.uTime,
      ...patch,
    }))
    setCustomized(true)
  }

  function toggleMotion() {
    const phase = paused ? 0 : phaseReader.current?.()
    setSettings((current) => ({ ...current, uTime: phase ?? current.uTime }))
    setPaused(!paused)
  }

  function loadScene() {
    setSceneRevision((value) => value + 1)
    setStatus('loading')
  }

  function applyPreset(name: PresetName) {
    setPreset(name)
    // Apply the complete Core record, not a palette-only approximation.
    setSettings({ ...presets[name].props })
    setCustomized(false)
    setPaused(reducedMotion || presets[name].props.animate === 'off')
    setResetRevision((value) => value + 1)
    loadScene()
  }

  function chooseVariant(shader: ShaderName, type: ShaderGradientType) {
    const glass = shader === 'glass'
    const leavingGlass = settings.shader === 'glass' && !glass
    const shapeChanged = settings.type !== type
    const base = leavingGlass ? presets[preset].props : settings
    const framing: Partial<Settings> =
      shapeChanged || leavingGlass || glass
        ? {
            type,
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            rotationX: glass && type !== 'sphere' ? 8 : 0,
            rotationY: glass && type !== 'sphere' ? -16 : 0,
            rotationZ: glass && type !== 'sphere' ? -7 : 0,
            cAzimuthAngle: glass ? 0 : 180,
            cPolarAngle: 90,
            cDistance: glass ? 4.7 : 3.6,
            cameraZoom: glass ? 4.2 : 4.5,
          }
        : {}
    setSettings({
      ...base,
      ...framing,
      uTime: paused ? phaseReader.current?.() ?? settings.uTime : base.uTime,
      shader,
      type,
      ...(glass
        ? {
            color1: '#f0f5f2',
            color2: '#e1ede8',
            color3: '#f6f8f3',
            lightType: 'env' as const,
            envPreset: 'city' as const,
            reflection: 0.92,
            brightness: 1,
            grain: 'off' as const,
            uStrength: 0.18,
            uDensity: 1.5,
            uFrequency: 3,
            uAmplitude: 0.08,
            uSpeed: 0.16,
          }
        : {}),
    })
    setCustomized(true)
    loadScene()
  }

  const glass = settings.shader === 'glass'
  const shaderInfo = shaders.find((item) => item.value === settings.shader)!
  const shapeLabel = shapes.find((item) => item.value === settings.type)!.label
  const needsEnvironment = settings.lightType === 'env'
  const activePalette = palettes.find((palette) =>
    palette.colors.every((color, index) => color === settings[colorKeys[index]])
  )?.name
  const sceneName = glass
    ? 'Dedicated glass study'
    : `${presets[preset].title}${customized ? ' · remixed' : ' · Core preset'}`

  return (
    <main className='demo-studio react-color-studio'>
      <div className='studio-shell'>
        <header className='studio-header'>
          <a className='studio-brand' href='./'>
            ShaderGradient <span className='react-brand-divider'>/</span> Color
            Studio
          </a>
          <span className='studio-badge'>React 18 · public SDK</span>
        </header>

        <section className='studio-intro' aria-labelledby='studio-title'>
          <p className='studio-eyebrow'>COLOR / MATERIAL / MOTION</p>
          <h1 id='studio-title'>
            A little color.
            <br />
            <span className='react-accent'>A different atmosphere.</span>
          </h1>
          <p className='studio-lede'>
            Start with a complete preset. Find your palette, sculpt the surface,
            and make the motion your own. Real shaders, live in React.
          </p>
        </section>

        <div className='studio-workspace'>
          <section
            className='studio-panel react-scene-panel'
            aria-labelledby='preview-title'
          >
            <div className='studio-panel-header'>
              <div>
                <p className='studio-eyebrow'>01 / LIVE CANVAS</p>
                <h2 id='preview-title'>{sceneName}</h2>
              </div>
              <span className='react-status' data-status={status} role='status'>
                {status === 'ready'
                  ? needsEnvironment
                    ? `${settings.envPreset} HDR ready`
                    : 'Shader ready'
                  : status === 'error'
                  ? 'Scene unavailable'
                  : status === 'initializing'
                  ? 'Initializing'
                  : 'Loading scene'}
              </span>
            </div>
            <div
              className='studio-preview react-preview'
              role='group'
              aria-label={`${
                shaderInfo.label
              } on ${shapeLabel.toLowerCase()}. ${
                paused ? 'Motion paused.' : 'Animated preview.'
              }`}
            >
              {motionKnown && status !== 'error' && (
                <SceneBoundary onError={markError}>
                  <ShaderGradientCanvas
                    pixelDensity={settings.pixelDensity}
                    fov={settings.fov}
                    lazyLoad={false}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <SceneHealth
                      glass={glass}
                      needsEnvironment={needsEnvironment}
                      revision={sceneRevision}
                      paused={paused}
                      ready={status === 'ready'}
                      onReady={markReady}
                      onError={markError}
                      phaseReader={phaseReader}
                    />
                    {glass && <GlassBackdrop />}
                    <Subject
                      settings={settings}
                      paused={paused}
                      resetRevision={resetRevision}
                      onCameraUpdate={trackCamera}
                    />
                  </ShaderGradientCanvas>
                </SceneBoundary>
              )}
              {status !== 'ready' && (
                <div className='react-scene-overlay'>
                  <p
                    className={
                      status === 'error' ? 'studio-error' : 'studio-note'
                    }
                    role={status === 'error' ? 'alert' : 'status'}
                  >
                    <strong>
                      {status === 'error'
                        ? 'The canvas could not render.'
                        : 'Preparing your color field.'}
                    </strong>
                    <span>
                      {status === 'error'
                        ? error
                        : slowLoading
                        ? 'Still waiting for a real rendered frame or HDR assets. Check your connection and WebGL 2 support. No preview is being substituted.'
                        : needsEnvironment
                        ? 'Starting WebGL and loading the SDK’s HDR environments.'
                        : 'Starting WebGL and compiling the selected shader.'}
                    </span>
                  </p>
                  {status === 'error' && (
                    <button
                      className='studio-button'
                      onClick={() => window.location.reload()}
                    >
                      Reload studio
                    </button>
                  )}
                </div>
              )}
              {status === 'ready' && (
                <div className='react-preview-caption' aria-hidden='true'>
                  <span>
                    {shaderInfo.label} / {shapeLabel}
                  </span>
                  <span>{paused ? 'Motion paused' : 'Live motion'}</span>
                </div>
              )}
            </div>
            <div className='studio-panel-footer'>
              <p>
                Drag to orbit · Scroll to zoom
                <br />
                <span>Keyboard alternatives are in Camera &amp; light.</span>
              </p>
              <button
                className='studio-button-secondary'
                onClick={toggleMotion}
                disabled={status !== 'ready'}
                aria-pressed={paused}
                aria-describedby='motion-semantics'
              >
                {paused ? 'Resume motion' : 'Pause motion'}
              </button>
            </div>
            <div className='react-observe'>
              <p className='studio-eyebrow'>WHAT TO NOTICE</p>
              <p>{shaderInfo.description}</p>
              {glass && (
                <p className='studio-note'>
                  Recommended glass settings replace the selected preset and are
                  labeled as a separate study.{' '}
                  {settings.type === 'sphere'
                    ? 'The sphere is a closed volume: look for the orange and dark bars bending through its center.'
                    : 'This geometry is an open sheet, not a closed lens or a body of water.'}{' '}
                  Pale tints, high reflection and City HDR make transmission
                  easiest to see.
                </p>
              )}
            </div>
          </section>

          <aside className='studio-controls' aria-labelledby='controls-title'>
            <p className='studio-eyebrow'>02 / YOUR DIRECTION</p>
            <h2 id='controls-title'>Make a color study.</h2>
            <fieldset disabled={status === 'error'}>
              <legend>Starting point</legend>
              <label className='studio-field' htmlFor='preset'>
                Complete Core preset
                <select
                  id='preset'
                  value={preset}
                  onChange={(event) =>
                    applyPreset(event.target.value as PresetName)
                  }
                >
                  {presetEntries.map(([name, item]) => (
                    <option key={name} value={name}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <p className='studio-copy'>
                All ten presets include their original geometry, camera,
                lighting, grain and motion settings. Reduced motion takes
                priority.
              </p>
              <label className='studio-field' htmlFor='shader'>
                Shader family
                <select
                  id='shader'
                  value={settings.shader}
                  onChange={(event) =>
                    chooseVariant(
                      event.target.value as ShaderName,
                      settings.type
                    )
                  }
                >
                  {shaders.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='studio-field' htmlFor='shape'>
                Geometry
                <select
                  id='shape'
                  value={settings.type}
                  onChange={(event) =>
                    chooseVariant(
                      settings.shader,
                      event.target.value as ShaderGradientType
                    )
                  }
                >
                  {shapes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className='studio-copy'>
                Four shader families × three geometries. Shape changes reframe
                the camera; edits are labeled as remixes.
              </p>
            </fieldset>

            <fieldset disabled={status === 'error'}>
              <legend>Palette</legend>
              <div
                className='react-palette-options'
                role='group'
                aria-label='Palette combinations'
              >
                {palettes.map((palette) => (
                  <button
                    key={palette.name}
                    className='studio-swatch react-palette-button'
                    aria-pressed={activePalette === palette.name}
                    onClick={() =>
                      updateSettings({
                        color1: palette.colors[0],
                        color2: palette.colors[1],
                        color3: palette.colors[2],
                      })
                    }
                  >
                    <span className='react-palette-strip' aria-hidden='true'>
                      {palette.colors.map((color) => (
                        <i key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span>{palette.name}</span>
                  </button>
                ))}
              </div>
              <div className='react-color-inputs'>
                {colorKeys.map((key, index) => (
                  <label className='studio-field' key={key} htmlFor={key}>
                    Color {index + 1}
                    <input
                      id={key}
                      type='color'
                      value={settings[key]}
                      onChange={(event) =>
                        updateSettings({ [key]: event.target.value })
                      }
                    />
                    <span className='react-color-value'>{settings[key]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={status === 'error'}>
              <legend>Surface &amp; motion</legend>
              <label className='studio-field' htmlFor='speed'>
                <span>
                  Speed{' '}
                  <output htmlFor='speed'>{settings.uSpeed.toFixed(2)}</output>
                </span>
                <input
                  id='speed'
                  type='range'
                  min='0'
                  max='2'
                  step='0.01'
                  value={settings.uSpeed}
                  onChange={(event) =>
                    updateSettings({ uSpeed: Number(event.target.value) })
                  }
                />
              </label>
              <label className='studio-field' htmlFor='strength'>
                <span>
                  Deformation{' '}
                  <output htmlFor='strength'>
                    {settings.uStrength.toFixed(2)}
                  </output>
                </span>
                <input
                  id='strength'
                  type='range'
                  min='0'
                  max='5'
                  step='0.01'
                  value={settings.uStrength}
                  onChange={(event) =>
                    updateSettings({ uStrength: Number(event.target.value) })
                  }
                />
              </label>
              <label className='studio-field' htmlFor='reflection'>
                <span>
                  Reflection{' '}
                  <output htmlFor='reflection'>
                    {settings.reflection.toFixed(2)}
                  </output>
                </span>
                <input
                  id='reflection'
                  type='range'
                  min='0'
                  max='1'
                  step='0.01'
                  value={settings.reflection}
                  onChange={(event) =>
                    updateSettings({ reflection: Number(event.target.value) })
                  }
                />
              </label>
              <label className='studio-toggle' htmlFor='grain'>
                <input
                  id='grain'
                  type='checkbox'
                  checked={settings.grain === 'on'}
                  onChange={(event) => {
                    updateSettings({
                      grain: event.target.checked ? 'on' : 'off',
                    })
                    loadScene()
                  }}
                />
                Film grain
              </label>
              <p className='studio-copy'>
                Reflection is the inverse of surface roughness. Speed changes
                the shader’s motion, not a simulated UI clock. Pause to inspect
                a still; resume to see speed changes.
              </p>
            </fieldset>

            <details className='react-camera-controls'>
              <summary>Camera &amp; light</summary>
              <fieldset disabled={status === 'error'}>
                <legend>Camera &amp; light</legend>
                <label className='studio-field' htmlFor='azimuth'>
                  <span>
                    Orbit angle{' '}
                    <output htmlFor='azimuth'>{settings.cAzimuthAngle}°</output>
                  </span>
                  <input
                    id='azimuth'
                    type='range'
                    min='0'
                    max='360'
                    step='1'
                    value={settings.cAzimuthAngle}
                    onChange={(event) =>
                      updateSettings({
                        cAzimuthAngle: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className='studio-field' htmlFor='polar'>
                  <span>
                    Elevation{' '}
                    <output htmlFor='polar'>{settings.cPolarAngle}°</output>
                  </span>
                  <input
                    id='polar'
                    type='range'
                    min='0'
                    max='180'
                    step='1'
                    value={settings.cPolarAngle}
                    onChange={(event) =>
                      updateSettings({
                        cPolarAngle: Number(event.target.value),
                      })
                    }
                  />
                </label>
                {settings.type === 'sphere' ? (
                  <label className='studio-field' htmlFor='zoom'>
                    <span>
                      Camera zoom{' '}
                      <output htmlFor='zoom'>
                        {settings.cameraZoom.toFixed(1)}
                      </output>
                    </span>
                    <input
                      id='zoom'
                      type='range'
                      min='0.5'
                      max='20'
                      step='0.1'
                      value={settings.cameraZoom}
                      onChange={(event) =>
                        updateSettings({
                          cameraZoom: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                ) : (
                  <label className='studio-field' htmlFor='distance'>
                    <span>
                      Camera distance{' '}
                      <output htmlFor='distance'>
                        {settings.cDistance.toFixed(1)}
                      </output>
                    </span>
                    <input
                      id='distance'
                      type='range'
                      min='0.5'
                      max='10'
                      step='0.1'
                      value={settings.cDistance}
                      onChange={(event) =>
                        updateSettings({
                          cDistance: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <label className='studio-field' htmlFor='light'>
                  Lighting
                  <select
                    id='light'
                    value={settings.lightType}
                    onChange={(event) => {
                      updateSettings({
                        lightType: event.target.value as Settings['lightType'],
                      })
                      loadScene()
                    }}
                  >
                    <option value='3d'>Ambient / original preset light</option>
                    <option value='env'>HDR environment / reflections</option>
                  </select>
                </label>
                <label className='studio-field' htmlFor='environment'>
                  HDR environment
                  <select
                    id='environment'
                    value={settings.envPreset}
                    disabled={!needsEnvironment}
                    onChange={(event) => {
                      updateSettings({
                        envPreset: event.target.value as Settings['envPreset'],
                      })
                      loadScene()
                    }}
                  >
                    <option value='city'>City</option>
                    <option value='dawn'>Dawn</option>
                    <option value='lobby'>Lobby</option>
                  </select>
                </label>
                <label className='studio-field' htmlFor='brightness'>
                  <span>
                    Ambient brightness{' '}
                    <output htmlFor='brightness'>
                      {settings.brightness.toFixed(1)}
                    </output>
                  </span>
                  <input
                    id='brightness'
                    type='range'
                    min='0.1'
                    max='3'
                    step='0.1'
                    value={settings.brightness}
                    disabled={needsEnvironment}
                    onChange={(event) =>
                      updateSettings({ brightness: Number(event.target.value) })
                    }
                  />
                </label>
                <p className='studio-copy'>
                  {needsEnvironment
                    ? 'HDR supplies the lighting; ambient brightness does not apply. Glass works best with HDR enabled.'
                    : 'Ambient light is self-contained. Select HDR to explore environmental reflections; it requires network assets.'}
                </p>
              </fieldset>
            </details>
            <div className='studio-actions'>
              <button
                className='studio-button'
                onClick={() => applyPreset(preset)}
                disabled={status === 'error'}
              >
                Reset to {presets[preset].title}
              </button>
            </div>
            <p id='motion-semantics' className='studio-note'>
              {reducedMotion
                ? 'Reduced motion is enabled. The scene starts paused; Resume motion is an explicit opt-in.'
                : 'Pause holds the actual shader phase and stops continuous rendering. Edits, camera gestures and resizing can still request a frame.'}{' '}
              Paused palette, surface and camera edits retain that held phase.
              Resume starts a new SDK motion cycle at time zero, rather than
              continuing the held phase. Reset restores the complete selected
              preset and restarts its time.
            </p>
          </aside>
        </div>

        <section className='studio-section' aria-labelledby='process-title'>
          <div className='studio-section-heading'>
            <p className='studio-eyebrow'>03 / A SMALL CREATIVE PROCESS</p>
            <h2 id='process-title'>From preset to personal.</h2>
          </div>
          <div className='studio-cards'>
            <article className='studio-card'>
              <span className='react-step'>01</span>
              <h3>Find the atmosphere.</h3>
              <p>
                Halo is warm and expansive. Pensive wraps violet around a
                sphere. Cotton Candy turns the water plane into a pale, airy
                field. Each starts with its real Core settings.
              </p>
            </article>
            <article className='studio-card'>
              <span className='react-step'>02</span>
              <h3>Change one thing.</h3>
              <p>
                Try a new palette before changing the shape. Then compare the
                classic blend with Position Mix or Cosmic. All twelve
                combinations use the public React SDK.
              </p>
            </article>
            <article className='studio-card'>
              <span className='react-step'>03</span>
              <h3>Let light do the work.</h3>
              <p>
                The dedicated glass study uses the SDK’s physical material, a
                City HDR and real opaque objects. The stripes and bars give
                transmission something visible to bend.
              </p>
            </article>
          </div>
        </section>
        <footer className='studio-footer'>
          <span>React Color Studio · React 18 / Fiber 8 / Three r169</span>
          <a
            href='https://github.com/ruucm/shadergradient'
            target='_blank'
            rel='noreferrer'
          >
            Explore ShaderGradient source
          </a>
        </footer>
      </div>
    </main>
  )
}
