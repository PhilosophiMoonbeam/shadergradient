<script lang="ts">
  import '../../../../demo-studio.css'
</script>

<svelte:head>
  <title>Away · Page &amp; Light</title>
  <meta
    name="description"
    content="A server-rendered pause in the Page & Light navigation study. This route owns no gradient renderer."
  />
</svelte:head>

<main class="demo-studio kit-away">
  <div class="studio-shell">
    <header class="studio-header">
      <a class="studio-brand" href="/"
        >ShaderGradient <span> / Page &amp; Light</span></a
      >
      <span class="studio-badge">SvelteKit 3 · Navigation study</span>
    </header>
    <article class="studio-intro" aria-labelledby="away-title">
      <p class="studio-eyebrow">Interlude / A page without a renderer</p>
      <h1 id="away-title">The light leaves.<br />The page stays.</h1>
      <p class="studio-lede">
        This is a real server-rendered route, not a hidden canvas. Navigating
        here destroys the previous page's owned scenes, source handles and
        fixture. There is no gradient renderer on this page.
      </p>
      <div class="studio-actions">
        <a class="studio-button" href="/" data-testid="back-link"
          >Back to Page &amp; Light ↗</a
        >
      </div>
    </article>
    <section class="studio-section" aria-labelledby="navigation-heading">
      <div class="studio-section-heading">
        <div>
          <p class="studio-eyebrow">What to observe</p>
          <h2 id="navigation-heading">A fresh tree on return.</h2>
        </div>
      </div>
      <div class="studio-cards">
        <article class="studio-card">
          <h3>Leave the scene.</h3>
          <p>
            The previous route releases its own resources. Its managed Canvas,
            independent scene, external host and Source / View handles do not
            belong to this route.
          </p>
        </article>
        <article class="studio-card">
          <h3>Keep the document.</h3>
          <p>
            The article and navigation remain useful HTML. Graphics are an
            enhancement, never a requirement for moving through the site.
          </p>
        </article>
        <article class="studio-card">
          <h3>Choose a new request.</h3>
          <p>
            Return to the default study, or ask the server for a different first
            color. Request-local settings do not share mutable state.
          </p>
          <nav class="studio-row" aria-label="New request variants">
            <a href="/?request=coral&color1=%23ff7044">Coral ↗</a>
            <a href="/?request=ocean&color1=%232280cc">Ocean ↗</a>
          </nav>
        </article>
      </div>
    </section>
    <footer class="studio-footer">
      Native Svelte · SSR preserved · No renderer on this route
    </footer>
  </div>
</main>

<style>
  .kit-away {
    --studio-accent: #e5b98b;
    min-height: 100vh;
  }
  nav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>
