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
import JournalScene from '../components/JournalScene'
import type {
  JournalSceneHandle,
  JournalSceneSnapshot,
  JournalSettings,
} from '../components/JournalScene'
import '../../../demo-studio.css'

useHead({
  title: 'Scene Journal · Nuxt ShaderGradient',
  meta: [
    {
      name: 'description',
      content:
        'A server-rendered journal of reactive palettes, physical materials and real navigation with ShaderGradient.',
    },
  ],
})

const presetNames = Object.keys(presets) as (keyof typeof presets)[]

function presetSettings(name: keyof typeof presets): JournalSettings {
  return {
    ...presets.halo.props,
    ...presets[name].props,
    loop: 'off',
    loopDuration: 5,
    smoothTime: 0.05,
    enableTransition: false,
    grainBlending: 1,
    toggleAxis: false,
    control: 'props',
    urlString: '',
  }
}

// Nuxt state is request-local during SSR and survives a real away/back visit.
const preset = useState<keyof typeof presets>('journal-preset', () => 'halo')
const settings = useState<JournalSettings>('journal-settings', () =>
  presetSettings('halo')
)
const paused = useState('journal-paused', () => false)
const customized = useState('journal-customized', () => false)
const reducedMotion = ref(false)
const journalScene = ref<JournalSceneHandle | null>(null)
const resumedTime = useState<number | null>('journal-rendered-time', () => null)
let applyingPreset = false
const rendererState = ref<'initializing' | 'loading' | 'ready' | 'suspended'>(
  'initializing'
)
const environmentReady = ref(false)
const environmentError = ref('')
const rendererError = ref('')
const fatalRendererError = ref(false)
const rendererKey = ref(0)
const effectivePaused = computed(() => paused.value || reducedMotion.value)
const animation = computed(() => (effectivePaused.value ? 'off' : 'on'))
const hasError = computed(
  () => !!(environmentError.value || rendererError.value)
)
const sceneTitle = computed(() =>
  customized.value
    ? `Study after ${presets[preset.value].title}`
    : presets[preset.value].title
)
const palette = computed(() => [
  settings.value.color1,
  settings.value.color2,
  settings.value.color3,
])
const fallbackStyle = computed(() => ({
  background: `radial-gradient(ellipse at 20% 20%, ${settings.value.color1}, transparent 65%), linear-gradient(135deg, ${settings.value.color2}, ${settings.value.color3})`,
}))
const status = computed(() => {
  if (rendererError.value) return 'Renderer interrupted'
  if (environmentError.value) return 'HDR unavailable'
  if (rendererState.value === 'initializing')
    return 'Server palette · awaiting hydration'
  if (rendererState.value === 'loading') return 'Initializing WebGL'
  if (rendererState.value === 'suspended')
    return 'Palette preview · scene offscreen'
  if (!environmentReady.value && settings.value.lightType === 'env')
    return 'Rendered · loading HDR'
  return effectivePaused.value
    ? 'Rendered · still frame'
    : 'Rendered · animation running'
})

async function applyPreset(name: keyof typeof presets) {
  if (applyingPreset) return
  applyingPreset = true
  const target = presetSettings(name)
  try {
    const actualCamera = journalScene.value?.readCamera()
    if (actualCamera) {
      // First synchronize the real pose, including drags whose SDK rest event
      // has not fired. The next tick lets the SDK consume that genuine pose.
      Object.assign(settings.value, actualCamera)
      await nextTick()
    }
    preset.value = name
    settings.value = target
    resumedTime.value = null
    paused.value = target.animate === 'off'
    customized.value = false
    await nextTick()
  } finally {
    applyingPreset = false
  }
}
function selectPreset(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const name = presetNames.find((candidate) => candidate === value)
  if (name !== undefined) applyPreset(name)
}

function markEdited(event: Event) {
  if ((event.target as HTMLElement).id !== 'journal-preset')
    customized.value = true
}
const cameraKeys = [
  'cAzimuthAngle',
  'cPolarAngle',
  'cDistance',
  'cameraZoom',
] as const
function recordCamera(updates: Partial<JournalSettings>) {
  if (applyingPreset) return
  let changed = false
  for (const key of cameraKeys) {
    const value = updates[key]
    const current = settings.value[key]
    if (value === undefined) continue
    if (current !== undefined) {
      const difference = value - current
      const distance =
        key === 'cAzimuthAngle'
          ? ((((difference + 180) % 360) + 360) % 360) - 180
          : difference
      if (Math.abs(distance) <= 0.000001) continue
    }
    settings.value[key] = value
    changed = true
  }
  // Equal SDK rest reports must not feed another camera-prop update.
  if (changed) customized.value = true
}

