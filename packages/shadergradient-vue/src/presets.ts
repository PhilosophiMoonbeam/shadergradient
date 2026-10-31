import { presets as sharedPresets } from '@shadergradient/core'
import type { ShaderGradientProps } from './props'

export const presets = sharedPresets as Record<
  keyof typeof sharedPresets,
  {
    title: string
    color: string
    props: ShaderGradientProps
  }
>
