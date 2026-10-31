<script lang="ts">
  import { ShaderGradientSource, createGradientSource, type CanvasFallbackState } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

{#snippet wrongFallback(state: CanvasFallbackState)}<p>{state.status}</p>{/snippet}

<ShaderGradientSource source={source} fallback={wrongFallback} />
