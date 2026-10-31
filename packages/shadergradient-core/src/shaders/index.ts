import type { ShaderCollection } from '../types'

import { defaults } from './defaults/index' // testing color-normal-mix + halftone
import { positionMix } from './positionMix/index'
import { cosmic } from './cosmic/index' // holographic, nebula, and aurora effects
import { glass } from './glass/index' // glass, water, and transparent materials

export const shaders: ShaderCollection = {
  defaults,
  positionMix,
  cosmic,
  glass,
}
