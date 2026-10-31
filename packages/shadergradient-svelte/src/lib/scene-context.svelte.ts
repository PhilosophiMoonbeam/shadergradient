import { useThrelteUserContext } from '@threlte/core'
import type { Scene } from 'three'
import type { ManagedSceneLease, SceneContext } from './types.js'

const namespace = '@shadergradient/svelte/scene-ownership'

export function useSceneContext(scene: Scene): SceneContext {
  const registry = useThrelteUserContext(
    namespace,
    () => ({ scenes: new WeakMap<Scene, SceneContext>() }),
    { existing: 'skip' }
  )
  const existing = registry.scenes.get(scene)
  if (existing) return existing

  let current: ManagedSceneLease | undefined
  const context: SceneContext = {
    acquireManaged(owner) {
      if (current?.active) {
        if (current.owner === owner) return current
        throw Object.assign(
          new Error(
            'Only one managed ShaderGradient may own a Threlte scene. Use mode="external" for additional meshes, or a separate Canvas.'
          ),
          { code: 'duplicate-managed' }
        )
      }
      let active = true
      const lease: ManagedSceneLease = {
        scene,
        owner,
        get active() {
          return active
        },
        release() {
          if (!active) return
          active = false
          if (current === lease) current = undefined
        },
      }
      current = lease
      return lease
    },
  }
  registry.scenes.set(scene, context)
  return context
}
