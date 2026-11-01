import { IcosahedronGeometry, PlaneGeometry } from 'three'
import type { BufferGeometry } from 'three'
import type { ResolvedExternalSettings } from './types.js'

export function createGeometry(
  settings: Pick<ResolvedExternalSettings, 'type' | 'shader'>
): BufferGeometry {
  if (settings.type === 'sphere') return new IcosahedronGeometry(1, 64)
  const segments =
    settings.type === 'waterPlane' || settings.shader === 'glass' ? 192 : 1
  return new PlaneGeometry(10, 10, segments, 192)
}
