<script lang="ts">
  import { ShaderGradientSource, createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

{#snippet wrongChildren(value: string)}<p>{value}</p>{/snippet}

<ShaderGradientSource source={source} children={wrongChildren} />
