<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { useTask, useThrelte } from '@threlte/core';
  import { AmbientLight, DirectionalLight, IcosahedronGeometry, PlaneGeometry, Mesh, REVISION, ShaderChunk } from 'three';
  import { createMaterial } from './material.js';
  import { presets } from './pure.mjs';
  import { getFixtureContext } from './context.js';

  let { shader, type } = $props();
  const { scene, camera, renderer, renderStage, autoRenderTask } = useThrelte();
  const context = getFixtureContext();
  let mesh;
  let ambient;
  let directional;
  let frame = 0;
  let published = false;
  let chunksBefore;
  onMount(() => {
    chunksBefore = JSON.stringify(ShaderChunk);
    const geometry = type === 'sphere' ? new IcosahedronGeometry(1, 64) : new PlaneGeometry(10, 10, type === 'waterPlane' ? 192 : 1, 192);
    const settings = { ...presets.halo.props, shader, type, uTime: 1, loop: 'off', loopDuration: 5 };
    mesh = new Mesh(geometry, createMaterial(settings));
    if (type === 'sphere') mesh.scale.setScalar(1.4);
    ambient = new AmbientLight(0xffffff, 2.5);
    directional = new DirectionalLight(0xffffff, 2);
    directional.position.set(3, 4, 5);
    scene.add(mesh, ambient, directional);
    const activeCamera = get(camera);
    activeCamera.position.set(0, 0, 5);
    activeCamera.lookAt(0, 0, 0);
    activeCamera.updateProjectionMatrix();
  });
  // Reads the completed default render; no second renderer or independent RAF.
  useTask(() => {
    if (!mesh || published || ++frame < 4) return;
    const gl = renderer.getContext();
    const width = Math.min(128, gl.drawingBufferWidth);
    const height = Math.min(128, gl.drawingBufferHeight);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(Math.floor((gl.drawingBufferWidth - width) / 2), Math.floor((gl.drawingBufferHeight - height) / 2), width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let minimum = 255;
    let maximum = 0;
    let nonzero = 0;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i++) {
      hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
      if (i % 4 !== 3) { minimum = Math.min(minimum, pixels[i]); maximum = Math.max(maximum, pixels[i]); if (pixels[i]) nonzero++; }
    }
    (window.__matrixCases ??= {})[`${shader}:${type}`] = {
      shader, type, revision: REVISION, frame, width, height, minimum, maximum, nonzero, hash,
      glError: gl.getError(), programs: renderer.info.programs?.length ?? 0,
      shaderChunkUnchanged: JSON.stringify(ShaderChunk) === chunksBefore,
      context: context.kind,
      geometry: { type: mesh.geometry.type, parameters: mesh.geometry.parameters },
      backend: { version: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR) }
    };
    published = true;
  }, { stage: renderStage, after: autoRenderTask, autoInvalidate: false });
  onDestroy(() => {
    if (!mesh) return;
    scene.remove(mesh, ambient, directional);
    mesh.geometry.dispose();
    mesh.material.dispose();
    // Canvas alone owns renderer teardown; never dispose a host renderer here.
  });
</script>
