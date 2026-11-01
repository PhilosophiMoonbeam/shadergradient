<script lang="ts">
  import { onDestroy } from 'svelte'
  import { T } from '@threlte/core'
  import {
    BoxGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    SphereGeometry,
  } from 'three'

  // This is ordinary opaque scene content, not a replacement glass material.
  // One component owns every resource; no camera, lighting or scheduler changes.
  const group = new Group()
  group.name = 'native-glass-study-context'
  const box = new BoxGeometry(1, 1, 1)
  const sphere = new SphereGeometry(0.42, 32, 24)
  const paper = new MeshBasicMaterial({ color: '#e7e1ce' })
  const ink = new MeshBasicMaterial({ color: '#233b3d' })
  const coral = new MeshBasicMaterial({ color: '#d76d49' })
  const gold = new MeshBasicMaterial({ color: '#e7b95d' })

  function block(
    material: MeshBasicMaterial,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number
  ) {
    const mesh = new Mesh(box, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    group.add(mesh)
  }

  block(paper, 0, 0, -2.6, 14, 10, 0.1)
  for (let x = -6; x <= 6; x += 0.75) {
    block(ink, x, 0, -2.5, 0.09, 10, 0.08)
  }
  block(coral, -1.45, 0.3, -2.25, 1.3, 2.5, 0.25)
  block(ink, 1.4, -0.8, -2.1, 2.3, 0.55, 0.35)
  const orb = new Mesh(sphere, gold)
  orb.position.set(1.3, 0.8, -1.8)
  group.add(orb)

  onDestroy(() => {
    group.removeFromParent()
    group.clear()
    box.dispose()
    sphere.dispose()
    paper.dispose()
    ink.dispose()
    coral.dispose()
    gold.dispose()
  })
</script>

<T is={group} dispose={false} />
