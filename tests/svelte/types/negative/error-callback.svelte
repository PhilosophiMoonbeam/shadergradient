<script lang="ts">
  import { ShaderGradientCanvas } from '@shadergradient/svelte'
</script>

<ShaderGradientCanvas onError={(error: Event) => console.info(error.type)} />
