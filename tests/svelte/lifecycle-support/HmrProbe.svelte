<script>
  import { useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { Mesh, MeshPhysicalMaterial } from 'three'

  let { controller } = $props()
  const owner = untrack(() => controller)
  const threlte = useThrelte()
  const renderer = threlte.renderer
  const scene = threlte.scene
  let attached = true
  let published = false

  function mesh() {
    let found = null
    scene.traverse((object) => {
      if (
        object instanceof Mesh &&
        object.name === 'shadergradient-mesh' &&
        object.material instanceof MeshPhysicalMaterial
      )
        found = object
    })
    return found
  }
  function readColor() {
    // Observe the actual material's public uniform container, just as a public
    // Three consumer can. Never echo the imported prop as GPU evidence.
    const uniforms = mesh()?.material.userData
    if (!uniforms) return ''
    const r = uniforms.uC1r?.value
    const g = uniforms.uC1g?.value
    const b = uniforms.uC1b?.value
    if (![r, g, b].every(Number.isFinite)) return ''
    const hex = (value) =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const probe = {
    renderer,
    frames: 0,
    mesh,
    readColor,
    refs: {
      renderer,
      scene,
      camera: () => threlte.camera.current,
      invalidate: threlte.invalidate,
    },
  }
  const release = owner.attach(probe)
  const originalRender = renderer.render
  function observedRender(renderScene, camera) {
    originalRender.call(this, renderScene, camera)
    if (!attached || renderScene !== scene || this.getContext().isContextLost())
      return
    probe.frames += 1
    if (!published) {
      published = true
      owner.ready()
    }
  }
  renderer.render = observedRender
  // No task, RAF, reactive per-frame UI update or additional render is installed.
  // The Canvas remains the sole renderer owner; restore only this observation.
  $effect.pre(() => () => {
    attached = false
    if (renderer.render === observedRender) renderer.render = originalRender
    release()
  })
</script>
