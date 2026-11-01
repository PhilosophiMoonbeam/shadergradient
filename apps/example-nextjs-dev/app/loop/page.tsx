'use client'

import { ShaderGradientCanvas } from '@shadergradient/react'
import { useState } from 'react'
import {
  RendererControls,
  StudyGradient,
  StudyPreview,
  StudyRange,
  StudyShell,
  useStudyMotion,
} from '../customize-simple/StudyFrame'

export default function LoopDemo() {
  const [type, setType] = useState<'plane' | 'sphere' | 'waterPlane'>('plane')
  const [loop, setLoop] = useState<'on' | 'off'>('on')
  const [loopDuration, setLoopDuration] = useState(5)
  const [uSpeed, setUSpeed] = useState(0.4)
  const [uStrength, setUStrength] = useState(4)
  const [uDensity, setUDensity] = useState(1.3)
  const [uFrequency, setUFrequency] = useState(5.5)
  const [uAmplitude, setUAmplitude] = useState(0)
  const [shader, setShader] = useState('defaults')
  const [range, setRange] = useState<'enabled' | 'disabled'>('disabled')
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(10)
  const [grain, setGrain] = useState(true)
  const [status, setStatus] = useState('Initializing renderer…')
  const { playing, reduced, toggle, pausedTime, materialTime } =
    useStudyMotion()
  const circularSampling = shader === 'defaults' || shader === 'glass'
  const sphereRipple =
    type === 'sphere' && (shader === 'defaults' || shader === 'positionMix')

  return (
    <StudyShell
      active='time'
      title='Time Study'
      eyebrow='02 / Rhythm, repetition & shape'
      description='A loop is a path through noise, not a progress bar. Compare circular repetition with a clipped time window, then shape the motion with speed and strength.'
    >
      <div className='studio-workspace'>
        <StudyPreview
          label={
            loop === 'on'
              ? circularSampling
                ? 'Circular motion'
                : 'Repeating shader time'
              : range === 'enabled'
              ? 'A window through time'
              : 'Free-running motion'
          }
          status={status}
        >
          <ShaderGradientCanvas style={{ width: '100%', height: '100%' }}>
            <StudyGradient
              type={type}
              cAzimuthAngle={180}
              cPolarAngle={90}
              cDistance={type === 'sphere' ? 4 : 15}
              cameraZoom={1}
              positionX={-1.4}
              positionY={0}
              positionZ={0}
              rotationX={0}
              rotationY={10}
              rotationZ={50}
              animate={playing ? 'on' : 'off'}
              loop={loop}
              loopDuration={loopDuration}
              range={range}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              grain={grain ? 'on' : 'off'}
              shader={shader}
              color1='#ff5005'
              color2='#dbba95'
              color3='#d0bce1'
              uSpeed={uSpeed}
              uStrength={uStrength}
              uDensity={uDensity}
              uFrequency={uFrequency}
              uAmplitude={uAmplitude}
              uTime={pausedTime}
              reflection={shader === 'glass' ? 0.85 : 0.1}
              lightType={shader === 'glass' ? 'env' : '3d'}
              brightness={1.2}
              envPreset='city'
            />
            {shader === 'glass' && (
              <>
                <mesh position={[0, 0, 4]}>
                  <planeGeometry args={[60, 40]} />
                  <meshBasicMaterial color='#172638' side={2} />
                </mesh>
                <mesh position={[-3, 0, 3.8]}>
                  <planeGeometry args={[2, 30]} />
                  <meshBasicMaterial color='#eeb18a' side={2} />
                </mesh>
                <mesh position={[3, 0, 3.8]}>
                  <planeGeometry args={[2, 30]} />
                  <meshBasicMaterial color='#a8cece' side={2} />
                </mesh>
              </>
            )}
            <RendererControls
              playing={playing}
              report={setStatus}
              materialTime={materialTime}
            />
          </ShaderGradientCanvas>
        </StudyPreview>
        <aside className='studio-controls' aria-label='Time controls'>
          <fieldset>
            <legend>Shape & material</legend>
            <div className='studio-field'>
              <label htmlFor='time-shape'>Geometry</label>
              <select
                id='time-shape'
                value={type}
                onChange={(event) => setType(event.target.value as typeof type)}
              >
                <option value='plane'>Plane</option>
                <option value='sphere'>Sphere</option>
                <option value='waterPlane'>Water plane</option>
              </select>
            </div>
            <div className='studio-field'>
              <label htmlFor='time-shader'>Shader</label>
              <select
                id='time-shader'
                value={shader}
                onChange={(event) => setShader(event.target.value)}
              >
                <option value='defaults'>Default gradient</option>
                <option value='positionMix'>Position mix</option>
                <option value='cosmic'>Cosmic</option>
                <option value='glass'>Glass</option>
              </select>
            </div>
            <label className='studio-toggle'>
              <input
                type='checkbox'
                checked={grain}
                onChange={(event) => setGrain(event.target.checked)}
              />
              Grain finish
            </label>
            {shader === 'glass' && (
              <p className='studio-note'>
                Glass uses real opaque scene stripes and HDR lighting. Plane
                geometries are thin sheets, not closed lenses; choose Sphere for
                volume.
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend>Playback & repetition</legend>
            <button
              className='studio-button'
              aria-pressed={playing}
              onClick={toggle}
            >
              {playing ? 'Pause motion' : 'Play motion'}
            </button>
            {reduced && (
              <p className='studio-note'>
                Reduced motion is preferred. Play explicitly to animate.
              </p>
            )}
            <label className='studio-toggle'>
              <input
                type='checkbox'
                checked={loop === 'on'}
                onChange={(event) =>
                  setLoop(event.target.checked ? 'on' : 'off')
                }
              />
              {circularSampling ? 'Seamless loop' : 'Repeat shader time'}
            </label>
            <StudyRange
              id='time-duration'
              label='Loop duration'
              value={loopDuration}
              min={1}
              max={20}
              step={0.5}
              unit=' s'
              onChange={setLoopDuration}
              disabled={loop === 'off'}
            />
            <StudyRange
              id='time-speed'
              label='Noise speed'
              value={uSpeed}
              min={0.1}
              max={2}
              onChange={setUSpeed}
            />
            <p className='studio-note'>
              {circularSampling
                ? 'Duration sets the circular cycle; speed changes the sampled path.'
                : 'This shader wraps its time but does not implement circular sampling, so the restart may jump.'}{' '}
              Loop takes priority over range.
            </p>
            <label className='studio-toggle'>
              <input
                type='checkbox'
                checked={range === 'enabled'}
                disabled={loop === 'on'}
                onChange={(event) =>
                  setRange(event.target.checked ? 'enabled' : 'disabled')
                }
              />
              Wrap a time range
            </label>
            <StudyRange
              id='time-start'
              label='Range start'
              value={rangeStart}
              min={0}
              max={rangeEnd - 0.1}
              onChange={setRangeStart}
              disabled={loop === 'on' || range !== 'enabled'}
            />
            <StudyRange
              id='time-end'
              label='Range end'
              value={rangeEnd}
              min={rangeStart + 0.1}
              max={20}
              onChange={setRangeEnd}
              disabled={loop === 'on' || range !== 'enabled'}
            />
          </fieldset>
          <fieldset>
            <legend>Noise & displacement</legend>
            <StudyRange
              id='time-strength'
              label='Strength'
              value={uStrength}
              min={0.1}
              max={10}
              onChange={setUStrength}
            />
            <StudyRange
              id='time-density'
              label='Density'
              value={uDensity}
              min={0.1}
              max={5}
              onChange={setUDensity}
            />
            <StudyRange
              id='time-frequency'
              label='Frequency'
              value={uFrequency}
              min={0.1}
              max={10}
              onChange={setUFrequency}
              disabled={!sphereRipple}
            />
            <StudyRange
              id='time-amplitude'
              label='Amplitude'
              value={uAmplitude}
              min={0}
              max={5}
              onChange={setUAmplitude}
              disabled={!sphereRipple}
            />
            <p className='studio-note'>
              Strength and density change noise. Frequency and amplitude control
              the sphere ripple in Default and Position mix.
            </p>
          </fieldset>
        </aside>
      </div>
      <section className='studio-section'>
        <div className='studio-section-heading'>
          <p className='studio-eyebrow'>Read the motion</p>
          <h2>Three ways to move through a field.</h2>
        </div>
        <div className='studio-cards'>
          <article className='studio-card'>
            <span className='studio-eyebrow'>01 / Loop</span>
            <h3>A recurring path</h3>
            <p>
              Default and Glass sample circular noise paths to meet at the cycle
              boundary. Position mix and Cosmic instead repeat shader time and
              may jump. Try a short duration and watch the silhouette.
            </p>
          </article>
          <article className='studio-card'>
            <span className='studio-eyebrow'>02 / Range</span>
            <h3>A cut, not a crossfade</h3>
            <p>
              Turn loop off and enable range. Shader time advances from start to
              end, then jumps back. Arbitrary endpoints do not promise a
              seamless shape.
            </p>
          </article>
          <article className='studio-card'>
            <span className='studio-eyebrow'>03 / Playback</span>
            <h3>The renderer owns time</h3>
            <p>
              No independent UI clock estimates progress here. Pause holds the
              material; Play restarts the SDK animation clock. Changing shader
              or geometry may also establish a new material.
            </p>
          </article>
        </div>
      </section>
    </StudyShell>
  )
}
