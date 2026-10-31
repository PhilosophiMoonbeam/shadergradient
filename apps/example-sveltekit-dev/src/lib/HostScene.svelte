<script lang="ts">
  import { useThrelte } from '@threlte/core'
  import {
    ShaderGradient,
    type ExternalSettingsInput,
  } from '@shadergradient/svelte'
  import {
    DataTexture,
    EquirectangularReflectionMapping,
    PerspectiveCamera,
    RGBAFormat,
  } from 'three'
  import { untrack } from 'svelte'
  import SceneProbe from './SceneProbe.svelte'
  import HostMesh from './HostMesh.svelte'
  import type { FixtureObserver } from './fixture'

  let {
    observer,
    gradients,
  }: { observer: FixtureObserver; gradients: ExternalSettingsInput[] } =
    $props()
  const owner = untrack(() => observer)
  const context = useThrelte()
  const camera = new PerspectiveCamera(48, 1, 0.1, 100)
  camera.position.set(0, 0, 8)
  context.camera.set(camera)
  const pixels = new Uint8Array(64 * 32 * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 80
    pixels[index + 1] = 100
    pixels[index + 2] = 140
    pixels[index + 3] = 255
  }
  const environment = new DataTexture(pixels, 64, 32, RGBAFormat)
  environment.mapping = EquirectangularReflectionMapping
  environment.needsUpdate = true
  context.scene.environment = environment
  $effect.pre(() => () => {
    if (context.scene.environment === environment)
      context.scene.environment = null
    environment.dispose()
  })
</script>

<!-- Observe before creating the host mesh and native resource children. -->
<SceneProbe observer={owner} kind="host" />
<HostMesh />
{#each gradients as gradient, index (index)}
  <ShaderGradient
    {...gradient}
    mode="external"
    onError={(error) => owner.error(error, 'host')}
  />
{/each}
