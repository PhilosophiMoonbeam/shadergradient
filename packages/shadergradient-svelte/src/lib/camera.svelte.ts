import { untrack } from 'svelte'
import CameraControls from 'camera-controls'
import {
  Box3,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import {
  defaultPlanesZoom,
  defaultSphereDistance,
  zoomOutPlanes,
  zoomOutSphere,
} from '@shadergradient/core'
import type {
  CameraHandle,
  CameraInput,
  CameraUpdate,
  GradientError,
} from './types.js'

const degreesToRadians = Math.PI / 180

export function createCamera(input: CameraInput): CameraHandle {
  const { lifecycle, lease } = input
  const camera = new PerspectiveCamera()
  // Controls require a nonzero initial radius, even before the first settings effect.
  camera.position.z = defaultSphereDistance
  let controls = $state.raw<CameraControls>()
  let moving = $state(false)
  let disposed = false
  let interacting = false
  let settled = false
  let emitting = false
  let smoothTime = 0

  const ownsCamera = () =>
    !disposed && lease.active && input.getCamera() === camera
  const motionAllowed = () => lifecycle.active && !lifecycle.reducedMotion

  function report(cause: unknown) {
    const error: GradientError = {
      code: 'renderer',
      message:
        'Unable to initialize the managed ShaderGradient camera controls.',
      cause,
    }
    const callback = input.onError()
    if (callback) callback(error)
    else lifecycle.reportError(error)
  }

  function emitRest() {
    settled = true
    interacting = false
    const control = controls
    if (!control || !ownsCamera() || emitting) return
    control.smoothTime = motionAllowed() ? smoothTime : 0
    const callback = input.onCameraUpdate()
    if (!callback) return
    const cAzimuthAngle = Math.round(control.azimuthAngle / degreesToRadians)
    const cPolarAngle = Math.round(control.polarAngle / degreesToRadians)
    if (!Number.isFinite(cAzimuthAngle) || !Number.isFinite(cPolarAngle)) return
    let update: CameraUpdate = { cAzimuthAngle, cPolarAngle }
    if (input.settings().type === 'sphere') {
      // v2.9 exposes zoom as a method, not a numeric getter; prefer a finite
      // numeric value if provided, otherwise use its owned camera's zoom.
      const controlZoom: unknown = control.zoom
      const zoom =
        typeof controlZoom === 'number' && Number.isFinite(controlZoom)
          ? controlZoom
          : camera.zoom
      if (Number.isFinite(zoom))
        update = {
          cAzimuthAngle,
          cPolarAngle,
          cameraZoom: Number(zoom.toFixed(2)),
        }
    } else if (Number.isFinite(control.distance)) {
      update = {
        cAzimuthAngle,
        cPolarAngle,
        cDistance: Number(control.distance.toFixed(2)),
      }
    }
    emitting = true
    try {
      callback(update)
    } finally {
      emitting = false
    }
  }

  // Finish at the exact target instead of scheduling damping's invisible tail.
  // The final zero-delta update also lets camera-controls enter sleep, so the
  // next discrete input starts a new wake/rest cycle.
  function finish(control: CameraControls) {
    control.stop()
    control.update(0)
    control.update(0)
    moving = false
  }

  function snap(control: CameraControls) {
    settled = false
    control.stop()
    control.update(0)
    // A discrete snapped input can wake without ever emitting rest: v2 only
    // tests rest on a subsequent changed update. Mark the same zoom dirty via
    // its public API, then let the actual rest event deliver the callback.
    if (!settled) {
      void control.zoomTo(camera.zoom, false)
      control.update(0)
    }
    finish(control)
    lifecycle.invalidate()
  }

  const stopEffects = $effect.root(() => {
    $effect(() => {
      if (!lease.active) return
      const previousCamera = untrack(input.getCamera)
      untrack(() => input.setCamera(camera))
      lifecycle.invalidate()
      return () => {
        if (input.getCamera() === camera) {
          input.setCamera(previousCamera)
          lifecycle.invalidate()
        }
      }
    })

    $effect(() => {
      const fov = lifecycle.settings.fov
      const { width, height } = lifecycle.size
      const validFov = Number.isFinite(fov) && fov > 0 && fov < 180 ? fov : 45
      const aspect = width > 0 && height > 0 ? width / height : 1
      untrack(() => {
        if (camera.fov === validFov && camera.aspect === aspect) return
        camera.fov = validFov
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        lifecycle.invalidate()
      })
    })

    $effect(() => {
      const canvas = lifecycle.canvas
      if (!canvas) return
      let control: CameraControls
      try {
        CameraControls.install({
          THREE: {
            Box3,
            Matrix4,
            Quaternion,
            Raycaster,
            Sphere,
            Spherical,
            Vector2,
            Vector3,
            Vector4,
          },
        })
        control = new CameraControls(camera, canvas)
      } catch (cause) {
        untrack(() => report(cause))
        return
      }
      control.maxDistance = 1000
      control.restThreshold = 0.01
      control.draggingSmoothTime = 0
      control.mouseButtons.left = CameraControls.ACTION.ROTATE
      control.mouseButtons.right = CameraControls.ACTION.NONE
      control.touches.one = CameraControls.ACTION.TOUCH_ROTATE
      control.touches.two = CameraControls.ACTION.NONE
      control.touches.three = CameraControls.ACTION.NONE

      const onStart = () => {
        if (!ownsCamera()) return
        interacting = true
        control.smoothTime = 0
      }
      const onControl = () => {
        if (!ownsCamera()) return
        interacting = true // wheel has no controlstart/controlend events
        control.smoothTime = 0
        snap(control)
      }
      const onEnd = () => {
        if (!ownsCamera()) return
        interacting = false
        control.smoothTime = motionAllowed() ? smoothTime : 0
      }
      control.addEventListener('controlstart', onStart)
      control.addEventListener('control', onControl)
      control.addEventListener('controlend', onEnd)
      control.addEventListener('rest', emitRest)
      controls = control
      return () => {
        control.removeEventListener('controlstart', onStart)
        control.removeEventListener('control', onControl)
        control.removeEventListener('controlend', onEnd)
        control.removeEventListener('rest', emitRest)
        control.dispose()
        if (controls === control) controls = undefined
        moving = false
        interacting = false
      }
    })

    // Compare primitive camera settings, not resolved-settings object identity:
    // unrelated material changes must not reset a user-controlled camera pose.
    let previousAzimuth: number | undefined
    let previousPolar: number | undefined
    let previousDistance: number | undefined
    let previousZoom: number | undefined
    let previousControl: CameraControls | undefined
    $effect(() => {
      const control = controls
      const settings = input.settings()
      const {
        type,
        cAzimuthAngle,
        cPolarAngle,
        cDistance,
        cameraZoom,
        zoomOut,
        enableTransition,
      } = settings
      smoothTime = settings.smoothTime
      const permitted = motionAllowed()
      if (!control) return
      const distance = zoomOut
        ? type === 'sphere'
          ? zoomOutSphere.distance
          : zoomOutPlanes.distance
        : type === 'sphere'
          ? defaultSphereDistance
          : cDistance
      const zoom = zoomOut
        ? type === 'sphere'
          ? zoomOutSphere.zoom
          : zoomOutPlanes.zoom
        : type === 'sphere'
          ? cameraZoom
          : defaultPlanesZoom
      untrack(() => {
        // camera-controls 2.9 uses dollySpeed for both DOLLY and ZOOM inputs.
        control.dollySpeed = type === 'sphere' ? 10 : 5
        control.mouseButtons.middle =
          type === 'sphere'
            ? CameraControls.ACTION.ZOOM
            : CameraControls.ACTION.DOLLY
        control.mouseButtons.wheel = control.mouseButtons.middle
        control.smoothTime = permitted && !interacting ? smoothTime : 0
        const initial = previousControl !== control
        const anglesChanged =
          initial ||
          previousAzimuth !== cAzimuthAngle ||
          previousPolar !== cPolarAngle
        const distanceChanged = initial || previousDistance !== distance
        const zoomChanged = initial || previousZoom !== zoom
        previousControl = control
        previousAzimuth = cAzimuthAngle
        previousPolar = cPolarAngle
        previousDistance = distance
        previousZoom = zoom
        if (!anglesChanged && !distanceChanged && !zoomChanged) return
        settled = false
        const transition =
          !initial &&
          enableTransition &&
          permitted &&
          !interacting &&
          smoothTime > 0
        if (anglesChanged)
          void control.rotateTo(
            cAzimuthAngle * degreesToRadians,
            cPolarAngle * degreesToRadians,
            transition
          )
        if (distanceChanged) void control.dollyTo(distance, transition)
        if (zoomChanged) void control.zoomTo(zoom, transition)
        if (transition) {
          moving = true
          lifecycle.invalidate()
        } else {
          snap(control)
        }
      })
    })

    $effect(() => {
      const control = controls
      const owned = ownsCamera()
      const permitted = motionAllowed()
      // Observe enableTransition separately: disabling it during a transition
      // must snap the current target even when all pose values are unchanged.
      const enabled = input.settings().enableTransition
      if (!control) return
      untrack(() => {
        control.enabled = owned
        if (!owned) {
          control.cancel()
          control.stop()
          moving = false
          interacting = false
        } else if ((!permitted || !enabled) && moving) {
          snap(control)
        }
        control.smoothTime = permitted && !interacting ? smoothTime : 0
      })
    })
  })

  const removeWork = lifecycle.registerWork('controls', {
    active: () => moving && ownsCamera() && motionAllowed(),
    tick(delta) {
      const control = controls
      if (!control || !ownsCamera() || !motionAllowed()) return
      settled = false
      const changed = control.update(delta)
      if (settled || !changed) finish(control)
      if (changed || settled) lifecycle.invalidate()
    },
  })

  return {
    camera,
    dispose() {
      if (disposed) return
      disposed = true
      removeWork()
      stopEffects()
    },
  }
}
