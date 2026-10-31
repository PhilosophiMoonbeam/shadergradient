import { mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import HmrApp from './HmrApp.svelte'
import { marker, color1 } from './hot-state.js'

// A direct dependency accept is a real Vite HMR boundary. Updating the store
// propagates ordinary public Gradient props without replacing the Canvas tree.
// https://vite.dev/guide/api-hmr#hot-accept-deps-cb
const hotState = writable({ marker, color1 })
const identities = new WeakMap()
const errors = []
let nextIdentity = 1
let currentProbe = null
let alive = true
function identity(object) {
  let value = identities.get(object)
  if (value === undefined) {
    value = nextIdentity++
    identities.set(object, value)
  }
  return value
}
function recordError(cause) {
  errors.push({
    code: String(cause?.code ?? 'consumer'),
    message: String(cause?.message ?? cause),
  })
  if (errors.length > 100) errors.shift()
}
const api = {
  snapshot() {
    const probe = currentProbe
    return {
      marker: get(hotState).marker,
      color1: probe?.readColor() ?? '',
      canvasIdentity: probe ? identity(probe.renderer.domElement) : 0,
      rendererIdentity: probe ? identity(probe.renderer) : 0,
      meshUuid: probe?.mesh()?.uuid ?? '',
      frames: probe?.frames ?? 0,
      errors: errors.map((error) => ({ ...error })),
    }
  },
  refs() {
    if (!currentProbe) throw new Error('HMR consumer has no live Threlte scene')
    return currentProbe.refs
  },
}
const controller = {
  error: recordError,
  attach(probe) {
    if (currentProbe)
      throw new Error('HMR consumer acquired a second live scene')
    currentProbe = probe
    return () => {
      if (currentProbe === probe) currentProbe = null
      if (window.gradientHmr === api) delete window.gradientHmr
    }
  },
  ready() {
    // Publish only after an actual completed render so initial snapshots contain
    // the real native mesh/material, not construction-time placeholders.
    if (alive && currentProbe && window.gradientHmr !== api)
      window.gradientHmr = api
  },
}
const target = document.getElementById('app')
if (!target) throw new Error('Missing HMR consumer mount target')
const app = mount(HmrApp, { target, props: { hotState, controller } })
function onError(event) {
  recordError(event.error ?? new Error(event.message))
}
function onRejection(event) {
  recordError(event.reason)
}
window.addEventListener('error', onError)
window.addEventListener('unhandledrejection', onRejection)

if (import.meta.hot) {
  import.meta.hot.accept('./hot-state.js', (updated) => {
    if (!alive || !updated) return
    hotState.set({ marker: updated.marker, color1: updated.color1 })
  })
  import.meta.hot.dispose(() => {
    alive = false
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    if (window.gradientHmr === api) delete window.gradientHmr
    void unmount(app)
  })
}
