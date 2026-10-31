import type { EnvironmentManifest } from './types'

export const defaultPlanesZoom = 1
export const defaultSphereDistance = 14
export const zoomOutPlanes = { zoom: 1, distance: 14 }
export const zoomOutSphere = { zoom: 5, distance: 14 }

export const defaultEnvBasePath =
  'https://ruucm.github.io/shadergradient/ui@0.0.0/assets/hdr/'

export const environmentManifest: EnvironmentManifest = {
  city: 'city.hdr',
  dawn: 'dawn.hdr',
  lobby: 'lobby.hdr',
}
