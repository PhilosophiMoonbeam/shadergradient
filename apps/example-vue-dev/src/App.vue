<script setup lang="ts">
import {
  computed,
  nextTick,
  onErrorCaptured,
  onMounted,
  onScopeDispose,
  ref,
  watch,
} from 'vue'
import {
  presets,
  ShaderGradient,
  ShaderGradientCanvas,
} from '@shadergradient/vue'
import type { ShaderGradientProps } from '@shadergradient/vue'
import PaletteScene from './PaletteScene'
import type { PaletteSceneApi } from './PaletteScene'
import '../../demo-studio.css'

type EditableGradientProps = {
  -readonly [Key in keyof ShaderGradientProps]: ShaderGradientProps[Key]
}
type CanvasPresetFields = {
  readonly fov?: number
  readonly pixelDensity?: number
}
function presetCanvasSettings(props: ShaderGradientProps & CanvasPresetFields) {
  return { fov: props.fov ?? 45, pixelDensity: props.pixelDensity ?? 1 }
}

const preset = ref<keyof typeof presets>('halo')
const settings = ref<EditableGradientProps>({ ...presets.halo.props })
const canvasSettings = ref(presetCanvasSettings(presets.halo.props))
const reducedMotion = ref(false)
const rendered = ref(false)
const sceneSuspended = ref(false)
const paletteScene = ref<PaletteSceneApi | null>(null)
const environmentReady = ref(false)
const rendererError = ref('')
const hdrError = ref('')
const previewKey = ref(0)
const study = ref(false)
const colorFields = ['color1', 'color2', 'color3'] as const
const colorNames = ['Foundation', 'Counterpoint', 'Highlight']
const paused = computed(
  () => reducedMotion.value || settings.value.animate === 'off'
)
const animation = computed(() => (paused.value ? 'off' : 'on'))
const isGlass = computed(() => settings.value.shader === 'glass')
const modified = computed(() =>
  Object.entries(settings.value).some(
    ([key, value]) => value !== Reflect.get(presets[preset.value].props, key)
  )
)
const paletteName = computed(() =>
  study.value
    ? 'Glass / stripe study'
    : `${presets[preset.value].title}${
        modified.value ? ' / your variation' : ' / Core preset'
      }`
)
const status = computed(() => {
  if (rendererError.value) return 'Preview unavailable'
  if (hdrError.value) return 'HDR unavailable'
  if (sceneSuspended.value) return 'Preview suspended · scroll into view'
  if (!rendered.value) return 'Initializing WebGL'
  if (settings.value.lightType === 'env' && !environmentReady.value)
    return `Loading ${settings.value.envPreset} HDR`
  return paused.value ? 'Rendered · motion paused' : 'Rendered · motion on'
})

