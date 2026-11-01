import { compatibleShader, shaders } from '@shadergradient/core'
import {
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  Vector3,
  type Texture,
} from 'three'
import type {
  GradientUniforms,
  MaterialHandle,
  ResolvedExternalSettings,
} from './types.js'

export function createMaterial(
  settings: ResolvedExternalSettings
): MaterialHandle {
  const glass = settings.shader === 'glass'
  const variant = `${settings.shader}:${settings.type}`
  const source = shaders[settings.shader][settings.type]
  const vertexShader = compatibleShader(source.vertex)
  const fragmentShader = compatibleShader(source.fragment)
  const material = new MeshPhysicalMaterial({
    side: DoubleSide,
    metalness: glass ? 0 : 0.2,
    ...(glass
      ? {
          transparent: false,
          opacity: 1,
          transmission: 1,
          thickness: 0.6,
          ior: 1.5,
        }
      : {}),
  })
  const uniforms: GradientUniforms = {
    uTime: { value: settings.uTime },
    uLoadingTime: { value: 1 },
    uSpeed: { value: settings.uSpeed },
    uNoiseDensity: { value: settings.uDensity },
    uNoiseStrength: { value: settings.uStrength },
    uFrequency: { value: settings.uFrequency },
    uAmplitude: { value: settings.uAmplitude },
    uLoop: { value: 0 },
    uLoopDuration: { value: 5 },
    uC1r: { value: 0 },
    uC1g: { value: 0 },
    uC1b: { value: 0 },
    uC2r: { value: 0 },
    uC2g: { value: 0 },
    uC2b: { value: 0 },
    uC3r: { value: 0 },
    uC3g: { value: 0 },
    uC3b: { value: 0 },
    uColor1: { value: new Vector3() },
    uColor2: { value: new Vector3() },
    uColor3: { value: new Vector3() },
    uIntensity: { value: 0.5 },
  }
  const color = new Color()
  let disposed = false
  let lookupSource: Texture | null = null
  let lookupTexture: Texture | null = null
  // r186 assigns its module-shared DFG_LUT on every material refresh. Uploading
  // that borrowed texture leaves a renderer-retaining dispose listener on it.
  // Keep an owned clone instead; clone() shares the immutable pixel Source.
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

  material.userData = uniforms
  material.onBeforeCompile = (compiled) => {
    Object.assign(compiled.uniforms, uniforms)
    if (compiled.uniforms.dfgLUT !== undefined) {
      compiled.uniforms.dfgLUT = lookupUniform
    }
    compiled.vertexShader = vertexShader
    compiled.fragmentShader = fragmentShader
  }
  material.customProgramCacheKey = () => variant

  function setColor(value: string): void {
    if (value.startsWith('hsl(')) {
      // Resolved HSL permits signed/exponent numbers that setStyle cannot parse.
      const firstComma = value.indexOf(',')
      const secondComma = value.indexOf(',', firstComma + 1)
      const hue = Number(value.slice(4, firstComma))
      const saturation = Number(
        value.slice(firstComma + 1, value.indexOf('%', firstComma))
      )
      const lightness = Number(
        value.slice(secondComma + 1, value.indexOf('%', secondComma))
      )
      color.setHSL(
        (((hue % 360) + 360) % 360) / 360,
        saturation / 100,
        lightness / 100,
        LinearSRGBColorSpace
      )
    } else {
      color.setStyle(value, LinearSRGBColorSpace)
    }
  }

  function update(next: ResolvedExternalSettings): void {
    uniforms.uSpeed.value = next.uSpeed
    uniforms.uNoiseDensity.value = next.uDensity
    uniforms.uNoiseStrength.value = next.uStrength
    uniforms.uFrequency.value = next.uFrequency
    uniforms.uAmplitude.value = next.uAmplitude
    const validPeriod =
      Number.isFinite(next.loopDuration) && next.loopDuration > 0
    uniforms.uLoop.value = next.loop === 'on' && validPeriod ? 1 : 0
    uniforms.uLoopDuration.value = validPeriod ? next.loopDuration : 5

    setColor(next.color1)
    uniforms.uC1r.value = color.r
    uniforms.uC1g.value = color.g
    uniforms.uC1b.value = color.b
    if (glass) color.convertSRGBToLinear()
    uniforms.uColor1.value.set(color.r, color.g, color.b)

    setColor(next.color2)
    uniforms.uC2r.value = color.r
    uniforms.uC2g.value = color.g
    uniforms.uC2b.value = color.b
    if (glass) color.convertSRGBToLinear()
    uniforms.uColor2.value.set(color.r, color.g, color.b)

    setColor(next.color3)
    uniforms.uC3r.value = color.r
    uniforms.uC3g.value = color.g
    uniforms.uC3b.value = color.b
    if (glass) color.convertSRGBToLinear()
    uniforms.uColor3.value.set(color.r, color.g, color.b)

    material.roughness = 1 - next.reflection
    material.wireframe = next.wireframe
    // Animation owns elapsed time; visual updates must not reset uTime.
  }

  update(settings)

  return {
    material,
    uniforms,
    update,
    dispose() {
      if (disposed) return
      disposed = true
      material.dispose()
      lookupTexture?.dispose()
      lookupTexture = null
      lookupSource = null
    },
  }
}
