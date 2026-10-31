import { IcosahedronGeometry, PlaneGeometry } from 'three'
import type { BufferGeometry } from 'three'
import type { GradientType } from './types.js'

export function createGeometry(type: GradientType): BufferGeometry {
  if (type === 'sphere') return new IcosahedronGeometry(1, 64)
  return new PlaneGeometry(10, 10, type === 'waterPlane' ? 192 : 1, 192)
}
