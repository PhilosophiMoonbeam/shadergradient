<script>
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { LinearSRGBColorSpace, NoToneMapping, WebGLRenderer } from 'three';
  import Scene from './Scene.svelte';
  import { setFixtureContext } from './context.js';

  const families = ['defaults', 'positionMix', 'cosmic', 'glass'];
  const geometries = ['plane', 'sphere', 'waterPlane'];
  const cases = families.flatMap(shader => geometries.map(type => ({ shader, type, id: `${shader}:${type}` })));
  setFixtureContext({ kind: 'matrix-local-context' });
  let mounted = $state(false);
  let selected = $state('defaults:plane');
  let visible = $state(true);
  let active = $derived(cases.find(item => item.id === selected));

  onMount(() => { mounted = true; });

  function createRenderer(canvas) {
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      (window.__matrixShaderErrors ??= []).push({
        program: gl.getProgramInfoLog(program),
        vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment)
      });
    };
    return renderer;
  }
</script>

<main data-matrix-root>
  <label>Variant
    <select data-matrix-case bind:value={selected}>
      {#each cases as item (item.id)}<option value={item.id}>{item.id}</option>{/each}
    </select>
  </label>
  <button data-matrix-toggle onclick={() => { visible = !visible; }}>Toggle canvas</button>
  <div data-matrix-layout style="width:640px;height:360px;position:relative">
    {#if mounted && visible}
      <Canvas {createRenderer} dpr={1} colorSpace={LinearSRGBColorSpace} toneMapping={NoToneMapping} renderMode="always">
        {#key selected}<Scene shader={active.shader} type={active.type} />{/key}
      </Canvas>
    {:else}
      <p data-matrix-fallback style="margin:0">Gradient loads after client mount</p>
    {/if}
  </div>
</main>
