<script lang="ts">
  import { untrack } from 'svelte'
  import { fromStore } from 'svelte/store'
  import { useCamera } from '@threlte/core'
  import { createCamera } from './camera.svelte.js'
  import type { CameraHandle, CameraProps } from './types.js'

  let props: CameraProps = $props()
  const cameraContext = useCamera()
  const cameraState = fromStore(cameraContext.camera)
  let previousManual = false

  const handle: CameraHandle = createCamera({
    settings: () => props.settings(),
    lifecycle: untrack(() => props.lifecycle),
    lease: untrack(() => props.lease),
    getCamera: () => {
      // Track ownership in effects, but avoid fromStore's temporary get(store)
      // subscriptions during scheduler ticks, input events and cleanup.
      if ($effect.tracking()) void cameraState.current
      return props.getCamera()
    },
    setCamera: (camera) => {
      if (camera === handle.camera) {
        previousManual = cameraContext.manual.current
        // Threlte 8.6 restores its fallback whenever this public registry is
        // empty. Register before assigning through the injected boundary.
        cameraContext.makeDefaultCameras.add(camera)
        cameraContext.makeDefaultCameraManual.set(camera, true)
        cameraContext.manual.set(true)
      } else {
        if (
          props.getCamera() === handle.camera &&
          cameraContext.manual.current === true
        ) {
          cameraContext.manual.set(previousManual)
        }
        cameraContext.makeDefaultCameras.delete(handle.camera)
        cameraContext.makeDefaultCameraManual.delete(handle.camera)
      }
      props.setCamera(camera)
    },
    onCameraUpdate: () => props.onCameraUpdate(),
    onError: () => props.onError(),
  })

  let disposed = false
  export function dispose() {
    if (disposed) return
    disposed = true
    try {
      handle.dispose()
    } finally {
      // A newer host assignment skips restoration, but cannot retain our camera.
      cameraContext.makeDefaultCameras.delete(handle.camera)
      cameraContext.makeDefaultCameraManual.delete(handle.camera)
    }
  }
  // Establish cleanup before a sibling can fail the initial mount.
  $effect.pre(() => dispose)
</script>
