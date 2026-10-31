<script lang="ts">
  import { ShaderGradient } from '@shadergradient/svelte'
</script>

<ShaderGradient onCameraUpdate={(update: string) => console.info(update)} />
