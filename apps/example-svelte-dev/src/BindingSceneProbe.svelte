<script lang="ts">
  import { useStage, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import type {
    BindingController,
    BindingFrame,
    BindingScene,
  } from './binding-probe'

  let { controller }: { controller: BindingController } = $props()
  const threlte = useThrelte()
  const renderer = threlte.renderer
  const mainScene = threlte.scene
  const owner = untrack(() => controller)
  let sceneRenders = 0
  let frameStart = 0
  let disposed = false
  let requested:
    | {
        resolve(frame: BindingFrame): void
        reject(error: Error): void
        started: boolean
      }
    | undefined
  const scene: BindingScene = {
    renderer,
    autoRender: () => threlte.autoRender.current,
    setAutoRender: (value) => threlte.autoRender.set(value),
    frame() {
      if (disposed)
        return Promise.reject(new Error('The renderer was disposed.'))
      if (requested)
        return Promise.reject(new Error('A binding frame is already pending.'))
      const { promise, resolve, reject } = Promise.withResolvers<BindingFrame>()
      requested = { resolve, reject, started: false }
      threlte.invalidate()
      return promise
    },
  }
  // Install synchronously: the following sibling deliberately throws before
  // onMount or an effect can run in the initialization-failure scenario.
  const originalRender = renderer.render
  const instrumentedRender: typeof renderer.render = function (
    this: typeof renderer,
    renderScene,
    camera
  ) {
    originalRender.call(this, renderScene, camera)
    if (renderScene === mainScene) sceneRenders += 1
  }
  renderer.render = instrumentedRender
  const originalDispose = renderer.dispose
  const instrumentedDispose: typeof renderer.dispose = function (
    this: typeof renderer
  ) {
    owner.disposed(renderer)
    try {
      originalDispose.call(this)
    } finally {
      disposed = true
      requested?.reject(
        new Error('The renderer was disposed before its frame.')
      )
      requested = undefined
      // Retain the forwarding wrapper so repeated actual disposals remain visible.
      if (this.render === instrumentedRender) this.render = originalRender
    }
  }
  renderer.dispose = instrumentedDispose
  const release = owner.attach(scene)
  const before = useStage(Symbol('binding-frame-start'), {
    after: threlte.mainStage,
    before: threlte.renderStage,
  })
  before.createTask(Symbol('binding-frame-start'), () => {
    frameStart = sceneRenders
    if (requested && threlte.shouldRender()) requested.started = true
  })
  const after = useStage(Symbol('binding-frame-completed'), {
    after: threlte.renderStage,
  })
  after.createTask(Symbol('binding-frame-completed'), () => {
    if (disposed || renderer.getContext().isContextLost()) return
    const delta = sceneRenders - frameStart
    if (delta > 0) owner.completed(scene)
    if (!requested?.started) return
    const pending = requested
    requested = undefined
    pending.resolve({
      sceneRenders: delta,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    })
  })
  $effect.pre(() => () => {
    threlte.scheduler.removeStage(before)
    threlte.scheduler.removeStage(after)
    release()
    requested?.reject(new Error('The scene was removed before its frame.'))
    requested = undefined
    if (renderer.render === instrumentedRender) renderer.render = originalRender
    // Do not restore dispose here: Threlte owns the actual renderer disposal.
  })
</script>
