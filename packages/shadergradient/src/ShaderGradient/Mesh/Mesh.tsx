import { Geometry } from './Geometry'
import { MeshT } from '@/types'
import { Materials } from './Materials'
import { shaders } from '@shadergradient/core'

import { dToRArr } from '@/utils'
import { debug } from '@/utils/debug'

export function Mesh({
  animate,
  range,
  rangeStart,
  rangeEnd,
  loop,
  loopDuration,

  positionX,
  positionY,
  positionZ,
  rotationX,
  rotationY,
  rotationZ,

  type,
  color1,
  color2,
  color3,
  reflection,
  uTime,
  uSpeed,
  uDensity,
  uStrength,
  uFrequency,
  uAmplitude,

  shader,
}: MeshT) {
  const { vertex, fragment } = shaders[shader][type]

  // Prepare uniforms based on shader type
  const uniforms = {
    colors: [color1, color2, color3],
    uTime,
    uSpeed,
    uLoadingTime: 1, // no loading animation
    uNoiseDensity: uDensity,
    uNoiseStrength: uStrength,
    uFrequency,
    uAmplitude,
    uIntensity: 0.5,
    uLoop: loop === 'on' ? 1.0 : 0.0,
    uLoopDuration: loopDuration || 5.0,
  }

  return (
    <mesh
      name='shadergradient-mesh'
      position={[positionX, positionY, positionZ]}
      rotation={dToRArr([rotationX, rotationY, rotationZ])}
    >
      <Geometry type={type} shader={shader} />
      <Materials
        animate={animate}
        range={range}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        loop={loop}
        loopDuration={loopDuration}
        reflection={reflection}
        shader={shader}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        onInit={(material) => {
          debug.performance('material (onInit)', material)
        }}
      />
    </mesh>
  )
}
