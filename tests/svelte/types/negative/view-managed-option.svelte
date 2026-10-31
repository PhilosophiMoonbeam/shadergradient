<script lang="ts">
  import { ShaderGradientView, createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
</script>

<ShaderGradientView source={source} grain="on" />
