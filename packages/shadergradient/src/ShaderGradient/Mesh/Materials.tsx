import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { colorToRgb, formatColor } from '@/utils'
import { useFrame } from '@react-three/fiber'

export const Materials = (props) =>
  props.shader === 'glass' ? (
    <GlassMaterials {...props} />
  ) : (
    <GradientMaterials {...props} />
  )

const GradientMaterials = ({
  animate,
  range,
  rangeStart,
  rangeEnd,
  loop,
  loopDuration,
  reflection,
  uniforms,
  vertexShader,
  fragmentShader,
  onInit,
}) => {
  const material = useMemo(() => {
    const entries = Object.entries(uniforms)
    const colors = uniforms.colors
    const uC1 = colorToRgb(colors[0])
    const uC2 = colorToRgb(colors[1])
    const uC3 = colorToRgb(colors[2])
    const rgbColors = {
      uC1r: { value: formatColor(uC1?.r) },
      uC1g: { value: formatColor(uC1?.g) },
      uC1b: { value: formatColor(uC1?.b) },
      uC2r: { value: formatColor(uC2?.r) },
      uC2g: { value: formatColor(uC2?.g) },
      uC2b: { value: formatColor(uC2?.b) },
      uC3r: { value: formatColor(uC3?.r) },
      uC3g: { value: formatColor(uC3?.g) },
      uC3b: { value: formatColor(uC3?.b) },
    }

    const uniformValues = entries.reduce((acc, [name, value]) => {
      const uniform = THREE.UniformsUtils.clone({ [name]: { value } })
      return {
        ...acc,
        ...uniform,
      }
    }, {})

    // Keep the existing scalar-gradient shader path unchanged.
    const materialConfig: THREE.MeshPhysicalMaterialParameters = {
      userData: uniformValues, // sync uniform and userData to update uniforms from outside (MeshPhysicalMaterial)
      metalness: 0.2,
      roughness: 1 - (typeof reflection === 'number' ? reflection : 0.1),
      side: THREE.DoubleSide,
      onBeforeCompile: (shader) => {
        shader.uniforms = {
          ...shader.uniforms,
          ...uniformValues,
          ...rgbColors,
        }
        shader.vertexShader = vertexShader
        shader.fragmentShader = fragmentShader
      },
      // wireframe: true,
    }

    const material = new THREE.MeshPhysicalMaterial(materialConfig)

    entries.forEach(([name]) =>
      Object.defineProperty(material, name, {
        get: () => material.uniforms[name].value,
        set: (v) => (material.uniforms[name].value = v),
      })
    )

    if (onInit) onInit(material)
    return material
  }, [uniforms, vertexShader, fragmentShader, onInit, reflection])

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  useTimeAnimation(material, {
    animate,
    range,
    rangeStart,
    rangeEnd,
    loop,
    loopDuration,
  })
  return <primitive attach='material' object={material} />
}

function GlassMaterials({
  animate,
  range,
  rangeStart,
  rangeEnd,
  loop,
  loopDuration,
  reflection,
  uniforms,
  vertexShader,
  fragmentShader,
  onInit,
}) {
  const material = useMemo(() => {
    const values = {
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uNoiseDensity: { value: 1 },
      uNoiseStrength: { value: 0 },
      uLoop: { value: 0 },
      uLoopDuration: { value: 5 },
      uColor1: { value: new THREE.Vector3() },
      uColor2: { value: new THREE.Vector3() },
      uColor3: { value: new THREE.Vector3() },
    }
    const result = new THREE.MeshPhysicalMaterial({
      metalness: 0,
      roughness: 0.08,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      transmission: 1,
      thickness: 0.6,
      ior: 1.5,
    })
    result.userData = values
    result.onBeforeCompile = (compiled) => {
      Object.assign(compiled.uniforms, values)
      compiled.vertexShader = vertexShader
      compiled.fragmentShader = fragmentShader
    }
    const programKey = vertexShader + fragmentShader
    result.customProgramCacheKey = () => programKey
    return result
  }, [vertexShader, fragmentShader])
  const color = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    const values = material.userData
    values.uSpeed.value = uniforms.uSpeed
    values.uNoiseDensity.value = uniforms.uNoiseDensity
    values.uNoiseStrength.value = uniforms.uNoiseStrength
    values.uLoop.value = uniforms.uLoop
    values.uLoopDuration.value = uniforms.uLoopDuration
    // Color parses CSS into linear, normalized channels; scalar gradients above
    // intentionally retain their original formatColor channel convention.
    color.setStyle(uniforms.colors[0])
    values.uColor1.value.set(color.r, color.g, color.b)
    color.setStyle(uniforms.colors[1])
    values.uColor2.value.set(color.r, color.g, color.b)
    color.setStyle(uniforms.colors[2])
    values.uColor3.value.set(color.r, color.g, color.b)
    material.roughness = 1 - (typeof reflection === 'number' ? reflection : 0.1)
  }, [material, uniforms, reflection, color])

  useLayoutEffect(() => {
    material.userData.uTime.value = uniforms.uTime
  }, [material, uniforms.uTime])

  useEffect(() => {
    onInit?.(material)
  }, [material, onInit])
  useEffect(() => () => material.dispose(), [material])
  useTimeAnimation(material, {
    animate,
    range,
    rangeStart,
    rangeEnd,
    loop,
    loopDuration,
  })
  return <primitive attach='material' object={material} />
}

function useTimeAnimation(
  material,
  { animate, range, rangeStart, rangeEnd, loop, loopDuration }
) {
  const localClockRef = useRef<THREE.Clock | null>(null)
  if (localClockRef.current === null) localClockRef.current = new THREE.Clock()

  // Sync clock with animate/range changes similar to v1's useTimeAnimation
  useEffect(() => {
    if (animate === 'on') {
      localClockRef.current.start()
    } else {
      localClockRef.current.stop()
    }
  }, [animate])

  // Animate uTime with useFrame (v1-like behavior)
  useFrame(() => {
    if (animate === 'on' && material.userData.uTime) {
      let elapsed = localClockRef.current.getElapsedTime()

      // Handle loop functionality
      if (loop === 'on' && Number.isFinite(loopDuration) && loopDuration > 0) {
        // For seamless loops, we need to ensure the time wraps around smoothly
        // The shader will handle the circular sampling to make it truly seamless
        elapsed = elapsed % loopDuration

        // Update loop uniforms
        if (material.userData.uLoop) {
          material.userData.uLoop.value = 1.0
        }
        if (material.userData.uLoopDuration) {
          material.userData.uLoopDuration.value = loopDuration
        }
      } else {
        // Disable loop in shader
        if (material.userData.uLoop) {
          material.userData.uLoop.value = 0.0
        }

        if (
          range === 'enabled' &&
          Number.isFinite(rangeStart) &&
          Number.isFinite(rangeEnd) &&
          rangeEnd > rangeStart
        ) {
          elapsed = (rangeStart as number) + elapsed
          if (elapsed >= (rangeEnd as number)) {
            elapsed = rangeStart as number
            // restart the local clock to loop precisely from rangeStart
            localClockRef.current.start()
          }
        }
      }

      material.userData.uTime.value = elapsed
    }
  })
}
