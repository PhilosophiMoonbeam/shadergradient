<svelte:head><title>Away · Native ShaderGradient</title></svelte:head>
<main>
  <h1>Away from the gradient</h1>
  <p>
    This server-rendered route has no renderer. Navigating here destroys the
    previous page's owned scenes and fixture.
  </p>
  <a href="/" data-testid="back-link">Back to the native gradient</a>
</main>

<style>
  :global(body) {
    margin: 0;
    font:
      16px/1.6 system-ui,
      sans-serif;
    background: #111521;
    color: #eff2ff;
  }
  main {
    max-width: 65rem;
    margin: 4rem auto;
    padding: 1.5rem;
  }
  a {
    color: #adcaff;
  }
</style>
