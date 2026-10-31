<script lang="ts">
  import { T } from '@threlte/core'
  import { untrack } from 'svelte'
  import { MathUtils, Mesh as ThreeMesh } from 'three'
  import { createGeometry } from './geometry.js'
  import { createMaterial } from './material.js'
  import type {
    MeshHandle,
    MeshProps,
    ResolvedExternalSettings,
  } from './types.js'

  let { settings, lifecycle, onReady }: MeshProps = $props()

  const initialSettings = untrack(() => settings)
  let geometry = createGeometry(initialSettings.type)
  let geometryType = initialSettings.type
  let materialHandle = createMaterial(initialSettings)
  let materialType = initialSettings.type
  let shader = initialSettings.shader
  let material = $state.raw(materialHandle.material)
  let uniforms = $state.raw(materialHandle.uniforms)
  const mesh = new ThreeMesh(geometry, materialHandle.material)
  mesh.name = 'shadergradient-mesh'
  let disposed = false

  const handle: MeshHandle = {
    mesh,
    get material() {
      return material
    },
    get uniforms() {
      return uniforms
    },
    get uTime() {
      return uniforms.uTime
    },
  }

  function syncTransform(next: ResolvedExternalSettings): void {
    mesh.position.set(next.positionX, next.positionY, next.positionZ)
    mesh.rotation.set(
      MathUtils.degToRad(next.rotationX),
      MathUtils.degToRad(next.rotationY),
      MathUtils.degToRad(next.rotationZ)
    )
  }

  syncTransform(initialSettings)

  $effect(() => {
    if (disposed) return

    if (geometryType !== settings.type) {
      const previous = geometry
      geometry = createGeometry(settings.type)
      geometryType = settings.type
      mesh.geometry = geometry
      previous.dispose()
    }

    if (materialType !== settings.type || shader !== settings.shader) {
      const previous = materialHandle
      materialHandle = createMaterial(settings)
      // Preserve the displayed time until animation resolves the new live slot.
      materialHandle.uniforms.uTime.value = previous.uniforms.uTime.value
      materialType = settings.type
      shader = settings.shader
      mesh.material = materialHandle.material
      material = materialHandle.material
      uniforms = materialHandle.uniforms
      previous.dispose()
    }

    materialHandle.update(settings)
    syncTransform(settings)
    lifecycle.invalidate()
  })

  function attach(): () => void {
    untrack(() => onReady?.(handle))
    return () => {
      if (disposed) return
      disposed = true
      untrack(() => onReady?.(undefined))
      geometry.dispose()
      materialHandle.dispose()
    }
  }
</script>

<!-- These resources have one explicit owner; Threlte only attaches the mesh. -->
<T is={mesh} dispose={false} oncreate={attach} />
