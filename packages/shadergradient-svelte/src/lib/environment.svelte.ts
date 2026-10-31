import { defaultEnvBasePath, environmentManifest } from '@shadergradient/core'
import { untrack } from 'svelte'
import { AmbientLight, EquirectangularReflectionMapping } from 'three'
import type { DataTexture, Texture } from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type {
  EnvironmentHandle,
  EnvironmentInput,
  EnvironmentState,
  GradientError,
} from './types.js'

function normalizeBasePath(path: string): string {
  return `${path.replace(/\/+$/, '')}/`
}

export function createEnvironment(input: EnvironmentInput): EnvironmentHandle {
  const { lifecycle, lease } = input
  const scene = lease.scene
  const ambient = new AmbientLight(0xffffff, 0.4)
  let state = $state.raw<EnvironmentState>(
    untrack(() => input.settings().lightType) === 'env'
      ? { status: 'loading' }
      : { status: 'disabled' }
  )
  let disposed = false
  let generation = 0

  const stopEffects = $effect.root(() => {
    const lightType = $derived(input.settings().lightType)
    const preset = $derived(input.settings().envPreset)
    const brightness = $derived(input.settings().brightness)
    const basePath = $derived(
      normalizeBasePath(lifecycle.settings.envBasePath ?? defaultEnvBasePath)
    )
    const attached = $derived(lease.active && lifecycle.canvas !== undefined)

    $effect.pre(() => {
      if (!attached || disposed) return
      scene.add(ambient)
      lifecycle.invalidate()
      return () => {
        ambient.removeFromParent()
        lifecycle.invalidate()
      }
    })

    $effect.pre(() => {
      const enabled = lightType === 'env'
      const selectedPreset = preset
      const selectedBasePath = basePath
      const canAttach = attached
      const requestGeneration = ++generation

      if (disposed) return
      if (!enabled || !canAttach) {
        state = enabled ? { status: 'loading' } : { status: 'disabled' }
        return
      }

      state = { status: 'loading' }
      ambient.intensity = 0.4
      lifecycle.invalidate()

      const url = selectedBasePath + environmentManifest[selectedPreset]
      let texture: DataTexture | undefined
      let previous: Texture | null = null
      let installed = false
      let settled = false
      let released = false

      // Read live inputs as well as the generation: a response can arrive after
      // a prop change but before Svelte has run this effect's teardown.
      function isCurrent(): boolean {
        const settings = input.settings()
        return (
          !disposed &&
          lease.active &&
          lifecycle.canvas !== undefined &&
          generation === requestGeneration &&
          settings.lightType === 'env' &&
          settings.envPreset === selectedPreset &&
          normalizeBasePath(
            lifecycle.settings.envBasePath ?? defaultEnvBasePath
          ) === selectedBasePath
        )
      }

      function releaseTexture(): void {
        if (released || !texture) return
        released = true
        if (installed && scene.environment === texture) {
          scene.environment = previous
        }
        texture.dispose()
      }

      function fail(cause: unknown): void {
        settled = true
        releaseTexture()
        if (!isCurrent()) return
        const error: GradientError = {
          code: 'environment',
          message: `Unable to load HDR environment: ${url}`,
          cause,
        }
        ambient.intensity = 0.4
        state = { status: 'error', error }
        lifecycle.invalidate()
        input.onError()?.(error)
      }

      try {
        // DataTextureLoader returns the owned placeholder immediately. Retain it
        // even on HTTP/decode failure; loadAsync alone would hide that resource.
        texture = new HDRLoader().load(
          url,
          (loaded) => {
            texture = loaded
            settled = true
            if (!isCurrent()) {
              releaseTexture()
              return
            }
            loaded.mapping = EquirectangularReflectionMapping
            previous = scene.environment
            scene.environment = loaded
            installed = true
            ambient.intensity = 0
            state = { status: 'ready' }
            lifecycle.invalidate()
          },
          undefined,
          fail
        )
      } catch (cause) {
        fail(cause)
      }

      return () => {
        // Retire callbacks before touching any assignment or owned resource.
        ++generation
        if (settled) releaseTexture()
        // Pending placeholders are released by their eventual success/failure
        // callback. Aborting Three's coalesced FileLoader could affect a host.
        lifecycle.invalidate()
      }
    })

    $effect.pre(() => {
      const intensity =
        lightType === '3d'
          ? brightness * Math.PI
          : state.status === 'ready'
            ? 0
            : 0.4
      if (disposed || !attached) return
      ambient.intensity = intensity
      lifecycle.invalidate()
    })

    $effect(() => {
      const currentState = state
      const onState = input.onState()
      if (!disposed && lease.active) untrack(() => onState?.(currentState))
    })
  })

  return {
    ambient,
    get state() {
      return state
    },
    dispose() {
      if (disposed) return
      disposed = true
      ++generation
      stopEffects()
      ambient.removeFromParent()
      ambient.dispose()
    },
  }
}
