<script lang="ts">
  import type { SourceProducer } from '@shadergradient/svelte'
  const invalid: SourceProducer = { invalidate() {}, onDemandChange(demand: number) { console.info(demand) } }
</script>
