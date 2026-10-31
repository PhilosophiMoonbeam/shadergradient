import * as THREE from 'three'
import { baseProps } from '../scenarios.mjs'

// Observation only: retain each adapter's renderer, clock, material and scheduler.
// This patch is scoped to this fresh browser context; no production source changes.
const observations = { renders: 0, samples: [], camera: [], errors: [], latest: null }
const serialize = (value) => {
  if (value?.isColor) return { r: value.r, g: value.g, b: value.b }
  if (value?.toArray) return value.toArray()
  if (Array.isArray(value)) return value.map(serialize)
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
    || value === null ? value : undefined
}
const beforeRender = THREE.Mesh.prototype.onBeforeRender
THREE.Mesh.prototype.onBeforeRender = function (renderer, scene, camera, geometry, material, ...rest) {
  beforeRender.call(this, renderer, scene, camera, geometry, material, ...rest)
  if (!material.userData?.uTime) return
  const gl = renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const uniforms = Object.fromEntries(Object.entries(material.userData)
    .filter(([, uniform]) => uniform && 'value' in uniform)
    .map(([name, uniform]) => [name, serialize(uniform.value)]))
  observations.renders++
  observations.latest = {
    time: performance.now(), uniforms,
    geometry: { type: geometry.type, parameters: geometry.parameters,
      vertices: geometry.attributes.position?.count, indices: geometry.index?.count },
    material: { type: material.type, wireframe: material.wireframe,
      roughness: material.roughness, metalness: material.metalness,
      transmission: material.transmission, transparent: material.transparent },
    transform: { position: this.position.toArray(), rotation: this.rotation.toArray(), scale: this.scale.toArray() },
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, fov: camera.fov },
    environment: Boolean(scene.environment),
    renderer: { revision: THREE.REVISION, outputColorSpace: renderer.outputColorSpace,
      toneMapping: renderer.toneMapping, pixelRatio: renderer.getPixelRatio(),
      width: renderer.domElement.width, height: renderer.domElement.height,
      backend: gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
      vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      device: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) },
  }
  observations.samples.push({ at: performance.now(), uTime: uniforms.uTime })
  if (observations.samples.length > 512) observations.samples.shift()
}
const adapter = new URLSearchParams(location.search).get('adapter')
const library = await import('@baseline/adapter')
const onCameraUpdate = (value) => {
  observations.camera.push({ at: performance.now(), value })
  if (observations.camera.length > 128) observations.camera.shift()
}
const onError = (value) => observations.errors.push(String(value?.stack || value))
let currentProps
let inputs
const canvasProps = { style: { width: '480px', height: '320px' },
  pixelDensity: 1, lazyLoad: false, pointerEvents: 'auto', envBasePath: '/baseline-hdr/' }
if (!['react', 'vue'].includes(adapter)) throw new Error(`Unknown baseline adapter: ${adapter}`)
// The server resolves exactly one host module. Vite never analyzes dormant
// imports from the other framework under the selected dependency tuple.
const { createHost } = await import('@baseline/host')
const render = createHost({ library, canvasProps, onCameraUpdate, onError })
window.baselineFixture = {
  exports: Object.keys(library).sort(),
  observations,
  async configure(scenario) {
    const preset = library.presets[scenario.preset || 'halo']
    if (!preset?.props) throw new Error(`Missing actual preset: ${scenario.preset || 'halo'}`)
    currentProps = { ...preset.props, ...(scenario.exactPreset ? {} : baseProps), ...scenario.props }
    if (scenario.queryFromProps) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(currentProps)) {
        if (key !== 'control' && key !== 'urlString' && value !== undefined && value !== null)
          query.set(key, String(value))
      }
      currentProps = { ...currentProps, control: 'query', urlString: `?${query}` }
    }
    if (scenario.hdrMode === 'live') delete canvasProps.envBasePath
    else canvasProps.envBasePath = '/baseline-hdr/'
    inputs = structuredClone({ preset: scenario.preset || 'halo', props: currentProps, canvas: canvasProps })
    await render(currentProps)
  },
  async update(props) { currentProps = { ...currentProps, ...props }; await render(currentProps) },
  snapshot() { return structuredClone({ inputs, exports: this.exports, ...observations }) },
}
