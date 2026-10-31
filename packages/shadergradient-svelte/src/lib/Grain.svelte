<script lang="ts">
  import { createGrain } from './grain.svelte.js'
  import type { GrainProps } from './types.js'

  let { settings, lifecycle, lease, camera }: GrainProps = $props()

  const grain = createGrain({
    get settings() {
      return settings
    },
    get lifecycle() {
      return lifecycle
    },
    get lease() {
      return lease
    },
    get camera() {
      return camera
    },
  })

  export function dispose() {
    grain.dispose()
  }
  $effect.pre(() => dispose)
</script>
