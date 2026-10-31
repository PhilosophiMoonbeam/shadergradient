<script lang="ts">
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    presets,
    type GradientError,
    type PresetName,
  } from '@shadergradient/svelte'

  const presetNames = Object.keys(presets) as PresetName[]
  let preset = $state<PresetName>('halo')
  let paused = $state(false)
  let lastError = $state.raw<GradientError | null>(null)
  const selected = $derived(presets[preset])

  function reportError(error: GradientError) {
    lastError = error
  }
</script>

<main>
  <header>
    <p class="eyebrow">Native Svelte 5 · Threlte · Vite</p>
    <h1>A little color, in motion.</h1>
    <p>
      A real shader gradient from the public native Svelte package, with a
      preset picker and a pause control. No React bridge or repository source
      imports.
    </p>
  </header>

  <section class="controls" aria-label="Gradient controls">
    <div class="preset-control">
      <label for="preset">Preset</label>
      <select id="preset" bind:value={preset} aria-controls="gradient-preview">
        {#each presetNames as name (name)}
          <option value={name}>{presets[name].title}</option>
        {/each}
      </select>
    </div>
    <button
      type="button"
      aria-controls="gradient-preview"
      onclick={() => (paused = !paused)}
    >
      {paused ? 'Resume animation' : 'Pause animation'}
    </button>
  </section>

  <figure>
    <ShaderGradientCanvas
      id="gradient-preview"
      role="group"
      aria-label="Shader gradient preview"
      aria-hidden={false}
      style="width:100%;height:clamp(20rem,55vh,38rem);"
      pixelDensity={1}
      fov={selected.props.fov}
      respectReducedMotion={true}
      onError={reportError}
    >
      {#snippet fallback(state)}
        <div
          class="fallback"
          role="status"
          aria-live="polite"
          data-status={state.status}
        >
          {#if state.status === 'unsupported'}
            <p>
              WebGL is unavailable. The shader preview could not be rendered.
            </p>
            <p class="detail">{state.error.message}</p>
          {:else if state.status === 'error'}
            <p>The shader preview could not render.</p>
            <p class="detail">{state.error.message}</p>
          {:else if state.status === 'loading'}
            <p>
              Preparing the shader preview. Waiting for its first rendered
              frame…
            </p>
          {:else}
            <p>
              The shader preview starts when this area is visible in a
              WebGL-capable browser.
            </p>
          {/if}
        </div>
      {/snippet}
      <ShaderGradient
        {...selected.props}
        animate={paused ? 'off' : 'on'}
        onError={reportError}
      />
    </ShaderGradientCanvas>
    <figcaption>
      {selected.title} · {selected.props.lightType === 'env'
        ? 'HDR environment'
        : 'Ambient lighting'} · Animation {paused ? 'paused' : 'enabled'}
    </figcaption>
  </figure>

  <p class="motion-note">
    Your system’s reduced-motion preference is respected. Animation can remain
    still when enabled here; preset changes still redraw the preview.
  </p>
  {#if lastError}
    <p class="error" role="alert">
      Last reported renderer issue ({lastError.code}): {lastError.message}
    </p>
  {/if}
  <footer>
    <p>
      This unpublished-package starter uses local core and Svelte tarballs. See
      the included README for packing and standalone installation instructions.
    </p>
  </footer>
</main>