async function applyPreset() {
  const name = preset.value
  const cameraSnapshot = paletteScene.value?.snapshotCamera()
  if (cameraSnapshot) {
    // Commit the actual pose before restoring canonical props, even when reset
    // is clicked before CameraControls emits its first rest event.
    receiveCameraUpdate(cameraSnapshot)
    await nextTick()
    if (preset.value !== name) return
  }
  settings.value = { ...presets[name].props }
  canvasSettings.value = presetCanvasSettings(presets[name].props)
  study.value = false
}
watch(preset, applyPreset)
watch(
  () => settings.value.shader,
  (shader) => {
    if (shader === 'glass') settings.value.lightType = 'env'
  }
)
watch([() => settings.value.lightType, () => settings.value.envPreset], () => {
  hdrError.value = ''
  environmentReady.value = false
})
function glassStudy() {
  canvasSettings.value = presetCanvasSettings(presets.halo.props)
  settings.value = {
    ...presets.halo.props,
    shader: 'glass',
    type: 'sphere',
    color1: '#ffffff',
    color2: '#e1f3ed',
    color3: '#ffffff',
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    cAzimuthAngle: 0,
    cPolarAngle: 90,
    cDistance: 14,
    cameraZoom: 3.4,
    lightType: 'env',
    envPreset: 'city',
    reflection: 0.94,
    uStrength: 0.2,
    uDensity: 1.2,
    uAmplitude: 0.1,
    uSpeed: 0.2,
    grain: 'off',
    animate: settings.value.animate,
  }
  study.value = true
}
function receivedFrame(environment: boolean) {
  rendered.value = true
  environmentReady.value = environment
}
const cameraFields = [
  'cAzimuthAngle',
  'cPolarAngle',
  'cDistance',
  'cameraZoom',
] as const
function receiveCameraUpdate(updates: Partial<ShaderGradientProps>) {
  for (const field of cameraFields) {
    const value = updates[field]
    const current = settings.value[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (typeof current === 'number') {
      const difference = value - current
      const distance =
        field === 'cAzimuthAngle'
          ? ((((difference + 180) % 360) + 360) % 360) - 180
          : difference
      // Spherical.makeSafe's 1e-6-radian pole clamp is about 5.7e-5 degrees.
      // Keep equivalent supported polar poses canonical, not genuine edits.
      const precision = field === 'cPolarAngle' ? 0.0001 : 0.000001
      if (Math.abs(distance) <= precision) continue
    }
    settings.value[field] = value
  }
}
function sceneActivated() {
  sceneSuspended.value = false
  rendered.value = false
  environmentReady.value = false
}
function sceneDeactivated() {
  sceneSuspended.value = true
  rendered.value = false
  environmentReady.value = false
}
function changePause(event: Event) {
  settings.value.animate = (event.target as HTMLInputElement).checked
    ? 'off'
    : 'on'
}
function reloadPreview() {
  rendererError.value = ''
  hdrError.value = ''
  sceneSuspended.value = false
  rendered.value = false
  environmentReady.value = false
  previewKey.value++
}
onErrorCaptured((error) => {
  rendererError.value = error instanceof Error ? error.message : String(error)
})
let removePreferenceListener = () => {}
onMounted(() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const update = () => {
    reducedMotion.value = preference.matches
  }
  update()
  preference.addEventListener('change', update)
  removePreferenceListener = () =>
    preference.removeEventListener('change', update)
})
onScopeDispose(() => removePreferenceListener())
</script>

