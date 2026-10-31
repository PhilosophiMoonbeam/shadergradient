<script lang="ts">
  import { createEnvironment } from './environment.svelte.js'
  import type { LightsProps } from './types.js'

  let { settings, lifecycle, lease, onState, onError }: LightsProps = $props()

  const environment = createEnvironment({
    settings: () => settings(),
    get lifecycle() {
      return lifecycle
    },
    get lease() {
      return lease
    },
    onState: () => onState(),
    onError: () => onError(),
  })

  export function dispose() {
    environment.dispose()
  }
  $effect.pre(() => dispose)
</script>