function initializeScene() {
  rendererState.value = 'loading'
  environmentReady.value = false
  environmentError.value = ''
  rendererError.value = ''
}

function suspendScene(snapshot: JournalSceneSnapshot) {
  if (snapshot.time !== undefined) resumedTime.value = snapshot.time
  if (snapshot.camera) recordCamera(snapshot.camera)
  rendererState.value = 'suspended'
  environmentReady.value = false
}

function frame(ready: boolean) {
  rendererState.value = 'ready'
  environmentReady.value = ready
}

function reloadScene() {
  rendererError.value = ''
  environmentError.value = ''
  fatalRendererError.value = false
  environmentReady.value = false
  rendererState.value = 'loading'
  rendererKey.value++
}

function glassStudy() {
  preset.value = 'halo'
  settings.value = {
    ...presetSettings('halo'),
    shader: 'glass',
    type: 'sphere',
    color1: '#d9efff',
    color2: '#f2e6d7',
    color3: '#daf3e9',
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    cAzimuthAngle: 0,
    cPolarAngle: 90,
    cDistance: 3.7,
    cameraZoom: 3.7,
    uStrength: 0.22,
    uDensity: 1.2,
    uSpeed: 0.2,
    reflection: 0.96,
    grain: 'off',
    lightType: 'env',
    envPreset: 'city',
  }
  customized.value = true
}

watch(
  () => settings.value.shader,
  (shader) => {
    if (shader === 'glass') {
      settings.value.lightType = 'env'
      if ((settings.value.reflection ?? 0) < 0.8)
        settings.value.reflection = 0.96
      customized.value = true
    }
  }
)
watch(
  () => [settings.value.lightType, settings.value.envPreset],
  () => {
    environmentReady.value = settings.value.lightType !== 'env'
    environmentError.value = ''
  }
)

onErrorCaptured((error) => {
  rendererError.value = `The scene could not initialize: ${
    error instanceof Error ? error.message : String(error)
  }`
  console.error('Scene Journal renderer initialization failed:', error)
  fatalRendererError.value = true
  return false
})

let removePreference = () => {}
onMounted(() => {
  rendererState.value = 'suspended'
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const updatePreference = () => {
    reducedMotion.value = preference.matches
  }
  updatePreference()
  preference.addEventListener('change', updatePreference)
  removePreference = () =>
    preference.removeEventListener('change', updatePreference)
})
onScopeDispose(() => removePreference())
</script>

