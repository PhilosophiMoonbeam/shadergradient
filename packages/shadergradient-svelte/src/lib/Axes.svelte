<script lang="ts">
  import { untrack } from 'svelte'
  import { AxesHelper } from 'three'
  import type { AxesHandle, AxesProps } from './types.js'

  let { enabled, lifecycle, lease }: AxesProps = $props()

  const stopEffects = $effect.root(() => {
    $effect(() => {
      const owner = lease
      const canvas = lifecycle
      if (!owner.active) return

      const axes = new AxesHelper(5)
      axes.visible = untrack(() => enabled)
      owner.scene.add(axes)
      let disposed = false

      const handle: AxesHandle = {
        axes,
        dispose() {
          if (disposed) return
          disposed = true
          axes.removeFromParent()
          // AxesHelper owns and disposes both its geometry and material.
          axes.dispose()
          canvas.invalidate()
        },
      }

      $effect(() => {
        const visible = enabled
        if (axes.visible === visible) return
        axes.visible = visible
        untrack(() => canvas.invalidate())
      })

      untrack(() => canvas.invalidate())
      return handle.dispose
    })
  })
  let disposed = false
  export function dispose() {
    if (disposed) return
    disposed = true
    stopEffects()
  }
  $effect.pre(() => dispose)
</script>
