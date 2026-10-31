<script lang="ts">
  import { useThrelte } from '@threlte/core'
  import { fromStore } from 'svelte/store'
  import type { PerspectiveCamera } from 'three'
  import { useCanvasLifecycle } from './canvas-context.svelte.js'
  import type { CanvasSceneProps } from './types.js'

  let { children, onReady }: CanvasSceneProps = $props()
  const lifecycle = useCanvasLifecycle()

  const threlte = useThrelte()
  const currentCamera = fromStore(threlte.camera)

  $effect(() => {
    if (lifecycle.rendererOwnership !== 'canvas') return
    const camera = currentCamera.current as PerspectiveCamera
    const fov = lifecycle.settings.fov
    if (camera.isPerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
      lifecycle.invalidate()
    }
  })
  $effect(() => {
    onReady?.(lifecycle)
  })
</script>

{@render children?.()}
