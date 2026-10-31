<script lang="ts">
  import type { CanvasFallbackState } from '@shadergradient/svelte'
  import type { FixtureController } from './fixture'
  let {
    state,
    controller,
  }: { state: CanvasFallbackState; controller: FixtureController } = $props()
  $effect(() => {
    controller.setFallback(state.status)
  })
</script>

<div class="fallback" role="status" data-gradient-fallback={state.status}>
  <strong
    >{state.status === 'deferred'
      ? 'Gradient deferred until visible'
      : state.status === 'loading'
        ? 'Preparing native WebGL scene'
        : 'Gradient unavailable'}</strong
  >
  {#if state.status === 'error' || state.status === 'unsupported'}<p>
      {state.error.code}: {state.error.message}
    </p>{/if}
</div>
