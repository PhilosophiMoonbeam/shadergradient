import { vertex as planeVertex, fragment as planeFragment } from './plane/index'
import {
  vertex as sphereVertex,
  fragment as sphereFragment,
} from './sphere/index'
import {
  vertex as waterPlaneVertex,
  fragment as waterPlaneFragment,
} from './waterPlane/index'

export const cosmic = {
  plane: { vertex: planeVertex, fragment: planeFragment },
  sphere: { vertex: sphereVertex, fragment: sphereFragment },
  waterPlane: { vertex: waterPlaneVertex, fragment: waterPlaneFragment },
}
