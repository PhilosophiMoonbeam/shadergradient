<script lang="ts">
  import {
    ShaderGradient,
    ShaderGradientCanvas,
    presets,
    type CanvasFallbackState,
    type GradientError,
    type PresetName,
  } from '@shadergradient/svelte'

  let {
    initialPreset,
    requestLabel,
  }: { initialPreset: PresetName; requestLabel: string } = $props()

  let selectedPreset = $derived(initialPreset)
  let paused = $state(false)
  let lastError = $state.raw<GradientError>()
  let retry = $state(0)
  const presetNames = Object.keys(presets) as PresetName[]
  const selected = $derived(presets[selectedPreset])
  const fallbackBackground = $derived(
    `linear-gradient(125deg, ${selected.props.color1}, ${selected.props.color2}, ${selected.props.color3})`
  )

  function reportError(error: GradientError) {
    lastError = error
  }

  function changePreset(event: Event) {
    selectedPreset = (event.currentTarget as HTMLSelectElement)
      .value as PresetName
  }

  function retryScene() {
    lastError = undefined
    retry += 1
  }

  function fallbackMessage(state: CanvasFallbackState): string {
    switch (state.status) {
      case 'deferred':
        return 'Static color preview. The live gradient starts when this page mounts in a WebGL-capable browser.'
      case 'loading':
        return 'Preparing the first live gradient frame. The static color preview remains available.'
      case 'unsupported':
        return 'WebGL is unavailable. You can still explore the presets using this static color preview.'
      case 'error':
        return `The live gradient is unavailable: ${state.error.message} The static color preview remains available.`
    }
  }
</script>

<section aria-labelledby="gradient-heading">
  <h2 id="gradient-heading">Explore the gradient</h2>
  <div class="controls">
    <label>
      Preset
      <select
        value={selectedPreset}
        onchange={changePreset}
        aria-controls="gradient-artwork"
      >
        {#each presetNames as name (name)}
          <option value={name}>{presets[name].title}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      aria-pressed={paused}
      aria-controls="gradient-artwork"
      onclick={() => {
        paused = !paused
      }}
    >
      {paused ? 'Resume animation' : 'Pause animation'}
    </button>
  </div>

  <figure
    id="gradient-artwork"
    data-selected-preset={selectedPreset}
    data-request={requestLabel}
  >
    {#key retry}
      <ShaderGradientCanvas
        style="width:100%;height:420px;max-height:65vh;min-height:260px;overflow:hidden;border-radius:18px"
        pixelDensity={selected.props.pixelDensity}
        fov={selected.props.fov}
        lazyLoad={false}
        aria-hidden={false}
        role="img"
        aria-label={`${selected.title} gradient artwork for ${requestLabel}`}
        onError={reportError}
      >
        <ShaderGradient
          {...selected.props}
          animate={paused ? 'off' : 'on'}
          onError={reportError}
        />
        {#snippet fallback(state: CanvasFallbackState)}
          <div
            class="fallback"
            style:background={fallbackBackground}
            data-fallback-status={state.status}
          >
            <p>{fallbackMessage(state)}</p>
          </div>
        {/snippet}
      </ShaderGradientCanvas>
    {/key}
    <figcaption>
      <strong>{selected.title}</strong> · {selected.props.type} · {selected
        .props.shader}
      <span aria-live="polite">
        · Animation {paused
          ? 'paused'
          : 'enabled (reduced-motion preferences apply)'}</span
      >
    </figcaption>
  </figure>

  {#if lastError}
    <div class="error" role="alert">
      <p>
        <strong>Last reported gradient error: {lastError.code}.</strong>
        {lastError.message}
      </p>
      <p>
        The page and controls still work. Environment errors may leave an
        ambient-lit scene rather than the HDR appearance. Preset changes do not
        necessarily retry a failed environment; recreate the gradient to start a
        fresh attempt.
      </p>
      <button type="button" onclick={retryScene}>Recreate gradient</button>
    </div>
  {/if}
  <p class="hint">
    The artwork is decorative; all controls are ordinary keyboard-accessible
    HTML outside the canvas.
  </p>
</section>

<style>
  section {
    margin-top: 2rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  label {
    display: grid;
    gap: 0.3rem;
  }
  select,
  button {
    font: inherit;
    border: 1px solid #727580;
    border-radius: 8px;
    padding: 0.55rem 0.85rem;
    background: #242633;
    color: #fff;
  }
  button {
    cursor: pointer;
  }
  figure {
    margin: 0;
  }
  figcaption {
    margin-top: 0.65rem;
  }
  .fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
  }
  .fallback p {
    background: #11121ae8;
    color: #fff;
    padding: 1rem;
    border-radius: 12px;
    margin: 1.5rem;
    max-width: 52ch;
  }
  .error {
    margin-top: 1rem;
    border: 1px solid #ffc3b3;
    padding: 0.5rem 1rem 1rem;
    border-radius: 12px;
  }
  .hint {
    color: #c4c5d0;
    font-size: 0.9rem;
  }
</style>