<template>
  <main class="demo-studio vue-palette-studio">
    <div class="studio-shell">
      <header class="studio-header">
        <a class="studio-brand" href="#palette-studio"
          >ShaderGradient <span aria-hidden="true">/</span> Studies</a
        >
        <span class="studio-badge">Vue 3 · public SDK</span>
      </header>
      <section
        id="palette-studio"
        class="studio-intro"
        aria-labelledby="studio-title"
      >
        <p class="studio-eyebrow">01 / A reactive color playground</p>
        <h1 id="studio-title">Palette Studio</h1>
        <p class="studio-lede">
          Three colors. A different atmosphere. Start with a complete Core
          preset, then tune the palette, movement and material in one live Vue
          scene.
        </p>
      </section>

      <div class="studio-workspace">
        <section class="studio-panel" aria-labelledby="preview-title">
          <div class="studio-panel-header">
            <div>
              <p class="studio-eyebrow">Live composition</p>
              <h2 id="preview-title">{{ paletteName }}</h2>
            </div>
            <span class="studio-badge"
              >{{ settings.type }} / {{ settings.shader }}</span
            >
          </div>
          <div
            class="studio-preview palette-preview"
            role="img"
            :aria-label="`${paletteName}, ${settings.type} with ${settings.shader} shader. ${status}.`"
          >
            <div class="palette-canvas">
              <ShaderGradientCanvas
                v-if="!rendererError"
                :key="previewKey"
                v-bind="canvasSettings"
                pointer-events="auto"
              >
                <ShaderGradient
                  v-bind="settings"
                  :animate="animation"
                  :enable-transition="false"
                  @camera-update="receiveCameraUpdate"
                  @error="
                    hdrError =
                      'The environment HDR could not be loaded. Reflections are incomplete; choose another environment or retry.'
                  "
                />
                <PaletteScene
                  ref="paletteScene"
                  :settings="settings"
                  :paused="paused"
                  :hdr-failed="Boolean(hdrError)"
                  @rendered="receivedFrame"
                  @camera-update="receiveCameraUpdate"
                  @failure="rendererError = $event"
                  @active="sceneActivated"
                  @inactive="sceneDeactivated"
                />
                <template #fallback
                  ><div class="palette-fallback">
                    Preparing the WebGL scene…
                  </div></template
                >
              </ShaderGradientCanvas>
            </div>
            <div
              v-if="!rendered || rendererError"
              class="palette-preview-message"
            >
              <p>
                {{
                  rendererError
                    ? 'The live scene is unavailable.'
                    : sceneSuspended
                    ? 'Preview suspended while out of view.'
                    : 'Preparing your palette…'
                }}
              </p>
              <p>
                Color controls and preset descriptions remain available below.
              </p>
            </div>
          </div>
          <div class="studio-panel-footer">
            <label class="studio-toggle" for="pause"
              ><input
                id="pause"
                :checked="paused"
                type="checkbox"
                :disabled="reducedMotion"
                @change="changePause"
              />
              Pause animation</label
            >
            <div class="palette-caption-colors" aria-label="Current palette">
              <span
                v-for="(field, index) in colorFields"
                :key="field"
                class="palette-color-dot"
                :style="{ backgroundColor: settings[field] }"
                :title="`${colorNames[index]}: ${settings[field]}`"
              />
              <span>{{
                isGlass
                  ? 'Opaque stripes in the scene · try the glass study below'
                  : 'Drag to orbit · scroll to zoom · reset with the preset'
              }}</span>
            </div>
            <p class="palette-status" role="status" aria-live="polite">
              {{ status }}
            </p>
          </div>
          <div v-if="rendererError || hdrError" class="palette-error-area">
            <p class="studio-error" role="alert">
              {{ rendererError || hdrError }}
            </p>
            <button
              class="studio-button-secondary"
              type="button"
              @click="reloadPreview"
            >
              Reload preview
            </button>
            <p class="studio-copy">
              Reloading recreates the WebGL scene and restarts its shader time.
              No substitute material is shown.
            </p>
          </div>
        </section>

        <form
          class="studio-controls"
          aria-label="Palette and material controls"
          @submit.prevent
        >
          <fieldset>
            <legend>01 / Starting point</legend>
            <label class="studio-field" for="preset"
              >Core preset
              <select id="preset" v-model="preset">
                <option
                  v-for="(item, name) in presets"
                  :key="name"
                  :value="name"
                >
                  {{ item.title }}
                </option>
              </select>
            </label>
            <p class="studio-copy">
              All ten presets restore the full composition: shape, camera,
              colors, lighting, grain and motion.
            </p>
            <button
              class="studio-button-secondary palette-reset"
              type="button"
              @click="applyPreset"
            >
              Reset to {{ presets[preset].title }}
            </button>
          </fieldset>
          <fieldset>
            <legend>02 / Palette</legend>
            <div class="palette-color-controls">
              <label
                v-for="(field, index) in colorFields"
                :key="field"
                class="palette-color-field"
                :for="field"
              >
                <span>{{ colorNames[index] }}</span>
                <div class="palette-color-input">
                  <input
                    :id="field"
                    v-model="settings[field]"
                    class="studio-swatch"
                    type="color"
                  />
                  <output :for="field">{{ settings[field] }}</output>
                </div>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>03 / Surface &amp; shape</legend>
            <label class="studio-field" for="shape"
              >Shape
              <select id="shape" v-model="settings.type">
                <option value="plane">Plane — broad color field</option>
                <option value="waterPlane">Water plane — rippled sheet</option>
                <option value="sphere">Sphere — sculptural volume</option>
              </select>
            </label>
            <label class="studio-field" for="shader"
              >Shader
              <select id="shader" v-model="settings.shader">
                <option value="defaults">Default — fluid color</option>
                <option value="positionMix">
                  Position mix — spatial blend
                </option>
                <option value="cosmic">Cosmic — flowing bands</option>
                <option value="glass">Glass — transmitted scene</option>
              </select>
            </label>
            <p class="studio-copy">
              Three geometries × four shaders. Every combination is available.
            </p>
            <label class="studio-field" for="lighting"
              >Lighting
              <select id="lighting" v-model="settings.lightType">
                <option value="3d">Ambient / 3D</option>
                <option value="env">HDR environment</option>
              </select>
            </label>
            <label
              v-if="settings.lightType === 'env'"
              class="studio-field"
              for="environment"
              >HDR environment
              <select id="environment" v-model="settings.envPreset">
                <option value="city">City</option>
                <option value="dawn">Dawn</option>
                <option value="lobby">Lobby</option>
              </select>
            </label>
            <label class="studio-field" for="reflection"
              >Surface polish
              <output for="reflection">{{
                Number(settings.reflection ?? 0).toFixed(2)
              }}</output>
              <input
                id="reflection"
                v-model.number="settings.reflection"
                type="range"
                min="0"
                max="1"
                step="0.01"
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>04 / Motion &amp; finish</legend>
            <label class="studio-field" for="speed"
              >Speed
              <output for="speed">{{
                Number(settings.uSpeed ?? 0).toFixed(2)
              }}</output>
              <input
                id="speed"
                v-model.number="settings.uSpeed"
                type="range"
                min="0"
                max="2"
                step="0.05"
              />
            </label>
            <label class="studio-toggle" for="grain"
              ><input
                id="grain"
                v-model="settings.grain"
                type="checkbox"
                true-value="on"
                false-value="off"
              />
              Film grain</label
            >
            <p v-if="reducedMotion" class="studio-note">
              Your reduced-motion preference is active. The scene stays still;
              palette and material edits still render.
            </p>
            <p v-else class="studio-copy">
              Pause to compare colors without movement. Visible paused edits
              keep shader time. Scrolling away releases WebGL; returning starts
              from the composition’s initial time.
            </p>
          </fieldset>
        </form>
      </div>

      <section class="studio-section" aria-labelledby="observe-title">
        <div class="studio-section-heading">
          <p class="studio-eyebrow">Look closer</p>
          <h2 id="observe-title">Change one thing. See what shifts.</h2>
        </div>
        <div class="studio-cards">
          <article class="studio-card">
            <p class="studio-eyebrow">01 / Color relationships</p>
            <h3>Build a palette, not a filter</h3>
            <p class="studio-copy">
              Start with Halo’s warm orange and lilac, or Mint’s cool whites.
              Change the counterpoint to see the same geometry take on a new
              temperature. These inputs update the shader’s actual three color
              uniforms.
            </p>
          </article>
          <article class="studio-card">
            <p class="studio-eyebrow">02 / Form &amp; rhythm</p>
            <h3>From field to object</h3>
            <p class="studio-copy">
              A plane fills the frame; water introduces a displaced sheet; a
              sphere makes the blend wrap around a volume. Pause before
              switching shaders to separate the material change from its motion.
            </p>
          </article>
          <article class="studio-card">
            <p class="studio-eyebrow">03 / An optical study</p>
            <h3>Glass needs something behind it</h3>
            <p class="studio-copy">
              The glass study uses real opaque stripes and colored blocks behind
              the SDK surface, with City HDR for reflections. Look for the
              stripes bending through the sphere—not a CSS backdrop. Plane
              variants are sheets, not closed lenses.
            </p>
            <button
              class="studio-button"
              type="button"
              :aria-pressed="study"
              @click="glassStudy"
            >
              Explore glass study
            </button>
            <p class="studio-copy">
              A custom study, not an unchanged Core preset. Use Reset to return
              to the selected preset.
            </p>
          </article>
        </div>
      </section>
      <footer class="studio-footer">
        <span>Palette Studio / Vue 3 + TresJS</span>
        <span>Public @shadergradient/vue · your scene, your palette</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.vue-palette-studio {
  --studio-accent: #97d7bd;
}
.palette-preview {
  height: clamp(460px, 62svh, 720px);
  background: #182822;
}
.palette-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.palette-preview-message {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: #eff5ef;
  background: #182822;
}
.palette-preview-message p {
  margin: 0;
}
.palette-preview-message p + p {
  max-width: 32ch;
  color: #c0d2c8;
  font-size: 0.85rem;
}
.palette-fallback {
  display: grid;
  place-items: center;
  height: 100%;
  color: #eff5ef;
}
.palette-caption-colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}
.palette-color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #8d9b92;
}
.palette-caption-colors > span:last-child {
  margin-left: 5px;
}
.palette-status {
  margin: 0;
  font-size: 0.8rem;
}
.palette-error-area {
  display: grid;
  gap: 12px;
  padding: 20px;
}
.palette-color-controls {
  display: grid;
  gap: 12px;
}
.palette-color-field {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
}
.palette-color-input {
  display: flex;
  align-items: center;
  gap: 12px;
}
.palette-color-input input {
  width: 58px;
  min-height: 44px;
  flex: none;
}
.palette-color-input output {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  text-transform: uppercase;
}
.palette-reset {
  width: 100%;
}
@media (max-width: 600px) {
  .palette-preview {
    height: 460px;
  }
  .palette-color-controls {
    grid-template-columns: 1fr;
  }
  .palette-color-input input {
    flex: 1;
    max-width: 96px;
  }
}
</style>
