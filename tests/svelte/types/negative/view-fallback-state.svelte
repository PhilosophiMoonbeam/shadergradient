<script lang="ts">
  import { ShaderGradientView, createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

{#snippet wrongFallback(state: number)}<p>{state}</p>{/snippet}

<ShaderGradientView source={source} fallback={wrongFallback} />
