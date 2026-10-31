<script lang="ts">
  import { createGradientSource, type CanvasFallbackState } from '@shadergradient/svelte'
  const source = createGradientSource()
  source.subscribe((state: CanvasFallbackState) => console.info(state.status))
</script>
