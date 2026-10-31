<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import { ShaderGradient } from '@shadergradient/svelte'
  import type { ExternalSettingsInput } from '@shadergradient/svelte'
  import {
    DataTexture,
    EquirectangularReflectionMapping,
    PerspectiveCamera,
    RGBAFormat,
    UnsignedByteType,
  } from 'three'
  import SceneProbe from './SceneProbe.svelte'
  import type { FixtureController } from './fixture'

  let {
    gradients,
    controller,
    angle,
  }: {
    gradients: ExternalSettingsInput[]
    controller: FixtureController
    angle: number
  } = $props()
  const threlte = useThrelte()
  const previousCamera = threlte.camera.current
  const previousEnvironment = threlte.scene.environment
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 8)
  const environment = new DataTexture(
    new Uint8Array([
      130, 165, 215, 255, 255, 210, 150, 255, 70, 100, 160, 255, 180, 220, 255,
      255, 180, 220, 255, 255, 70, 100, 160, 255, 255, 210, 150, 255, 130, 165,
      215, 255,
    ]),
    4,
    2,
    RGBAFormat,
    UnsignedByteType
  )
  environment.mapping = EquirectangularReflectionMapping
  environment.needsUpdate = true
  threlte.scene.environment = environment
  threlte.camera.set(camera)
  $effect(() => {
    camera.position.set(Math.sin(angle) * 8, 1, Math.cos(angle) * 8)
    camera.lookAt(0, 0, 0)
    threlte.invalidate()
  })
  $effect.pre(() => () => {
    if (threlte.scene.environment === environment)
      threlte.scene.environment = previousEnvironment
    if (threlte.camera.current === camera) threlte.camera.set(previousCamera)
    environment.dispose()
  })
</script>

<SceneProbe {controller} channel="external" />
<T is={camera} makeDefault />
<T.AmbientLight intensity={1.2} />
<T.DirectionalLight position={[2, 4, 5]} intensity={3} />
<T.Mesh
  name="consumer-owned-host-box"
  position={[0, -1.1, 1.5]}
  rotation={[0.3, 0.5, 0]}
>
  <T.BoxGeometry args={[1.2, 1.2, 1.2]} />
  <T.MeshStandardMaterial color="#f5d66f" metalness={0.3} roughness={0.35} />
</T.Mesh>
{#each gradients as gradient (gradient)}
  <ShaderGradient {...gradient} mode="external" onError={controller.error} />
{/each}
