import {
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  Vector3,
} from 'three'
import type { IUniform, Texture } from 'three'
import type { ExtractPropTypes } from 'vue'
import type { gradientProps } from './props'
import { shaders, compatibleShader } from '@shadergradient/core'

export type ResolvedGradientProps = ExtractPropTypes<typeof gradientProps>

export function createMaterial(props: ResolvedGradientProps, tintColor: Color) {
  const source = shaders[props.shader][props.type]
  const material = new MeshPhysicalMaterial({
    side: DoubleSide,
    metalness: props.shader === 'glass' ? 0 : 0.2,
    ...(props.shader === 'glass'
      ? {
          transparent: false,
          opacity: 1,
          transmission: 1,
          thickness: 0.6,
          ior: 1.5,
        }
      : {}),
  })
  const uniforms: Record<string, IUniform> = {
    uTime: { value: props.uTime },
    uLoadingTime: { value: 1 },
    uIntensity: { value: 0.5 },
  }
  const glass = props.shader === 'glass'
  const variant = `${props.shader}:${props.type}`
  const vertexShader = compatibleShader(source.vertex)
  const fragmentShader = compatibleShader(source.fragment)
  let lookupSource: Texture | null = null
  let lookupTexture: Texture | null = null
  // r186's physical DFG lookup is borrowed; own its GPU binding, not the
  // module-shared texture's renderer-retaining dispose listeners.
  const lookupUniform = {
    get value(): Texture | null {
      return lookupTexture
    },
    set value(source: Texture | null) {
      if (source === lookupSource) return
      const next = source?.clone() ?? null
      lookupTexture?.dispose()
      lookupSource = source
      lookupTexture = next
    },
  }
  material.addEventListener('dispose', () => {
    lookupTexture?.dispose()
    lookupTexture = null
    lookupSource = null
  })
  material.userData = uniforms
  material.onBeforeCompile = (compiled) => {
    Object.assign(compiled.uniforms, uniforms)
    if (glass && compiled.uniforms.dfgLUT !== undefined) {
      compiled.uniforms.dfgLUT = lookupUniform
    }
    compiled.vertexShader = vertexShader
    compiled.fragmentShader = fragmentShader
  }
  material.customProgramCacheKey = () => variant
  updateMaterial(material, props, tintColor)
  return material
}

export function updateMaterial(
  material: MeshPhysicalMaterial,
  props: ResolvedGradientProps,
  tintColor: Color
) {
  const uniforms = material.userData as Record<string, IUniform>
  const values = {
    uSpeed: props.uSpeed,
    uNoiseDensity: props.uDensity,
    uNoiseStrength: props.uStrength,
    uFrequency: props.uFrequency,
    uAmplitude: props.uAmplitude,
    uLoop:
      props.loop === 'on' &&
      Number.isFinite(props.loopDuration) &&
      props.loopDuration > 0
        ? 1
        : 0,
    uLoopDuration:
      Number.isFinite(props.loopDuration) && props.loopDuration > 0
        ? props.loopDuration
        : 5,
  }
  for (const [name, value] of Object.entries(values)) {
    if (uniforms[name]) uniforms[name].value = value
    else uniforms[name] = { value }
  }
  ;[props.color1, props.color2, props.color3].forEach((value, index) => {
    const color = (props.shader === 'glass' ? tintColor : new Color()).setStyle(
      value,
      LinearSRGBColorSpace
    )
    for (const channel of ['r', 'g', 'b'] as const) {
      const name = `uC${index + 1}${channel}`
      if (uniforms[name]) uniforms[name].value = color[channel]
      else uniforms[name] = { value: color[channel] }
    }
    if (props.shader === 'glass') color.convertSRGBToLinear()
    const name = `uColor${index + 1}`
    if (uniforms[name]) uniforms[name].value.set(color.r, color.g, color.b)
    else uniforms[name] = { value: new Vector3(color.r, color.g, color.b) }
  })
  material.roughness = 1 - props.reflection
  material.wireframe = props.wireframe
}
