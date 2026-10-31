<script lang="ts">
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head>
  <title>Away · ShaderGradient SvelteKit starter</title>
  <meta
    name="description"
    content="A normal server-rendered route without a gradient scene."
  />
</svelte:head>

<main>
  <p>Native Svelte · navigation lifecycle</p>
  <h1>A quiet page without a canvas.</h1>
  <p>
    The gradient page is no longer mounted here. Its Canvas owns the renderer
    lifecycle; the surrounding app does not keep a hidden scene or a global
    gradient registry alive.
  </p>
  <p>
    Return to create a fresh gradient with the original request configuration.
    Local pause and preset changes from the previous visit are intentionally not
    persisted.
  </p>
  <a href={data.returnTo}>Return to the gradient</a>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #11121a;
    color: #f4f1ec;
    font-family: system-ui, sans-serif;
    line-height: 1.6;
  }
  main {
    width: min(72ch, calc(100% - 2.5rem));
    margin: 4rem auto;
  }
  h1 {
    line-height: 1.2;
  }
  a {
    color: #b8ddff;
  }
  a:focus-visible {
    outline: 3px solid #ffd783;
    outline-offset: 4px;
  }
</style>
