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
} from './StudyFrame'

export default function Page() {
  const [rangeEnabled, setRangeEnabled] = useState(true)
  const [rangeStart, setRangeStart] = useState(2)
  const [rangeEnd, setRangeEnd] = useState(5)
  const [pixelDensity, setPixelDensity] = useState(1)
  const [fov, setFov] = useState(45)
  const [reflection, setReflection] = useState(0.1)
  const [grain, setGrain] = useState(false)
  const [lightType, setLightType] = useState<'3d' | 'env'>('env')
  const [status, setStatus] = useState('Initializing renderer…')
  const { playing, reduced, toggle, pausedTime, materialTime } =
    useStudyMotion()
  return (
    <StudyShell
      active='canvas'
      title='Canvas Study'
      eyebrow='01 / Framing, detail & light'
      description='One surface, three different decisions. Explore how a wider lens, a denser drawing buffer and a smoother finish change the same living gradient.'
    >
      <div className='studio-workspace'>
        <StudyPreview label='A surface in soft light' status={status}>
          <ShaderGradientCanvas style={{ width: '100%', height: '100%' }}>
            <StudyGradient
              uTime={pausedTime}
              animate={playing ? 'on' : 'off'}
              range={rangeEnabled ? 'enabled' : 'disabled'}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              reflection={reflection}
              grain={grain ? 'on' : 'off'}
              lightType={lightType}
            />
            <RendererControls
              playing={playing}
              fov={fov}
              density={pixelDensity}
              report={setStatus}
              materialTime={materialTime}
            />
          </ShaderGradientCanvas>
        </StudyPreview>
        <aside className='studio-controls' aria-label='Canvas controls'>
          <fieldset>
            <legend>Camera & drawing buffer</legend>
            <StudyRange
              id='canvas-fov'
              label='Field of view'
              value={fov}
              min={20}
              max={120}
              step={1}
              unit='°'
              onChange={setFov}
            />
            <p className='studio-note'>
              A wider lens includes more of the scene. It does not change the
              geometry.
            </p>
            <StudyRange
              id='canvas-density'
              label='Pixel density'
              value={pixelDensity}
              min={0.5}
              max={3}
              step={0.5}
              unit='×'
              onChange={setPixelDensity}
            />
            <p className='studio-note'>
              Drawing-buffer pixels per CSS pixel. Higher density costs more GPU
              work; it is not a frame-rate measurement.
            </p>
            <button
              className='studio-button-secondary'
              onClick={() => setFov(45)}
            >
              Reset lens only
            </button>
          </fieldset>
          <fieldset>
            <legend>Surface & illumination</legend>
            <StudyRange
              id='canvas-reflection'
              label='Reflection'
              value={reflection}
              min={0}
              max={1}
              step={0.05}
              onChange={setReflection}
            />
            <p className='studio-note'>
              Higher reflection lowers material roughness. Environment lighting
              makes the difference easier to see.
            </p>
            <div className='studio-field'>
              <label htmlFor='canvas-light'>Lighting</label>
              <select
                id='canvas-light'
                value={lightType}
                onChange={(event) =>
                  setLightType(event.target.value as '3d' | 'env')
                }
              >
                <option value='env'>HDR environment</option>
                <option value='3d'>Studio lights</option>
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
          </fieldset>
          <fieldset>
            <legend>Motion window</legend>
            <div className='studio-actions'>
              <button
                className='studio-button'
                aria-pressed={playing}
                onClick={toggle}
              >
                {playing ? 'Pause motion' : 'Play motion'}
              </button>
            </div>
            {reduced && (
              <p className='studio-note'>
                Reduced motion is preferred. Play explicitly to animate.
              </p>
            )}
            <label className='studio-toggle'>
              <input
                type='checkbox'
                checked={rangeEnabled}
                onChange={(event) => setRangeEnabled(event.target.checked)}
              />
              Limit shader time to a range
            </label>
            <StudyRange
              id='canvas-start'
              label='Range start'
              value={rangeStart}
              min={0}
              max={rangeEnd - 0.1}
              onChange={setRangeStart}
              disabled={!rangeEnabled}
            />
            <StudyRange
              id='canvas-end'
              label='Range end'
              value={rangeEnd}
              min={rangeStart + 0.1}
              max={20}
              onChange={setRangeEnd}
              disabled={!rangeEnabled}
            />
            <p className='studio-note'>
              The SDK wraps from end to start; unlike a seamless loop, the
              endpoints may look different.
            </p>
          </fieldset>
        </aside>
      </div>
      <section className='studio-section'>
        <div className='studio-section-heading'>
          <p className='studio-eyebrow'>Look closer</p>
          <h2>Change one thing at a time.</h2>
        </div>
        <div className='studio-cards'>
          <article className='studio-card'>
            <span className='studio-eyebrow'>01 / Frame</span>
            <h3>Pause, then widen the lens</h3>
            <p>
              Use the same frozen shape to compare framing. Reset lens only
              returns to 45° without replacing the canvas or restarting shader
              time.
            </p>
          </article>
          <article className='studio-card'>
            <span className='studio-eyebrow'>02 / Detail</span>
            <h3>Compare edges, not speed</h3>
            <p>
              Try 0.5× and 2× density. The CSS preview stays the same size while
              the drawing buffer changes. Grain and lighting remain your
              choices.
            </p>
          </article>
          <article className='studio-card'>
            <span className='studio-eyebrow'>03 / Surface</span>
            <h3>Let the light reveal the finish</h3>
            <p>
              Increase reflection with HDR enabled. This is a gradient material
              roughness study, not a glass or transmission simulation.
            </p>
          </article>
        </div>
      </section>
    </StudyShell>
  )
}
