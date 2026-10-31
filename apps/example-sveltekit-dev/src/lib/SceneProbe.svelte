<script lang="ts">
  import { useStage, useTask, useThrelte } from '@threlte/core'
  import {
    BufferGeometry,
    LineSegments,
    Material,
    Mesh,
    Texture,
    type Object3D,
  } from 'three'
  import { untrack } from 'svelte'
  import type { FixtureObserver, SceneProbe } from './fixture'

  let {
    observer,
    kind = 'native',
  }: { observer: FixtureObserver; kind?: 'native' | 'host' } = $props()
  const owner = untrack(() => observer)
  const target = untrack(() => kind)
  const context = useThrelte()
  const renderer = context.renderer
  const scene = context.scene
  const probe: SceneProbe = {
    scene,
    renderer,
    camera: () => context.camera.current,
    invalidate: context.invalidate,
    frames: 0,
    frameWidth: 0,
    frameHeight: 0,
    initialCameraUuid: context.camera.current.uuid,
    initialEnvironmentUuid: scene.environment?.uuid ?? null,
  }
  const release = owner.connect(probe, target)
  const cleanups: (() => void)[] = []
  const watched = new WeakSet<object>()
  const watchedMeshes = new WeakSet<Object3D>()
  function resource(resource: BufferGeometry | Material | Texture) {
    if (watched.has(resource)) return
    watched.add(resource)
    const disposed = () => {
      if (resource instanceof BufferGeometry) owner.counters.geometryDisposals++
      else if (resource instanceof Material) owner.counters.materialDisposals++
      else owner.counters.textureDisposals++
    }
    resource.addEventListener('dispose', disposed)
    cleanups.push(() => resource.removeEventListener('dispose', disposed))
  }
  function observe(object: Object3D) {
    if (
      (object instanceof Mesh || object instanceof LineSegments) &&
      !watchedMeshes.has(object)
    ) {
      watchedMeshes.add(object)
      resource(object.geometry)
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      for (const material of materials) resource(material)
      // Resource swaps happen before the old resource is disposed. Instance accessors
      // attach observation synchronously, without touching Three prototypes.
      for (const key of ['geometry', 'material'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key)!
        let current = object[key]
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: () => current,
          set(value) {
            current = value
            if (Array.isArray(value)) {
              for (const material of value) resource(material)
            } else resource(value)
          },
        })
        cleanups.push(() =>
          Object.defineProperty(object, key, { ...descriptor, value: current })
        )
      }
    }
    for (const child of object.children) observe(child)
  }
  const originalAdd = scene.add
  const wrappedAdd: typeof scene.add = function (
    this: typeof scene,
    ...objects
  ) {
    for (const object of objects) observe(object)
    return originalAdd.apply(this, objects)
  }
  scene.add = wrappedAdd
  for (const object of scene.children) observe(object)
  const environmentDescriptor = Object.getOwnPropertyDescriptor(
    scene,
    'environment'
  )!
  let environment = scene.environment
  if (environment) resource(environment)
  Object.defineProperty(scene, 'environment', {
    configurable: true,
    enumerable: environmentDescriptor.enumerable,
    get: () => environment,
    set(value) {
      environment = value
      if (value) resource(value)
    },
  })
  let pendingScreenRender = false
  const originalRender = renderer.render
  const wrappedRender: typeof renderer.render = function (
    this: typeof renderer,
    renderedScene,
    camera
  ) {
    owner.counters.rendererCalls++
    originalRender.call(this, renderedScene, camera)
    if (this.getRenderTarget() === null) pendingScreenRender = true
  }
  renderer.render = wrappedRender
  const originalDispose = renderer.dispose
  const wrappedDispose = () => {
    owner.counters.rendererDisposals++
    try {
      originalDispose.call(renderer)
    } finally {
      if (renderer.render === wrappedRender) renderer.render = originalRender
      if (renderer.dispose === wrappedDispose)
        renderer.dispose = originalDispose
    }
  }
  // Threlte 8.6.1 reads renderer.dispose at teardown (not a captured bound method).
  // Keep this instance wrapper through child destruction until actual disposal.
  renderer.dispose = wrappedDispose
  const contextLost = () => {
    owner.counters.contextLosses++
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost)
  const post = useStage(Symbol('fixture-after-final-composition'), {
    after: context.renderStage,
  })
  useTask(
    () => {
      if (!pendingScreenRender) return
      pendingScreenRender = false
      owner.complete(probe)
    },
    { stage: post, autoInvalidate: false }
  )
  $effect.pre(() => () => {
    release()
    if (scene.add === wrappedAdd) scene.add = originalAdd
    // Native helper teardown may follow this sibling's teardown in the same flush.
    queueMicrotask(() => {
      Object.defineProperty(scene, 'environment', {
        ...environmentDescriptor,
        value: environment,
      })
      for (const cleanup of cleanups) cleanup()
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      context.scheduler.removeStage(post)
    })
  })
</script>
