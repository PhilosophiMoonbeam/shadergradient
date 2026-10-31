<script lang="ts">
  import { ShaderGradientSource, createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

<ShaderGradientSource source={source} gradient={{ mode: 'external' }} />
