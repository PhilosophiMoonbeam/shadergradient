<script setup lang="ts">
import '../../../demo-studio.css'
useHead({ title: 'Away · Scene Journal' })
</script>

<template>
  <main class="demo-studio journal-away">
    <div class="studio-shell">
      <header class="studio-header">
        <NuxtLink class="studio-brand" to="/">SG / Scene Journal</NuxtLink>
        <span class="studio-badge">Nuxt · server-rendered field notes</span>
      </header>
      <article>
        <header class="studio-intro">
          <p class="studio-eyebrow">No. 02 / Away · field notes</p>
          <h1>Away from<br /><em>the canvas.</em></h1>
          <p class="studio-lede">
            A scene can be temporary. A good page should not be. These notes
            arrive as HTML, with no graphics device required.
          </p>
          <NuxtLink class="studio-button journal-return" to="/"
            >Back to gradient ↗</NuxtLink
          >
        </header>
        <section
          class="studio-section journal-away-essay"
          aria-labelledby="field-note-title"
        >
          <div>
            <p class="studio-eyebrow">On rendering &amp; returning</p>
            <h2 id="field-note-title" class="studio-section-heading">
              The interesting part<br />is what stays.
            </h2>
          </div>
          <div class="studio-copy">
            <p>
              The title, the writing, the ten-preset collection and the editing
              desk are all part of the server-rendered journal. The palette is a
              deliberate visual fallback; it never claims to be a rendered
              shader.
            </p>
            <p>
              On the study page, the public Vue SDK creates the scene after
              hydration. Its status comes from a real rendered frame, and
              environment lighting is reported separately because an HDR image
              can still be loading or fail to arrive.
            </p>
            <p>
              Leaving the study releases its renderer and app-owned scene
              resources. Returning creates a new canvas, while request-local
              Nuxt state keeps your selected palette, form and controls through
              client navigation. A full page reload begins a new journal
              session.
            </p>
          </div>
        </section>
        <section class="studio-section" aria-label="Three things to try">
          <p class="studio-eyebrow">When you return</p>
          <h2 class="studio-section-heading">Three small experiments.</h2>
          <div class="studio-cards">
            <section class="studio-card">
              <span class="journal-note-number">01</span>
              <h3>Change the form.</h3>
              <p class="studio-copy">
                Keep a palette and move between plane, water plane and sphere.
                The same colors read differently across a surface.
              </p>
            </section>
            <section class="studio-card">
              <span class="journal-note-number">02</span>
              <h3>Let the light in.</h3>
              <p class="studio-copy">
                Open the glass study to see the SDK’s real transmission material
                against opaque stripes, lit by an HDR environment. Open sheets
                are not closed lenses.
              </p>
            </section>
            <section class="studio-card">
              <span class="journal-note-number">03</span>
              <h3>Hold a moment.</h3>
              <p class="studio-copy">
                Pause the scene, then edit its colors or resize the page. A
                still study should remain editable. System reduced motion is
                respected automatically.
              </p>
            </section>
          </div>
        </section>
        <div class="studio-section journal-away-end">
          <p class="studio-copy">Ready for another look?</p>
          <NuxtLink class="studio-button-secondary" to="/"
            >Return to your scene ↗</NuxtLink
          >
        </div>
      </article>
      <footer class="studio-footer">
        <span>ShaderGradient / Scene Journal</span
        ><span>Real navigation. Fresh renderer.</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.journal-away {
  --studio-accent: #e6ad83;
}
.journal-away :is(h1, .studio-section-heading) {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 400;
}
.journal-away h1 em {
  color: #e6ad83;
  font-weight: 400;
}
.journal-return {
  display: inline-flex;
  margin-top: 1.6rem;
}
.journal-away-essay {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  padding-block: 3rem;
  border-block: 1px solid #ffffff18;
}
.journal-away-essay .studio-copy p:first-child {
  margin-top: 0;
}
.journal-note-number {
  display: block;
  margin-bottom: 1.7rem;
  font: italic 2.4rem Georgia, serif;
  color: #e6ad83;
}
.journal-away-end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 2rem;
  border-top: 1px solid #ffffff18;
}
@media (max-width: 600px) {
  .journal-away-essay {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
</style>
