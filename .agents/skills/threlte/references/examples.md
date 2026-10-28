# Exact Examples

Exact (or minimally trimmed) snippets from commit-pinned docs.

Freshness: pinned to `ebb4f7e28ee4db71d19109656cba80fb10eabe2c`.

If a snippet ever differs from local mirror files, prefer `skills/threlte/examples/`.

## 1) Canvas root

Source: `apps/docs/src/content/learn/getting-started/your-first-scene.mdx`

```svelte
<script>
	import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
</script>

<Canvas>
	<Scene />
</Canvas>
```

## 2) Basic `<T.Mesh>`

Source: `apps/docs/src/content/reference/core/t.mdx`

```svelte
<script>
	import { T } from '@threlte/core';
</script>

<T.Mesh>
	<T.BoxGeometry />
	<T.MeshBasicMaterial />
</T.Mesh>
```

## 3) `attach` usage

Source: `apps/docs/src/content/reference/core/t.mdx`

```svelte
<T.Mesh>
	<T.MeshBasicMaterial attach="material" />
	<T.BoxGeometry attach="geometry" />
</T.Mesh>
```

## 4) Interactivity plugin

Source: `apps/docs/src/content/reference/extras/interactivity.mdx`

```svelte
<script>
	import { interactivity } from '@threlte/extras';
  interactivity();
</script>

<T.Mesh
	onclick={() => {
	  console.log('clicked');
	}}
>
	<T.BoxGeometry />
	<T.MeshStandardMaterial color="red" />
</T.Mesh>
```

## 5) `useTask` animation loop

Source: `apps/docs/src/content/reference/core/use-task.mdx`

```svelte
<script lang="ts">
	import { T, useTask } from '@threlte/core';
  import { Mesh } from 'svelte-three';

  let mesh = $state.raw<Mesh>();

  useTask((delta) => {
    if (!mesh) return;
    mesh.rotation.y += delta * 0.5;
  });
</script>

<T.Mesh bind:ref={mesh}>
	<T.BoxGeometry />
</T.Mesh>
```

## 6) `useLoader`

Source: `apps/docs/src/content/reference/core/use-loader.mdx`

```svelte
<script>
	import { useLoader } from '@threlte/core';
  import { TextureLoader } from 'three';

  const texture = useLoader(TextureLoader).load('path/to/texture.png');
</script>
```

## 7) `useGltf`

Source: `apps/docs/src/content/reference/extras/use-gltf.mdx`

```svelte
<script lang="ts">
	import { T } from '@threlte/core';
  import { useGltf } from '@threlte/extras';

  const gltf = useGltf('/path/to/model.glb');
</script>

{#if $gltf}
	<T is={$gltf.nodes['node-name']} />
{/if}
```

## 8) Suspense boundary

Source: `apps/docs/src/content/reference/extras/suspense.mdx`

```svelte
<script>
	import { Suspense } from '@threlte/extras';
  import Fallback from './Fallback.svelte';
  import Model from './Model.svelte';
</script>

<Suspense>
	<Model />

	{#snippet fallback()}
		<Fallback />
	{/snippet}
</Suspense>
```

## 9) OrbitControls

Source: `apps/docs/src/content/reference/extras/orbit-controls.mdx`

```svelte
<script>
	import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
</script>

<T.PerspectiveCamera
	makeDefault
	fov={50}
>
	<OrbitControls enableDamping />
</T.PerspectiveCamera>
```

## 10) XR baseline

Source: `apps/docs/src/content/reference/xr/getting-started.mdx`

```svelte
<script>
	import { Controller, Hand, XR } from '@threlte/xr';
</script>

<XR>
	<Controller left />
	<Controller right />
	<Hand left />
	<Hand right />
</XR>
```

## 11) Theatre quick start

Source: `apps/docs/src/content/reference/theatre/getting-started.mdx`

```svelte
<script lang="ts">
	import { Canvas } from '@threlte/core';
  import { Theatre } from '@threlte/theatre';
  import Scene from './Scene.svelte';
</script>

<Canvas>
	<Theatre>
		<Scene />
	</Theatre>
</Canvas>
```
