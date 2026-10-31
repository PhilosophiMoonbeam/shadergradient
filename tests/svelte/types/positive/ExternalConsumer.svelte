<script lang="ts">
  import { Canvas, T } from '@threlte/core'
  import {
    ShaderGradient,
    type ExternalGradientProps,
    type GradientError,
    type ShaderGradientProps,
  } from '@shadergradient/svelte'

  const external = {
    mode: 'external',
    shader: 'cosmic',
    type: 'waterPlane',
    color1: '#246',
    wireframe: false,
    positionX: -2,
    rotationZ: 185,
    animate: 'off',
    uTime: -1.5,
    loop: 'on',
    loopDuration: 7,
    range: 'enabled',
    rangeStart: 11,
    rangeEnd: 16,
    control: 'query',
    urlString: '?uTime=3',
    onError(error: GradientError) {
      const code: GradientError['code'] = error.code
      console.info(code, error.message)
    },
  } satisfies ExternalGradientProps
  const discriminated: ShaderGradientProps = external
</script>

<!-- Ordinary public Threlte composition: no package Canvas or private provider. -->
<div style="width: 320px; height: 180px">
  <Canvas renderMode="on-demand" dpr={1}>
    <T.PerspectiveCamera makeDefault position={[0, 0, 12]} fov={50} />
    <T.AmbientLight intensity={0.7} />
    <T.Mesh position={[0, -2, 0]}>
      <T.BoxGeometry args={[1, 1, 1]} />
      <T.MeshBasicMaterial color="#123456" />
    </T.Mesh>
    <ShaderGradient {...external} />
    <ShaderGradient {...discriminated} positionX={2} shader="glass" type="sphere" />
    <ShaderGradient mode="external" shader="defaults" type="plane" uTime={5} animate="off" />
  </Canvas>
</div>
