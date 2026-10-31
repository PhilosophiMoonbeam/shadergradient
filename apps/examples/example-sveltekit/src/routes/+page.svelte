<script lang="ts">
  import GradientDemo from '../lib/GradientDemo.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head>
  <title>{data.title} · ShaderGradient SvelteKit starter</title>
  <meta
    name="description"
    content="A native Svelte gradient with normal server-rendered SvelteKit content and an independent packed-package install."
  />
</svelte:head>

<main>
  <header>
    <p class="eyebrow">Native Svelte · independent package consumer</p>
    <h1>Make room for a little color.</h1>
    <p>
      This is an ordinary server-rendered SvelteKit page. The text, request
      configuration, controls and gradient fallback arrive as HTML; only the
      WebGL scene waits for browser mount.
    </p>
    <p data-request-label={data.requestLabel} data-request-preset={data.preset}>
      Request <strong>{data.requestLabel}</strong> starts with
      <strong>{data.title}</strong>. Each request and mounted page has its own
      settings.
    </p>
  </header>

  <GradientDemo initialPreset={data.preset} requestLabel={data.requestLabel} />

  <nav aria-label="Starter demonstrations">
    <a
      href={`/away?${new URLSearchParams({ preset: data.preset, request: data.requestLabel })}`}
      >Visit the away route</a
    >
    <a href="/?preset=mint&request=mint-request">Mint request</a>
    <a href="/?preset=halo&request=halo-request">Halo request</a>
  </nav>
  <p class="note">
    The away route contains no scene. Returning mounts a fresh owned canvas.
    Motion also respects your operating system’s reduced-motion preference.
  </p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #11121a;
    color: #f4f1ec;
    font-family: system-ui, sans-serif;
    line-height: 1.6;
  }

  :global(a) {
    color: #b8ddff;
  }
  :global(:focus-visible) {
    outline: 3px solid #ffd783;
    outline-offset: 4px;
  }
  main {
    width: min(960px, calc(100% - 2.5rem));
    margin: 3rem auto;
  }
  header {
    max-width: 72ch;
  }
  h1 {
    font-size: clamp(2rem, 5vw, 3.8rem);
    line-height: 1.12;
    letter-spacing: -0.04em;
  }
  .eyebrow {
    color: #ffd783;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 0.8rem;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    margin-top: 1.75rem;
  }
  .note {
    color: #c4c5d0;
    max-width: 75ch;
  }
</style>
