<script lang="ts">
  import { ShaderGradientCanvas, type SourceState } from '@shadergradient/svelte'
</script>

{#snippet wrongFallback(state: SourceState)}<p>{state.generation}</p>{/snippet}

<ShaderGradientCanvas fallback={wrongFallback} />
