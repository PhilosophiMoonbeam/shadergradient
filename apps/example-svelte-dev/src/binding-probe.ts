import type { GradientError } from '@shadergradient/svelte'
import type { WebGLRenderer } from 'three'

export type BindingMode = 'initialization' | 'render-path'
export interface BindingSnapshot {
  mode: BindingMode
  phase: 'loading' | 'initial-failure' | 'ready'
  failures: number
  rendererId: string | null
  rendererDisposals: Record<string, number>
  hostAutoRender: boolean | null
}
export interface BindingFrame {
  sceneRenders: number
  width: number
  height: number
}
export interface BindingProbe {
  snapshot(): BindingSnapshot
  recoverInitialization(): Promise<void>
  setHostAutoRender(value: boolean): Promise<void>
  frame(): Promise<BindingFrame>
  removeGradient(): Promise<void>
}
export interface BindingScene {
  renderer: WebGLRenderer
  autoRender(): boolean
  setAutoRender(value: boolean): void
  frame(): Promise<BindingFrame>
}

export interface BindingController {
  identity(renderer: WebGLRenderer): string
  snapshot(): BindingSnapshot
  error(error: GradientError): void
  disposed(renderer: WebGLRenderer): void
  attach(scene: BindingScene): () => void
  completed(scene: BindingScene): void
  scene(): BindingScene
  nextRenderer(previous: string | null): Promise<BindingScene>
  dispose(): void
}

export function bindingMode(search: string): BindingMode | null {
  const mode = new URLSearchParams(search).get('binding-regression')
  return mode === 'initialization' || mode === 'render-path' ? mode : null
}
export function createBindingController(mode: BindingMode): BindingController {
  const identities = new WeakMap<WebGLRenderer, string>()
  const failedRenderers = new WeakSet<WebGLRenderer>()
  const rendererDisposals: Record<string, number> = {}
  let nextIdentity = 0
  let current: BindingScene | undefined
  let lastRendererId: string | null = null
  let phase: BindingSnapshot['phase'] = 'loading'
  let failures = 0
  const attachments = new Set<{
    previous: string | null
    resolve(scene: BindingScene): void
    reject(error: Error): void
  }>()

  function identity(renderer: WebGLRenderer) {
    let id = identities.get(renderer)
    if (!id) {
      id = `binding-renderer-${++nextIdentity}`
      identities.set(renderer, id)
      rendererDisposals[id] = 0
    }
    return id
  }

  return {
    identity,
    snapshot(): BindingSnapshot {
      return {
        mode,
        phase,
        failures,
        rendererId: lastRendererId,
        rendererDisposals: { ...rendererDisposals },
        hostAutoRender: current?.autoRender() ?? null,
      }
    },
    error(error: GradientError) {
      failures += 1
      phase = 'initial-failure'
      if (current) failedRenderers.add(current.renderer)
      for (const waiter of attachments)
        waiter.reject(new Error(error.message, { cause: error }))
      attachments.clear()
    },
    disposed(renderer: WebGLRenderer) {
      rendererDisposals[identity(renderer)] += 1
      if (current?.renderer === renderer) current = undefined
    },
    attach(scene: BindingScene) {
      current = scene
      lastRendererId = identity(scene.renderer)
      for (const waiter of attachments) {
        if (waiter.previous === lastRendererId) continue
        attachments.delete(waiter)
        waiter.resolve(scene)
      }
      return () => {
        if (current === scene) current = undefined
      }
    },
    completed(scene: BindingScene) {
      if (current === scene && !failedRenderers.has(scene.renderer))
        phase = 'ready'
    },
    scene() {
      if (!current) throw new Error('The binding fixture has no mounted scene.')
      return current
    },
    nextRenderer(previous: string | null): Promise<BindingScene> {
      if (current && identity(current.renderer) !== previous)
        return Promise.resolve(current)
      const { promise, resolve, reject } = Promise.withResolvers<BindingScene>()
      attachments.add({ previous, resolve, reject })
      return promise
    },
    dispose() {
      for (const waiter of attachments)
        waiter.reject(new Error('The binding fixture was removed.'))
      attachments.clear()
      current = undefined
    },
  }
}

declare global {
  interface Window {
    __shadergradientBindingProbe?: BindingProbe
  }
}
