<script lang="ts">
  import { ShaderGradientSource, createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

<ShaderGradientSource source={source} canvas={{ pixelDensity: 2 }} />
