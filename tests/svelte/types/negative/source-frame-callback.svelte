<script lang="ts">
  import { createGradientSource } from '@shadergradient/svelte'
  const source = createGradientSource()
  source.subscribeFrames((frame: string) => console.info(frame))
</script>
