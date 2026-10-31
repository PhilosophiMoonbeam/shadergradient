<script lang="ts">
  import { ShaderGradientCanvas } from '@shadergradient/svelte'
</script>

{#snippet wrongChildren(value: string)}<p>{value}</p>{/snippet}

<ShaderGradientCanvas children={wrongChildren} />
