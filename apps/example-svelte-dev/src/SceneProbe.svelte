<script lang="ts">
  import { useStage, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { BufferGeometry, Material, Mesh, Texture, Vector2 } from 'three'
  import type { Object3D } from 'three'
  import type { FixtureController, SceneProbe } from './fixture'

  let {
    controller,
    channel,
  }: { controller: FixtureController; channel: 'main' | 'external' } = $props()
  const threlte = useThrelte()
  const renderer = threlte.renderer
  const scene = threlte.scene
  const counts = untrack(() => controller.counters)
  const observed = new WeakSet<object>()
  const cleanup = new Set<() => void>()
  const size = new Vector2()
  let renderSerial = 0
  let publishedSerial = 0
  let lost = false
  let disposed = false
  const probe: SceneProbe = {
    scene,
    renderer,
    dom: threlte.dom,
    camera: () => threlte.camera.current,
    invalidate: threlte.invalidate,
    frames: 0,
    width: 0,
    height: 0,
    bufferWidth: 0,
    bufferHeight: 0,
    dpr: 0,
    initialCameraUuid: threlte.camera.current.uuid,
    initialEnvironmentUuid: scene.environment?.uuid ?? null,
    initialRendererIdentity: untrack(() => controller.identity(renderer)),
  }
  function observeResource(resource: BufferGeometry | Material | Texture) {
    if (observed.has(resource)) return
    observed.add(resource)
    const onDispose = () => {
      if (resource instanceof BufferGeometry) counts.geometryDisposals += 1
      else if (resource instanceof Material) counts.materialDisposals += 1
      else counts.textureDisposals += 1
      resource.removeEventListener('dispose', onDispose)
      cleanup.delete(remove)
    }
    const remove = () => resource.removeEventListener('dispose', onDispose)
    resource.addEventListener('dispose', onDispose)
    cleanup.add(remove)
  }
  function observeObject(object: Object3D) {
    if (!(object instanceof Mesh) && object.type !== 'AxesHelper') return
    const renderable = object as Mesh
    if (renderable.geometry) observeResource(renderable.geometry)
    const materials = renderable.material
    if (Array.isArray(materials)) {
      for (const material of materials) observeResource(material)
    } else if (materials) observeResource(materials)
  }
  function scan() {
    scene.traverse(observeObject)
    if (scene.environment) observeResource(scene.environment)
  }
  const originalAdd = scene.add
  const instrumentedAdd: typeof scene.add = function (
    this: typeof scene,
    ...objects
  ) {
    for (const object of objects) object.traverse(observeObject)
    return originalAdd.apply(this, objects)
  }
  scene.add = instrumentedAdd
  // Installed before the Gradient sibling constructs/attaches measured resources.
  // Replacements are caught before their first draw; no arrays/snapshots in frames.
  const originalRender = renderer.render
  const instrumentedRender: typeof renderer.render = function (
    this: typeof renderer,
    renderScene,
    camera
  ) {
    scan()
    originalRender.call(this, renderScene, camera)
    counts.rendererCalls += 1
    if (!this.getContext().isContextLost()) renderSerial += 1
  }
  renderer.render = instrumentedRender
  const originalDispose = renderer.dispose
  const originalForceLoss = renderer.forceContextLoss
  function contextLost() {
    if (lost) return
    lost = true
    counts.contextLosses += 1
    controller.notify()
  }
  function contextRestored() {
    lost = false
    controller.notify()
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost)
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored)
  const instrumentedForceLoss: typeof renderer.forceContextLoss = function (
    this: typeof renderer
  ) {
    originalForceLoss.call(this)
    if (this.getContext().isContextLost()) contextLost()
  }
  renderer.forceContextLoss = instrumentedForceLoss
  // Exact Threlte8.6.1 renderer context calls renderer.dispose() dynamically in
  // its cleanup (not a constructor-time captured bound function). Keep this
  // instance wrapper through framework teardown; restore it only after that call.
  const instrumentedDispose: typeof renderer.dispose = function (
    this: typeof renderer
  ) {
    counts.rendererDisposals += 1
    try {
      originalDispose.call(this)
    } finally {
      disposed = true
      if (this.dispose === instrumentedDispose) this.dispose = originalDispose
      queueMicrotask(() => {
        for (const remove of cleanup) remove()
        cleanup.clear()
        this.domElement.removeEventListener('webglcontextlost', contextLost)
        this.domElement.removeEventListener(
          'webglcontextrestored',
          contextRestored
        )
        if (this.forceContextLoss === instrumentedForceLoss)
          this.forceContextLoss = originalForceLoss
      })
      controller.notify()
    }
  }
  renderer.dispose = instrumentedDispose
  const release = untrack(() => controller.attach(channel, probe))
  const stage = useStage(Symbol('fixture-completed-output'), {
    after: threlte.renderStage,
  })
  const task = stage.createTask(Symbol('fixture-completed-output'), () => {
    if (
      disposed ||
      publishedSerial === renderSerial ||
      renderer.getContext().isContextLost() ||
      !controller.frameEligible(channel)
    )
      return
    publishedSerial = renderSerial
    renderer.getSize(size)
    probe.width = size.x
    probe.height = size.y
    probe.bufferWidth = renderer.domElement.width
    probe.bufferHeight = renderer.domElement.height
    probe.dpr = renderer.getPixelRatio()
    probe.frames += 1
    counts.completedFrames += 1
    if (channel === 'main') controller.setFallback(null)
    controller.notify()
  })
  $effect.pre(() => () => {
    stage.removeTask(task)
    release()
    if (scene.add === instrumentedAdd) scene.add = originalAdd
    if (renderer.render === instrumentedRender) renderer.render = originalRender
    // Resource listeners survive sibling teardown and remove themselves on each
    // real disposal; final renderer cleanup releases remaining borrowed refs.
  })
</script>
