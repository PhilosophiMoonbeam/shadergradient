<script lang="ts">
  import { Canvas, T } from '@threlte/core'
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    presets,
  } from '@shadergradient/svelte'
  import type { GradientSettingsInput } from '@shadergradient/svelte'
  import { onMount, tick, untrack } from 'svelte'
  import { WebGLRenderer } from 'three'
  import BindingSceneProbe from './BindingSceneProbe.svelte'
  import BindingThrowChild from './BindingThrowChild.svelte'
  import { createBindingController } from './binding-probe'
  import type { BindingMode, BindingProbe } from './binding-probe'

  let { mode }: { mode: BindingMode } = $props()
  // A selected fixture is a per-page instance, never shared across SSR requests.
  const controller = untrack(() => createBindingController(mode))
  let throwChild = $state(true)
  let preserveDrawingBuffer = $state(false)
  let gradientMounted = $state(true)
  const gradient: GradientSettingsInput = {
    ...presets.halo.props,
    control: 'props',
    urlString: '',
    lightType: '3d',
    animate: 'off',
    uTime: 2,
    grain: 'on',
    enableTransition: false,
    zoomOut: false,
  }
  const probe: BindingProbe = {
    snapshot: controller.snapshot,
    async recoverInitialization() {
      if (mode !== 'initialization')
        throw new Error(
          'Initialization recovery requires the initialization fixture.'
        )
      const previous = controller.snapshot().rendererId
      throwChild = false
      await tick()
      // Only the documented creation option recreates the existing public Canvas.
      // Removing/readding that Canvas would hide a retained old lifecycle binding.
      const replacement = controller.nextRenderer(previous)
      preserveDrawingBuffer = true
      await tick()
      const scene = await replacement
      await scene.frame()
    },
    async setHostAutoRender(value) {
      controller.scene().setAutoRender(value)
      await tick()
    },
    async frame() {
      await tick()
      return controller.scene().frame()
    },
    async removeGradient() {
      gradientMounted = false
      await tick()
    },
  }
  function createHostRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    })
  }
  onMount(() => {
    window.__shadergradientBindingProbe = probe
    return () => {
      if (window.__shadergradientBindingProbe === probe)
        delete window.__shadergradientBindingProbe
      controller.dispose()
    }
  })
</script>

<section
  data-testid="binding-regression"
  aria-label="Binding regression fixture"
>
  <h1>Canvas binding: {mode}</h1>
  <div class="binding-canvas">
    {#if mode === 'initialization'}
      <ShaderGradientCanvas
        {preserveDrawingBuffer}
        lazyLoad={false}
        respectReducedMotion={false}
        style="width:100%;height:100%;"
        onError={controller.error}
      >
        {#snippet fallback(state)}
          <p data-testid="binding-fallback">{state.status}</p>
        {/snippet}
        <BindingSceneProbe {controller} />
        {#if throwChild}
          <BindingThrowChild />
        {:else}
          <ShaderGradient {...gradient} onError={controller.error} />
        {/if}
      </ShaderGradientCanvas>
    {:else}
      <Canvas
        createRenderer={createHostRenderer}
        renderMode="on-demand"
        dpr={1}
        shadows={false}
      >
        <BindingSceneProbe {controller} />
        <T.PerspectiveCamera makeDefault position={[0, 0, 8]} fov={50} />
        <T.Mesh name="binding-consumer-owned-host-box" rotation={[0.3, 0.5, 0]}>
          <T.BoxGeometry args={[2.2, 2.2, 2.2]} />
          <T.MeshBasicMaterial color="#f5d66f" />
        </T.Mesh>
        {#if gradientMounted}
          <ShaderGradient {...gradient} onError={controller.error} />
        {/if}
      </Canvas>
    {/if}
  </div>
</section>

<style>
  .binding-canvas {
    width: 480px;
    height: 320px;
    max-width: 100%;
  }
</style>
