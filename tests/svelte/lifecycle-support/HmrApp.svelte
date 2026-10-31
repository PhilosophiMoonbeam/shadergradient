<script>
  import {
    ShaderGradientCanvas as Canvas,
    ShaderGradient as Gradient,
  } from '@shadergradient/svelte'
  import HmrProbe from './HmrProbe.svelte'

  let { hotState, controller } = $props()
</script>

<main>
  <h1>Public native gradient: real dependency HMR</h1>
  <p>
    The same paused scene receives an edited public color prop through Vite.
  </p>
  <p data-testid="hmr-marker">Module marker: {$hotState.marker}</p>
  <section aria-label="Hot-updated gradient" data-testid="hmr-surface">
    <svelte:boundary onerror={controller.error}>
      <Canvas
        pixelDensity={1}
        lazyLoad={false}
        fov={45}
        preserveDrawingBuffer={true}
        style="width:100%;height:100%;"
        onError={controller.error}
      >
        {#snippet fallback(state)}
          <p class="fallback" data-native-fallback={state.status}>
            Gradient {state.status}. This dimensioned preview remains readable
            if WebGL is unavailable.
          </p>
        {/snippet}
        <HmrProbe {controller} />
        <Gradient
          control="props"
          urlString=""
          animate="off"
          uTime={4}
          grain="off"
          shader="defaults"
          type="plane"
          color1={$hotState.color1}
          color2="#dbba95"
          color3="#d0bce1"
          positionX={0}
          positionY={0}
          positionZ={0}
          rotationX={0}
          rotationY={0}
          rotationZ={0}
          cAzimuthAngle={0}
          cPolarAngle={90}
          cDistance={3}
          cameraZoom={1}
          lightType="3d"
          enableTransition={false}
          zoomOut={false}
          toggleAxis={false}
          onError={controller.error}
        />
      </Canvas>
      {#snippet failed(error)}
        <p class="fallback" role="alert">Gradient failed: {error.message}</p>
      {/snippet}
    </svelte:boundary>
  </section>
  <p>Surrounding consumer content is retained during apply and restore.</p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f4f4f4;
    color: #18202a;
    font-family: sans-serif;
  }
  main {
    max-width: 840px;
    margin: 24px auto;
    padding: 0 24px;
  }
  h1 {
    font-size: 1.5rem;
  }
  section {
    width: 100%;
    height: 360px;
    background: #e6e6e6;
  }
  .fallback {
    box-sizing: border-box;
    margin: 0;
    padding: 24px;
    min-height: 100%;
  }
</style>
