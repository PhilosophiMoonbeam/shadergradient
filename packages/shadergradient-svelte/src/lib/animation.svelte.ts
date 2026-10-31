import { untrack } from 'svelte'
import { advanceElapsed, resolveTime } from './time.js'
import type { AnimationHandle, AnimationInput, MeshHandle } from './types.js'

export function createAnimation(input: AnimationInput): AnimationHandle {
  const { lifecycle } = input
  const initialSettings = untrack(() => input.settings())
  // A new helper is a fresh origin; mesh/material replacement is not.
  let elapsed = initialSettings.uTime
  let previousUTime = initialSettings.uTime
  let disposed = false

  function observeUTime(time: number): void {
    if (Object.is(previousUTime, time)) return
    previousUTime = time
    if (Number.isFinite(time)) elapsed = time
  }

  function writeTime(
    slot: MeshHandle['uTime'] | undefined,
    time: number
  ): boolean {
    if (!slot || Object.is(slot.value, time)) return false
    slot.value = time
    return true
  }

  function advancing(): boolean {
    return (
      !disposed &&
      lifecycle.active &&
      !lifecycle.reducedMotion &&
      (input.enabled?.() ?? true) &&
      input.settings().animate === 'on' &&
      input.mesh() !== undefined
    )
  }

  untrack(() => {
    if (writeTime(input.mesh()?.uTime, resolveTime(elapsed, initialSettings)))
      lifecycle.invalidate()
  })

  const stopEffects = $effect.root(() => {
    $effect(() => {
      if (disposed) return
      const settings = input.settings()
      observeUTime(settings.uTime)
      // Read the live slot while tracking: Mesh changes its raw uniform container
      // on replacement, including while temporal work is stopped.
      const slot = input.mesh()?.uTime
      const time = resolveTime(elapsed, settings)
      untrack(() => {
        if (writeTime(slot, time)) lifecycle.invalidate()
      })
    })
  })

  const removeWork = lifecycle.registerWork('animation', {
    active: advancing,
    tick(delta) {
      if (!advancing()) return
      const settings = input.settings()
      observeUTime(settings.uTime)
      elapsed = advanceElapsed(elapsed, delta, true)
      if (writeTime(input.mesh()?.uTime, resolveTime(elapsed, settings)))
        lifecycle.invalidate()
    },
  })

  return {
    get elapsed() {
      return elapsed
    },
    seek(time) {
      if (disposed || !Number.isFinite(time)) return
      const settings = input.settings()
      // An imperative seek wins over any already-pending settings effect; only
      // a subsequent explicit uTime change may replace it.
      previousUTime = settings.uTime
      elapsed = time
      writeTime(input.mesh()?.uTime, resolveTime(elapsed, settings))
      lifecycle.invalidate()
    },
    dispose() {
      if (disposed) return
      disposed = true
      removeWork()
      stopEffects()
    },
  }
}
