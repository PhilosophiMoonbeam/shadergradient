import { untrack } from 'svelte'
import { HalftoneShader } from '@shadergradient/core'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { WebGLRenderTarget } from 'three'
import type { Dispose, GrainHandle, GrainInput } from './types.js'

function boundTargetSize(target: WebGLRenderTarget): void {
  const setSize = target.setSize
  target.setSize = (width, height, depth) => {
    setSize.call(
      target,
      Math.max(1, Math.floor(width)),
      Math.max(1, Math.floor(height)),
      depth
    )
  }
}

export function createGrain(input: GrainInput): GrainHandle {
  // Isolate the enable switch from ordinary visual settings updates, so a
  // blending/camera/size change does not destroy and recreate the pipeline.
  const enabled = $derived(input.settings().grain === 'on')
  let disposed = false

  const stop = $effect.root(() => {
    $effect(() => {
      const lifecycle = input.lifecycle
      const lease = input.lease
      const renderer = lifecycle.renderer
      if (!enabled || !lease.active || !renderer) return

      const composer = new EffectComposer(renderer)
      // Normalize before GPU allocation, including capped DPR below one pixel.
      // Composer retains its actual DPR/CSS sizing and sole target ownership.
      boundTargetSize(composer.renderTarget1)
      boundTargetSize(composer.renderTarget2)
      const renderPass = new RenderPass(
        lease.scene,
        untrack(() => input.camera())
      )
      // ShaderPass clones the public descriptor's uniforms for this instance.
      const grainPass = new ShaderPass(HalftoneShader)
      let releaseRender: Dispose | undefined
      let released = false
      let width = -1
      let height = -1
      let dpr = renderer.getPixelRatio()

      function synchronize(): boolean {
        const size = lifecycle.size
        const camera = input.camera()
        const blending = input.settings().grainBlending
        let changed = false

        if (renderPass.camera !== camera) {
          renderPass.camera = camera
          changed = true
        }
        if (dpr !== size.dpr) {
          dpr = size.dpr
          composer.setPixelRatio(dpr)
          changed = true
        }
        if (width !== size.width || height !== size.height) {
          width = size.width
          height = size.height
          composer.setSize(width, height)
          // Composer targets use buffer pixels; this shader's pattern uses CSS
          // pixels, independently of the actual renderer DPR.
          grainPass.uniforms.width.value = width
          grainPass.uniforms.height.value = height
          changed = true
        }
        if (grainPass.uniforms.blending.value !== blending) {
          grainPass.uniforms.blending.value = blending
          changed = true
        }
        return changed
      }

      function release(): void {
        if (released) return
        released = true
        // The lifecycle lease alone restores its still-owned autoRender state.
        // Remove the callback before releasing any resources it can reference.
        releaseRender?.()
        grainPass.dispose()
        renderPass.dispose()
        // Composer owns both targets and its internal copy pass. Do not dispose
        // those separately, or dispose the borrowed renderer/scene/camera.
        composer.dispose()
        lifecycle.invalidate()
      }

      try {
        composer.addPass(renderPass)
        composer.addPass(grainPass)
        untrack(() => {
          synchronize()
          releaseRender = lifecycle.replaceRender(lease.owner, {
            render(delta) {
              // Read the current camera even when controls replace it during
              // this scheduler turn. No task, time source or invalidation here.
              synchronize()
              composer.render(delta)
              // Returning only after the final pass lets the lifecycle bridge
              // publish/copy the completed output, not the raw scene pass.
            },
          })
        })
      } catch (error) {
        release()
        throw error
      }

      $effect(() => {
        if (synchronize()) untrack(() => lifecycle.invalidate())
      })
      untrack(() => lifecycle.invalidate())
      return release
    })
  })

  return {
    dispose() {
      if (disposed) return
      disposed = true
      stop()
    },
  }
}