<template>
  <main class="demo-studio journal">
    <div class="studio-shell">
      <header class="studio-header">
        <NuxtLink class="studio-brand" to="/" aria-label="Scene Journal home"
          >SG / Scene Journal</NuxtLink
        >
        <div class="studio-row">
          <span class="studio-badge">Nuxt · Vue · Three r186</span>
          <NuxtLink class="studio-button-secondary" to="/away"
            >Read the field notes ↗</NuxtLink
          >
        </div>
      </header>

      <section class="studio-intro" aria-labelledby="journal-title">
        <p class="studio-eyebrow">
          No. 01 / Color, light &amp; a little atmosphere
        </p>
        <h1 id="journal-title">A scene worth<br /><em>staying with.</em></h1>
        <p class="studio-lede">
          Ten starting points. Three forms. Four ways of seeing. An interactive
          journal of shader studies, served as a real page before the first
          frame arrives.
        </p>
        <div class="studio-row journal-intro-links">
          <a href="#preset-archive">Explore the ten presets ↓</a>
          <span>Server-rendered words. Browser-rendered worlds.</span>
        </div>
      </section>

      <section class="studio-workspace" aria-label="Interactive scene study">
        <div class="studio-panel">
          <div class="studio-panel-header">
            <div>
              <p class="studio-eyebrow">
                {{ customized ? 'Personal study' : 'Core preset' }} / live
                canvas
              </p>
              <h2>{{ sceneTitle }}</h2>
            </div>
            <span class="journal-status" role="status" aria-live="polite">
              <span :class="{ 'journal-status-error': hasError }" />{{ status }}
            </span>
          </div>
          <div class="studio-preview journal-preview" :style="fallbackStyle">
            <div
              class="journal-server-palette"
              data-journal-palette
              aria-hidden="true"
              :style="fallbackStyle"
            >
              <span>{{
                rendererState === 'ready' ? '' : 'A palette before a scene'
              }}</span>
            </div>
            <ShaderGradientCanvas
              v-if="!fatalRendererError"
              :key="rendererKey"
              class="journal-canvas"
              pointer-events="auto"
              :fov="settings.fov ?? 45"
              :pixel-density="settings.pixelDensity ?? 1"
              style="width: 100%; height: 100%"
            >
              <ShaderGradient
                v-bind="settings"
                :animate="animation"
                :u-time="resumedTime ?? settings.uTime"
                @camera-update="recordCamera"
                @error="
                  environmentError =
                    'The HDR environment could not be loaded. The scene is not receiving its selected image-based lighting. Choose another environment or reload the scene.'
                "
              />
              <JournalScene
                ref="journalScene"
                :settings="settings"
                :paused="effectivePaused"
                :failed="hasError"
                @frame="frame"
                @initializing="initializeScene"
                @suspended="suspendScene"
                @failure="rendererError = $event"
                @restored="reloadScene"
              />
              <template #fallback>
                <div
                  class="journal-fallback"
                  data-gradient-fallback
                  :style="fallbackStyle"
                />
              </template>
            </ShaderGradientCanvas>
            <div class="journal-preview-label" aria-hidden="true">
              <span>{{ settings.type }} / {{ settings.shader }}</span>
              <span>{{
                effectivePaused ? 'Still study' : 'Moving study'
              }}</span>
            </div>
          </div>
          <div class="studio-panel-footer">
            <label class="studio-toggle" for="journal-pause"
              ><input
                id="journal-pause"
                v-model="paused"
                type="checkbox"
                :disabled="reducedMotion"
                @input="markEdited"
              />
              Pause animation</label
            >
            <p v-if="reducedMotion" class="studio-note">
              System reduced motion is active. The scene stays still; your edits
              and resizes still render.
            </p>
            <div class="journal-palette-strip" aria-label="Current palette">
              <span
                v-for="(color, index) in palette"
                :key="index"
                :style="{ backgroundColor: color }"
              />
            </div>
            <p>
              {{
                customized
                  ? 'Custom settings — not an exact Core preset.'
                  : 'Complete Core preset: color, geometry, camera, lighting and motion.'
              }}
            </p>
          </div>
          <div v-if="hasError" class="studio-error journal-error" role="alert">
            <p v-if="rendererError">{{ rendererError }}</p>
            <p v-if="environmentError">{{ environmentError }}</p>
            <button
              class="studio-button-secondary"
              type="button"
              @click="reloadScene"
            >
              Reload scene
            </button>
          </div>
        </div>

        <form
          class="studio-controls"
          aria-label="Gradient settings"
          @submit.prevent
          @input="markEdited"
        >
          <div class="journal-controls-heading">
            <p class="studio-eyebrow">The editing desk</p>
            <h2>Make it your own.</h2>
          </div>
          <label class="studio-field" for="journal-preset">
            Starting preset
            <select id="journal-preset" :value="preset" @change="selectPreset">
              <option v-for="(item, name) in presets" :key="name" :value="name">
                {{ item.title }}
              </option>
            </select>
          </label>
          <fieldset>
            <legend>01 / Form &amp; material</legend>
            <label class="studio-field" for="journal-shape">
              Shape
              <select id="journal-shape" v-model="settings.type">
                <option value="plane">Plane</option>
                <option value="waterPlane">Water plane</option>
                <option value="sphere">Sphere</option>
              </select>
            </label>
            <label class="studio-field" for="journal-shader">
              Shader
              <select id="journal-shader" v-model="settings.shader">
                <option value="defaults">Default</option>
                <option value="positionMix">Position mix</option>
                <option value="cosmic">Cosmic</option>
                <option value="glass">Glass</option>
              </select>
            </label>
          </fieldset>
          <fieldset>
            <legend>02 / Three-color palette</legend>
            <div class="journal-color-inputs">
              <label class="studio-swatch" for="journal-color-1"
                ><input
                  id="journal-color-1"
                  v-model="settings.color1"
                  type="color"
                /><span>First</span></label
              >
              <label class="studio-swatch" for="journal-color-2"
                ><input
                  id="journal-color-2"
                  v-model="settings.color2"
                  type="color"
                /><span>Second</span></label
              >
              <label class="studio-swatch" for="journal-color-3"
                ><input
                  id="journal-color-3"
                  v-model="settings.color3"
                  type="color"
                /><span>Third</span></label
              >
            </div>
          </fieldset>
          <fieldset>
            <legend>03 / Atmosphere &amp; motion</legend>
            <label class="studio-field" for="journal-speed">
              <span class="journal-control-label"
                >Speed
                <output for="journal-speed">{{
                  Number(settings.uSpeed ?? 0).toFixed(2)
                }}</output></span
              >
              <input
                id="journal-speed"
                v-model.number="settings.uSpeed"
                type="range"
                min="0"
                max="2"
                step="0.05"
              />
            </label>
            <label class="studio-field" for="journal-light">
              Lighting
              <select id="journal-light" v-model="settings.lightType">
                <option value="3d" :disabled="settings.shader === 'glass'">
                  Studio ambient
                </option>
                <option value="env">HDR environment</option>
              </select>
            </label>
            <label class="studio-field" for="journal-hdr">
              HDR environment
              <select
                id="journal-hdr"
                v-model="settings.envPreset"
                :disabled="settings.lightType !== 'env'"
              >
                <option value="city">City · bright architectural</option>
                <option value="dawn">Dawn · soft outdoor</option>
                <option value="lobby">Lobby · warm interior</option>
              </select>
            </label>
            <label class="studio-field" for="journal-reflection">
              <span class="journal-control-label"
                >Surface polish
                <output for="journal-reflection">{{
                  Number(settings.reflection ?? 0).toFixed(2)
                }}</output></span
              >
              <input
                id="journal-reflection"
                v-model.number="settings.reflection"
                type="range"
                min="0"
                max="1"
                step="0.01"
              />
            </label>
            <label class="studio-toggle" for="journal-grain"
              ><input
                id="journal-grain"
                :checked="settings.grain !== 'off'"
                type="checkbox"
                @change="
                  settings.grain = ($event.target as HTMLInputElement).checked
                    ? 'on'
                    : 'off'
                "
              />
              Film grain</label
            >
          </fieldset>
          <div class="studio-actions">
            <button
              class="studio-button-secondary"
              type="button"
              @click="applyPreset(preset)"
            >
              Restore this preset
            </button>
          </div>
        </form>
      </section>

      <section
        class="studio-section journal-observation"
        aria-labelledby="observation-title"
      >
        <div>
          <p class="studio-eyebrow">A note on looking</p>
          <h2 id="observation-title" class="studio-section-heading">
            {{
              settings.shader === 'glass'
                ? 'Look through, not just at.'
                : 'Start with color. Stay for the light.'
            }}
          </h2>
        </div>
        <div class="studio-copy">
          <p v-if="settings.shader === 'glass'">
            Glass uses the SDK’s physical transmission material, real HDR
            reflections and opaque striped geometry behind the surface. Watch
            those lines bend. Plane and water plane are open sheets, not closed
            glass lenses.
          </p>
          <p v-else>
            Each preset brings its own camera, deformation, lighting and
            palette. Try a different form without changing its colors, then
            pause the movement to see where one hue gives way to another.
          </p>
          <p>
            Drag to orbit and scroll to zoom. Pausing holds shader time, not the
            camera: the existing render loop wakes for interaction, then rests
            again once the camera settles.
          </p>
          <p>
            The palette shown before hydration is an intentional CSS fallback,
            not proof of WebGL. “Rendered” is reported only after the real
            renderer draws the SDK scene; HDR readiness is tracked separately.
          </p>
          <button
            class="studio-button-secondary"
            type="button"
            @click="glassStudy"
          >
            Open the glass study ↗
          </button>
        </div>
      </section>

      <section
        id="preset-archive"
        class="studio-section"
        aria-labelledby="archive-title"
      >
        <div class="journal-archive-header">
          <div>
            <p class="studio-eyebrow">The collection / 10 Core originals</p>
            <h2 id="archive-title" class="studio-section-heading">
              Pick a starting point.
            </h2>
          </div>
          <p class="studio-copy">A complete scene, not just a color swatch.</p>
        </div>
        <div class="studio-cards journal-preset-grid">
          <button
            v-for="(item, name, index) in presets"
            :key="name"
            class="studio-card journal-preset-card"
            :class="{
              'journal-preset-selected': preset === name && !customized,
            }"
            type="button"
            :aria-pressed="preset === name && !customized"
            @click="applyPreset(name)"
          >
            <span
              class="journal-preset-art"
              :style="{
                background: `radial-gradient(ellipse at 20% 15%, ${item.props.color1}, transparent 70%), linear-gradient(135deg, ${item.props.color2}, ${item.props.color3})`,
              }"
              aria-hidden="true"
              ><span>{{ String(index + 1).padStart(2, '0') }}</span></span
            >
            <span class="journal-preset-caption"
              ><strong>{{ item.title }}</strong
              ><span>{{ item.props.type }} ↗</span></span
            >
          </button>
        </div>
      </section>

      <section
        class="studio-section journal-navigation"
        aria-labelledby="navigation-title"
      >
        <div>
          <p class="studio-eyebrow">No. 02 / Outside the canvas</p>
          <h2 id="navigation-title" class="studio-section-heading">
            The page continues.
          </h2>
          <p class="studio-copy">
            This journal is server-rendered, not a client-only canvas shell.
            Visit the field notes, then return: the renderer is released and a
            fresh scene takes over, with your settings kept in Nuxt state.
          </p>
        </div>
        <NuxtLink class="studio-button" to="/away"
          >Visit the field notes ↗</NuxtLink
        >
      </section>
      <footer class="studio-footer">
        <span>ShaderGradient / Scene Journal</span
        ><span>Nuxt SSR · public Vue SDK · Three r186</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.journal {
  --studio-accent: #e6ad83;
}
.journal :is(h1, .studio-section-heading) {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 400;
}
.journal h1 em {
  color: #e6ad83;
  font-weight: 400;
}
.journal-intro-links {
  margin-top: 1.6rem;
  font-size: 0.84rem;
}
.journal-intro-links a {
  color: #e6ad83;
  text-underline-offset: 0.3em;
}
.journal-intro-links span {
  color: #aeb8c1;
}
.journal-preview {
  height: clamp(440px, 54vw, 620px);
  min-height: 440px;
  isolation: isolate;
}
.journal-canvas {
  position: absolute !important;
  inset: 0;
  z-index: 1;
}
.journal-server-palette,
.journal-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.journal-server-palette {
  display: grid;
  place-items: center;
}
.journal-server-palette > span {
  font: italic 1.4rem Georgia, serif;
  color: #1e2328;
  text-shadow: 0 1px 12px #ffffff80;
}
.journal-preview-label {
  position: absolute;
  z-index: 2;
  bottom: 1rem;
  inset-inline: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  pointer-events: none;
}
.journal-preview-label span {
  border: 1px solid #ffffff30;
  border-radius: 2rem;
  padding: 0.45rem 0.7rem;
  background: #0c151ad9;
  color: #f2f2ed;
  font-size: 0.7rem;
}
.journal-status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #c7d0d7;
  font-size: 0.72rem;
}
.journal-status > span {
  width: 0.45rem;
  height: 0.45rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #b9c8b4;
}
.journal-status > .journal-status-error {
  background: #ffb8a2;
}
.journal-palette-strip {
  display: flex;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 2rem;
  border: 1px solid #ffffff25;
}
.journal-palette-strip span {
  width: 26px;
  height: 26px;
}
.journal-controls-heading h2 {
  margin: 0.4rem 0 1.3rem;
  font-family: Georgia, serif;
  font-size: 1.6rem;
  font-weight: 400;
}
.journal-color-inputs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
.journal-color-inputs label {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: #bec7cf;
}
.journal-color-inputs input {
  width: 100%;
  min-height: 46px;
}
.journal-control-label {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
.journal-control-label output {
  color: #e6ad83;
  font-variant-numeric: tabular-nums;
}
.journal-error {
  margin: 1rem;
}
.journal-observation {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  padding-block: 3rem;
  border-block: 1px solid #ffffff18;
}
.journal-observation h2 {
  max-width: 12ch;
}
.journal-observation .studio-copy p {
  margin-top: 0;
}
.journal-archive-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.journal-preset-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.journal .journal-preset-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  font: inherit;
}
.journal-preset-art {
  display: flex;
  align-items: flex-end;
  width: 100%;
  aspect-ratio: 1.3;
  padding: 0.8rem;
}
.journal-preset-art > span {
  font: italic 2rem Georgia, serif;
  color: #15202f;
  text-shadow: 0 1px 12px #ffffff50;
}
.journal-preset-caption {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  padding: 1rem;
}
.journal-preset-caption strong {
  font-size: 0.9rem;
}
.journal-preset-caption > span {
  color: #b4c0c9;
  font-size: 0.7rem;
}
.journal .journal-preset-selected {
  border-color: #e6ad83;
  box-shadow: 0 0 0 1px #e6ad83;
}
.journal-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  border-top: 1px solid #ffffff18;
  padding-top: 3rem;
}
.journal-navigation .studio-copy {
  max-width: 65ch;
}
.journal-navigation > a {
  flex-shrink: 0;
}
@media (max-width: 1000px) {
  .journal-preset-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .journal-preview {
    height: 420px;
    min-height: 360px;
  }
  .journal-observation {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .journal-preset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .journal-navigation {
    align-items: stretch;
    flex-direction: column;
  }
  .journal-navigation > a {
    text-align: center;
  }
}
</style>
