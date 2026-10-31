<script lang="ts">
  import { untrack } from 'svelte'
  import { useThrelte } from '@threlte/core'
  import { useCanvasLifecycle } from './canvas-context.svelte.js'
  import { useSceneContext } from './scene-context.svelte.js'
  import {
    resolveExternalSettings,
    resolveGradientSettings,
  } from './settings.js'
  import { createAnimation } from './animation.svelte.js'
  import Mesh from './Mesh.svelte'
  import Camera from './Camera.svelte'
  import Lights from './Lights.svelte'
  import Grain from './Grain.svelte'
  import Axes from './Axes.svelte'
  import type {
    CanvasLifecycleContext,
    EnvironmentState,
    GradientError,
    ManagedSceneLease,
    MeshHandle,
    ShaderGradientProps,
  } from './types.js'

  let props: ShaderGradientProps = $props()
  const managed = $derived(props.mode !== 'external')
  // Derived values are lazy: external mode never resolves managed settings
  // unless a retiring managed helper still needs its valid settings getter.
  const managedSettings = $derived(resolveGradientSettings(props))
  const settings = $derived(
    managed ? managedSettings : resolveExternalSettings(props)
  )

  function initializeLifecycle(): CanvasLifecycleContext {
    try {
      return useCanvasLifecycle()
    } catch (cause) {
      props.onError?.({
        code: 'missing-context',
        message:
          'ShaderGradient must be rendered inside ShaderGradientCanvas or a Threlte Canvas.',
        cause,
      })
      throw cause
    }
  }
  const lifecycle = initializeLifecycle()
  const binding = useThrelte()
  const scene = useSceneContext(binding.scene)
  const owner = Symbol('ShaderGradient managed scene')
  let lease = $state.raw<ManagedSceneLease>()
  type Helper = { dispose(): void }
  type ManagedHelpers = {
    lease: ManagedSceneLease
    camera: Helper
    lights: Helper
    grain: Helper
    axes: Helper
  }
  let cameraComponent = $state.raw<Helper>()
  let lightsComponent = $state.raw<Helper>()
  let grainComponent = $state.raw<Helper>()
  let axesComponent = $state.raw<Helper>()
  let helpers: ManagedHelpers | undefined

  $effect(() => {
    const owned = lease
    const camera = cameraComponent
    const lights = lightsComponent
    const grain = grainComponent
    const axes = axesComponent
    if (owned && camera && lights && grain && axes) {
      // Keep capabilities after bind:this is cleared during boundary teardown.
      helpers = { lease: owned, camera, lights, grain, axes }
    }
  })
  let mesh = $state.raw<MeshHandle>()

  function report(error: GradientError) {
    if (props.onError) props.onError(error)
    else lifecycle.reportError(error)
  }

  const readSettings = () => settings
  const readManagedSettings = () => managedSettings
  const getCamera = () => binding.camera.current
  const setCamera = (camera: typeof binding.camera.current) =>
    binding.camera.set(camera)
  const readErrorCallback = () => report
  const readCameraCallback = () =>
    props.mode === 'external' ? undefined : props.onCameraUpdate
  const environmentChanged = (state: EnvironmentState) => {
    if (lease?.active) lifecycle.setEnvironmentState(lease.owner, state)
  }
  const readEnvironmentCallback = () => environmentChanged

  const animation = createAnimation({
    settings: readSettings,
    mesh: () => mesh,
    lifecycle,
    enabled: () => !managed || lease?.active === true,
  })
  $effect.pre(() => animation.dispose)

  function releaseOwned(owned: ManagedSceneLease) {
    if (!owned.active) return
    try {
      lifecycle.setEnvironmentState(owned.owner, undefined)
    } finally {
      owned.release()
      if (lease === owned) lease = undefined
    }
  }

  // Acquisition precedes the first scheduler frame. Explicit helper disposal,
  // not Svelte sibling destruction order, precedes relinquishing scene ownership.
  $effect(() => {
    if (!managed) return
    const owned = untrack(() => {
      let acquired: ManagedSceneLease
      try {
        acquired = scene.acquireManaged(owner)
      } catch (cause) {
        report({
          code: 'duplicate-managed',
          message:
            cause instanceof Error
              ? cause.message
              : 'The scene already has a managed ShaderGradient.',
          cause,
        })
        throw cause
      }
      try {
        lifecycle.setEnvironmentState(acquired.owner, {
          status: managedSettings.lightType === 'env' ? 'loading' : 'disabled',
        })
        return acquired
      } catch (cause) {
        try {
          lifecycle.setEnvironmentState(acquired.owner, undefined)
        } finally {
          acquired.release()
        }
        throw cause
      }
    })
    lease = owned
    let retired = false
    const retire = () => {
      if (retired) return
      retired = true
      const created = helpers?.lease === owned ? helpers : undefined
      if (!created) {
        // A failed initial branch can precede bind:this. Its remaining child
        // destructors finish in this turn, before the reservation is released.
        queueMicrotask(() => releaseOwned(owned))
        return
      }
      helpers = undefined
      try {
        try {
          created.grain.dispose()
        } finally {
          try {
            created.axes.dispose()
          } finally {
            try {
              created.lights.dispose()
            } finally {
              created.camera.dispose()
            }
          }
        }
      } finally {
        releaseOwned(owned)
      }
    }
    return retire
  })
</script>

<Mesh {settings} {lifecycle} onReady={(value) => (mesh = value)} />
{#if managed && lease}
  <Camera
    bind:this={cameraComponent}
    settings={readManagedSettings}
    {lifecycle}
    {lease}
    {getCamera}
    {setCamera}
    onCameraUpdate={readCameraCallback}
    onError={readErrorCallback}
  />
  <Lights
    bind:this={lightsComponent}
    settings={readManagedSettings}
    {lifecycle}
    {lease}
    onState={readEnvironmentCallback}
    onError={readErrorCallback}
  />
  <Grain
    bind:this={grainComponent}
    settings={readManagedSettings}
    {lifecycle}
    {lease}
    camera={getCamera}
  />
  <Axes
    bind:this={axesComponent}
    enabled={managedSettings.toggleAxis}
    {lifecycle}
    {lease}
  />
{/if}
