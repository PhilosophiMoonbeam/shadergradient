<script lang="ts">
  import { T } from '@threlte/core'
  import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
  const geometry = new BoxGeometry(0.8, 0.8, 0.8)
  const material = new MeshBasicMaterial({ color: '#ffffff' })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'consumer-owned-host-mesh'
  mesh.position.set(0, -1.3, 1)
  $effect.pre(() => () => {
    geometry.dispose()
    material.dispose()
  })
</script>

<T is={mesh} dispose={false} />
