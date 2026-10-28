# Visual design and responsive composition

This reference supplies **design recommendations**, not additional Skeleton requirements. The upstream contracts are the pinned CSS utilities, theme tokens, and import prerequisites in [styling.md](styling.md). Use [accessibility.md](accessibility.md) for semantic and interaction requirements. A theme is a vocabulary, not a finished composition.

- [Write a visual brief before markup](#write-a-visual-brief-before-markup)
- [Establish a small visual system](#establish-a-small-visual-system)
- [Compose from narrow to wide](#compose-from-narrow-to-wide)
- [Content, states, and visual assets](#content-states-and-visual-assets)
- [Purposeful feedback and motion](#purposeful-feedback-and-motion)
- [Performance and browser constraints](#performance-and-browser-constraints)
- [Complete responsive app-shell recipe](#complete-responsive-app-shell-recipe)
- [Acceptance and smoke expectations](#acceptance-and-smoke-expectations)

## Write a visual brief before markup

Capture the audience, their primary task, content type, and desired tone in two sentences. Choose one distinguishing device: an editorial heading, a disciplined dense list, a useful illustration, or a distinctive navigation rail. Use it consistently, not all at once.

Example brief: “A small community design studio needs to find and review project briefs. Use calm neutral surfaces, one blue accent, editorial headings, and generous space around compact, factual project cards.” This differs from a generic analytics dashboard without inventing metrics, charts, or a decorative hero unrelated to the task.

Adapt the existing app before introducing a new look: retain its active theme, loaded fonts, spacing rhythm, navigation conventions, and component shapes unless the brief requires a change. For a new app, start with one bundled theme and calibrate it rather than combining several themes or importing a dashboard template. Preserve installed package versions; a visual refresh is not a migration.

## Establish a small visual system

| Decision | Recommended starting point | Avoid |
| --- | --- | --- |
| Palette | Neutral `surface` canvas and containers; `preset-filled-brand` for mode-adaptable principal emphasis, or intentional `primary` palette styling. Reserve status palettes for labeled status. | Every card in a different brand color; gradients behind body text; translucent surfaces with unmeasured contrast. |
| Type | One loaded or system font family; clear page title, section heading, body, and metadata roles. Use weight and spacing as well as size. Keep prose around 45–75 characters per line. | A wall of equally bold labels; tiny low-contrast metadata; all-uppercase paragraphs; fonts that were named but not loaded. |
| Spacing | Use a repeated vocabulary, for example `gap-2`, `gap-4`, `gap-6`, `p-4`, `p-6`. Section gaps should exceed the gaps within their content. | A different offset for every element; changing global `--spacing` to fix one crowded control. |
| Surfaces | Canvas, content surface, and one highlighted surface. A subtle border and consistent radius can distinguish cards without shadows. | Nested cards around every sentence; many competing shadow strengths; every surface floating equally high. |
| Density | Compact navigation and metadata; comfortable reading and controls. Keep related labels, values, and actions together. | Making a productivity view a giant marketing page; making a reading view an unbroken dense table. |
| Icons | Prefer Lucide when icons improve recognition or scanning; repeat one size, stroke weight, and label gap for each role. | Mixing unrelated icon families; a glyph on every heading or row; shrinking control targets to match small glyphs. |
| Composition | One dominant task area with quieter supporting information. Align card titles, controls, and text edges. | Symmetry for its own sake; arbitrary metric tiles; decorative panels that force the useful content below the fold. |

These are starting points, not fixed ratios or a prescribed brand. Modify theme tokens intentionally rather than hardcoding competing palettes. Match backgrounds with appropriate foregrounds; the existence of a contrast token does not prove the final rendered contrast passes. Skeleton's `card` supplies radius, not padding or paint; `btn` defaults to nonwrapping text, so explicitly permit wrapping for long labels.

Calibrate one representative screen with real-length content before repeating components. Choose a canvas, a content surface, one accent treatment, four type roles, and comfortable or compact density; use the token override pattern in [styling.md](styling.md). If everything competes, remove accents, borders, and bold weights before adding decoration. If hierarchy is weak, increase section spacing and distinguish the title before enlarging every card. If content feels sparse, improve grouping and column widths rather than inventing metrics.

Adapt the recipe to the task: keep the editorial introduction for a collection or reading experience; shorten it to a title and explanation for frequent operational work. Use a list or table when users compare the same fields across many records; retain cards when descriptions and next steps need reading space. Change grid breakpoints when the actual labels and controls stop fitting, not to reach a preferred column count.

Optional effects belong to the brief, not to a mandatory redesign:

- **Glass:** author application CSS using an opaque surface/foreground fallback, then opt into a translucent `color-mix()` background and `backdrop-filter` inside a support query. Keep blur modest and localized. Test the actual backdrop; a named contrast token does not certify text over transparency.
- **Gradient or mesh:** author a linear gradient or a few static radial gradients over a solid fallback. Keep essential reading areas opaque, and remove decorative layers in forced colors if they obscure boundaries. Theme tokens can follow theme changes, but static `*-500` endpoints do not automatically change with dark mode; choose explicit light/dark values or pairing tokens and measure both schemes.
- **Typography:** define a small application-owned display/title/body/caption vocabulary if repeated compositions need it. Use the current `--typo-*--*` tokens where appropriate, load the chosen font, keep semantic heading order, and test long titles, text enlargement, and fallback fonts. An oversized or animated title is optional; it must not displace the primary task.

Names such as `preset-glass-*`, `preset-gradient-*`, `preset-input-success/error`, and `preset-typo-*` in upstream user-generated examples are **user-authored CSS**, not shipped Skeleton utilities. Validation paint still needs real validation and text errors. No custom effect guarantees contrast or dark-mode readability. Prefer static decoration; if movement is requested, provide a meaningful still fallback and reduced-motion handling, including any JavaScript animation. The shell below intentionally needs none of these effects.

## Compose from narrow to wide

- Start with one readable column. Keep the page's primary task and navigation available without a desktop sidebar. A mobile disclosure is often simpler than a modal drawer.
- Add a navigation rail and multiple content columns only when they fit their content. Use `minmax(0, 1fr)` and `min-w-0` where children must shrink; wrap long names rather than clipping meaningful text.
- Use bounded reading widths inside flexible layouts. Do not set fixed heights on cards containing user content, or hide page overflow to conceal a layout defect.
- At narrow widths, stack filter controls and reduce outer padding before reducing text size. Preserve source/reading order; the first card should remain first on every screen.
- Use local horizontal scrolling for genuinely wide tables, not for the entire app. Check an open mobile navigation panel, long labels, and enlarged text, not only the closed initial screenshot.

## Content, states, and visual assets

Use plausible domain content with specific titles, descriptions, owners, and actionable labels. Label static sample data as local example content. Derive counts from the displayed dataset; do not invent revenue, completion percentages, live activity, persistence, or successful operations. Every displayed link needs a real route, valid section target, or deliberate external destination; every button needs a working action.

Plan default, focus, hover, selected, disabled, empty, pending, error, and success states **where the flow can actually enter them**. An empty filter result needs an explanation and a working recovery action. Pending should correspond to a real operation; error/success text should report its actual outcome. Static local filtering does not need fake loading or save notifications. Make selection/status legible without color alone; keep layout stable while feedback appears.

Prefer text labels when an icon adds no information. When useful, use Lucide as the preferred coherent family, not as mandatory decoration or a replacement for labels. Assign a consistent glyph to each action or state, and keep its size, stroke weight, and spacing aligned with the surrounding density. Pair status icons with explicit status text rather than color alone. Hide reinforcing icons from assistive technology and name the actual button or link. The shell below intentionally remains icon-free and needs no icon package; do not add a dependency just to decorate it. See [Lucide styling](styling.md#lucide-icon-styling), [accessible icons and controls](lucide.md#accessible-icons-and-controls), and the [complete icon examples](lucide.md).

Use media only when it supports the content: confirm ownership/licensing, provide meaningful alternative text or `alt=""` for decoration, reserve dimensions, and choose a responsive crop. Do not depend on remote placeholder images or unreadable text baked into an image. Motion is optional; respect reduced-motion preferences rather than animating every card.

## Purposeful feedback and motion

Keep expressive branding around a calm working area. Marketing, onboarding, and
frequent operational tasks need different attention budgets; trend reports do not
establish usability gains. “Dopamine-driven” is not an engineering standard or
evidence of a neurological effect. Evaluate task completion, mistakes, recovery,
comprehension, and user control rather than time spent alone.

For genuine asynchronous work, show pending state promptly, prevent unintended
duplicate requests, retain entered values, and expose an actionable error. Confirm
success only after the operation succeeds, unless an explicit optimistic model
supports rollback. Never add a delay to make an animation visible. Keep important
results readable after any flourish ends; do not move focus to decoration.

Separate actual state from its visual interpolation: progress text and accessible
values report real work, not an eased display value. Use indeterminate feedback
when progress is unknown. Prefer CSS for hover/focus/press feedback; choose the
smallest [Svelte motion mechanism](sveltekit.md#purposeful-motion) only when it
explains a state change or preserves useful spatial continuity. Keep static
feedback and normal navigation complete without animation. Do not let two
mechanisms animate the same property on the same element.

These are design recommendations, not prescribed durations or a mandate to add
motion. See [NN/g's animation guidance](https://www.nngroup.com/articles/animation-purpose-ux/)
and the [accessibility motion requirements](accessibility.md#contrast-motion-and-scale).

## Performance and browser constraints

Establish the application's browser matrix before adopting decorative features;
[Tailwind's minimums are not the complete stack's minimums](styling.md#browser-support-is-cumulative).
Keep essential content server-renderable and independent of effects. Do not
lazy-load the LCP image; reserve media and placeholder dimensions. Import only
offered themes and load heavy effects only where used. Clean up listeners,
observers, and animation frames; suspend continuous decorative work when hidden.

Prefer transform/opacity for simple movement, but profile actual layout, paint,
and layer costs. Animated gradients, blur, masks, and CSS variables are not
automatically compositor-only. Add `will-change` only for a demonstrated need,
not to every card. See [animation performance](https://web.dev/articles/animations-guide)
and [LCP optimization](https://web.dev/articles/optimize-lcp).

For production evaluation, [Core Web Vitals](https://web.dev/articles/vitals)
good thresholds are LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1 at the 75th percentile,
segmented by mobile/desktop. These are experience metrics, not animation-duration
limits. Local traces diagnose regressions; they do not establish field results.

## Complete responsive app-shell recipe

Prerequisite: the global Tailwind/Skeleton core and framework CSS imports, Cerberus theme activation, and required forms plugin in [styling.md](styling.md). No Svelte library component import, icon dependency, server route, fetch, or asset is needed. This is an explicitly local example dataset, not a connected studio workspace. Search and status filtering apply on submission; reset restores all four briefs. The disclosure navigation and section links work without JavaScript. Filters remain honestly disabled until mount; initial SSR and client data, state, and markup agree.

Complete page content; use as the page itself, not inside another `main` landmark. If installed as a Kit route, place its contents in that route's `+page.svelte`.

**File: `ResponsiveAppShell.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  const briefs = [
    { id: 'harbor', title: 'Harbor wayfinding', owner: 'Maya Chen', status: 'In review',
      description: 'A clear walking route from the ferry landing to the community hall.',
      next: 'Check sign wording with the access group.' },
    { id: 'seeds', title: 'Seed library labels', owner: 'Jonah Reed', status: 'Ready',
      description: 'Reusable packet labels for the spring seed exchange at the library.',
      next: 'Print the approved labels on recycled stock.' },
    { id: 'workshops', title: 'Evening workshop series', owner: 'Aisha Patel', status: 'Draft',
      description: 'A simple programme for three hands-on sessions in the makerspace.',
      next: 'Confirm session titles with the facilitators.' },
    { id: 'repair', title: 'Repair café welcome guide', owner: 'Theo Brooks', status: 'Draft',
      description: 'A friendly first-visit guide explaining what to bring and what to expect.',
      next: 'Add the volunteer desk and step-free entrance details.' }
  ];
  let ready = $state(false);
  let draftSearch = $state('');
  let draftStatus = $state('All');
  let search = $state('');
  let status = $state('All');
  const visible = $derived(briefs.filter((brief) =>
    (status === 'All' || brief.status === status) &&
    `${brief.title} ${brief.owner} ${brief.description}`.toLowerCase().includes(search)
  ));

  onMount(() => { ready = true; });

  function applyFilters(event: SubmitEvent) {
    event.preventDefault();
    search = draftSearch.trim().toLowerCase();
    status = draftStatus;
  }

  function resetFilters() {
    draftSearch = search = '';
    draftStatus = status = 'All';
  }
</script>

{#snippet sectionLinks()}
  <a href="#overview">Overview</a>
  <a href="#library">Brief library</a>
  <a href="#notes">Studio notes</a>
{/snippet}

<div class="workspace">
  <a class="skip-link preset-filled" href="#main-content">Skip to content</a>
  <header class="masthead border-b border-surface-200-800">
    <a class="wordmark" href="#overview">
      <span class="brand-mark preset-filled-primary-500" aria-hidden="true">F</span>
      <span>Fieldnotes <span class="text-sm font-normal">/ Community studio</span></span>
    </a>
    <span class="text-sm text-surface-700-300">Local example workspace</span>
  </header>

  <details class="mobile-navigation border-b border-surface-200-800">
    <summary>Page navigation</summary>
    <nav class="section-links" aria-label="Mobile page sections">{@render sectionLinks()}</nav>
  </details>

  <div class="shell">
    <aside class="sidebar border-r border-surface-200-800">
      <nav class="section-links" aria-label="Page sections">{@render sectionLinks()}</nav>
      <p class="mt-8 text-sm leading-relaxed text-surface-700-300">
        A shared place for clear briefs and thoughtful community projects.
      </p>
    </aside>

    <main id="main-content" tabindex="-1" class="min-w-0 space-y-10">
      <section id="overview" aria-labelledby="page-title" class="intro">
        <div class="space-y-4">
          <p class="text-sm font-semibold text-surface-700-300">The community collection</p>
          <h1 id="page-title" class="page-title">Small projects.<br />Lasting care.</h1>
          <p class="max-w-prose text-surface-700-300">
            Find the brief, see what needs attention, and keep the next step clear.
            These four local examples show the work behind a welcoming neighbourhood.
          </p>
          <a href="#library" class="btn preset-filled-primary-500">Browse the briefs</a>
        </div>
        <div class="card preset-tonal-primary space-y-3 p-6">
          <p class="text-sm font-semibold">Working principle</p>
          <p class="text-xl font-semibold leading-snug">Useful first. Beautiful through care.</p>
          <p class="text-sm leading-relaxed">Start with the people using the space, not with the deliverable.</p>
        </div>
      </section>

      <section id="library" aria-labelledby="library-title" class="space-y-6">
        <div class="space-y-2">
          <h2 id="library-title" class="h3">Brief library</h2>
          <p class="text-sm text-surface-700-300">Search by project, owner, or description; combine with a status.</p>
        </div>
        <form onsubmit={applyFilters} aria-label="Filter briefs" aria-describedby="filter-help">
          <fieldset disabled={!ready} class="filters">
            <legend class="sr-only">Local brief filters</legend>
            <label class="label min-w-0">
              <span class="label-text">Search briefs</span>
              <input class="input" type="search" name="search" bind:value={draftSearch}
                placeholder="Try harbor or Maya" />
            </label>
            <label class="label min-w-0">
              <span class="label-text">Status</span>
              <select class="select" name="status" bind:value={draftStatus}>
                <option>All</option><option>Draft</option><option>In review</option><option>Ready</option>
              </select>
            </label>
            <button type="submit" class="btn preset-filled-primary-500">Apply filters</button>
            <button type="button" class="btn preset-outlined-surface-500" onclick={resetFilters}>Reset filters</button>
          </fieldset>
          <p id="filter-help" class="mt-3 text-sm text-surface-700-300">
            {ready ? 'Filters affect this local view only; nothing is saved.' : 'Filters require JavaScript and become available when it loads.'}
          </p>
        </form>
        <p role="status" aria-atomic="true" class="text-sm font-medium">
          Showing {visible.length} of {briefs.length} local briefs.
        </p>
        <div class="brief-grid">
          {#each visible as brief (brief.id)}
            <article class="card preset-filled-surface-100-900 brief-card p-6" aria-labelledby={`brief-${brief.id}`}>
              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span class="text-surface-700-300">{brief.owner}</span>
                <span class="rounded-base border border-surface-500 px-2 py-1 font-medium">{brief.status}</span>
              </div>
              <h3 id={`brief-${brief.id}`} class="text-xl font-semibold leading-snug">{brief.title}</h3>
              <p class="text-surface-700-300">{brief.description}</p>
              <p class="next-step border-t border-surface-300-700 pt-4 text-sm">
                <span class="font-semibold">Next step:</span> {brief.next}
              </p>
            </article>
          {:else}
            <div class="empty-state card preset-filled-surface-100-900 space-y-2 p-6">
              <h3 class="text-xl font-semibold">No briefs match these filters</h3>
              <p>Try a shorter search, choose All statuses, or use Reset filters above.</p>
            </div>
          {/each}
        </div>
      </section>

      <section id="notes" aria-labelledby="notes-title" class="border-t border-surface-200-800 pt-6">
        <h2 id="notes-title" class="h3">Studio notes</h2>
        <p class="mt-3 max-w-prose text-surface-700-300">
          Before review, describe the audience, check access needs, and write one concrete next step.
          A brief is ready when the people delivering it understand the same thing.
        </p>
      </section>
      <footer class="text-sm text-surface-700-300">Fieldnotes · Local example content, not a connected account.</footer>
    </main>
  </div>
</div>

<style>
  .workspace { max-width: 88rem; margin-inline: auto; overflow-wrap: anywhere; }
  .masthead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem; }
  .wordmark { display: inline-flex; align-items: center; gap: 0.75rem; font-weight: 700; }
  .brand-mark { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; flex-shrink: 0; border-radius: var(--radius-base); }
  .shell { display: grid; grid-template-columns: minmax(0, 1fr); }
  .sidebar { display: none; padding: 2rem 1.25rem; }
  main { padding: 2rem 1.25rem; }
  .intro { display: grid; gap: 2rem; align-items: start; }
  .page-title { font-family: var(--typo-heading--font-family); font-size: clamp(2.25rem, 5vw, 4rem); font-weight: 700; line-height: 1.08; letter-spacing: -0.035em; }
  .section-links { display: grid; gap: 0.5rem; }
  .section-links a { padding: 0.75rem; border-radius: var(--radius-base); font-weight: 500; }
  .section-links a:hover { background: var(--color-surface-100-900); }
  .mobile-navigation { padding: 0.5rem 1.25rem; }
  summary { padding-block: 0.75rem; cursor: pointer; font-weight: 600; }
  .filters { display: grid; gap: 1rem; align-items: end; min-width: 0; }
  .brief-grid { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); }
  .empty-state { grid-column: 1 / -1; }
  .brief-card { display: flex; min-width: 0; flex-direction: column; gap: 1rem; }
  .next-step { margin-top: auto; }
  .btn { min-height: 2.75rem; white-space: normal; }
  .input, .select { min-height: 2.75rem; }
  .skip-link { position: absolute; top: 0.5rem; left: 0.5rem; z-index: 10; padding: 0.75rem 1rem; transform: translateY(-200%); }
  .skip-link:focus { transform: translateY(0); }
  :is(a, button, input, select, summary):focus-visible { outline: 2px solid var(--color-surface-950-50); outline-offset: 3px; }
  @media (min-width: 48rem) {
    .brief-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .filters { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  }
  @media (min-width: 64rem) {
    .shell { grid-template-columns: 14rem minmax(0, 1fr); }
    .sidebar { display: block; }
    .mobile-navigation { display: none; }
    main { padding: 3rem; }
    .intro { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    .btn { transition: none; }
  }
</style>
```

The CSS is component-scoped; it adds layout, controlled type sizing, generous hit areas, and focus treatment without redefining Skeleton's palette. No DOM measurement, random values, current-time rendering, or storage reads determine initial content. Only `onMount` enables the local filters. All fragment links target actual sections; cards intentionally contain no fake “Open project” actions.

## Acceptance and smoke expectations

These are **checks to perform**, not a claim of tested screenshots or accessible certification:

1. **Wide layout:** At 1280px, show the sidebar and hide the mobile disclosure; the introduction and cards have two columns. The library remains the dominant working area. Titles and next steps wrap without clipping; no page-level horizontal scrollbar appears.
2. **Narrow layout:** At 375px and 320px, hide the sidebar; show a closed native Page navigation disclosure. Cards, introduction, and filter controls stack; all content and buttons fit. Opening navigation expands in document flow, without an overlay or hidden background.
3. **Keyboard navigation:** Tab to the skip link and activate it; focus reaches `main`. On mobile, Tab to the summary, use Space/Enter to toggle, then Tab to section links and activate them. Links scroll to existing sections. The disclosure stays open until toggled; it is not a modal and has no Escape or focus-trap contract. Check visible focus in both schemes.
4. **Local interaction:** After mount, enter `harbor` and apply filters: one brief remains. Reset: four return. Select Draft and apply: two remain. Apply `zzzz`: zero results and a readable empty state; Reset filters restores the list without losing keyboard access. Editing drafts alone does not change results or announce every keystroke; the persistent result region changes on apply/reset.
5. **Initial/disabled state:** Before JavaScript loads, render the same four briefs and disabled filters on server and client. With JavaScript disabled, section navigation and disclosure still work; the explanatory message remains and no controls imply filtering is available. After mount, enable filters without changing the sample dataset. No request or persistence success is reported.
6. **Visual review:** Inspect 320/375/768/1280px widths, 200% zoom, enlarged text, long replacement titles, both color schemes, reduced motion, and forced colors. Measure contrast of body/metadata, buttons, borders needed to identify controls, and focus indicators. Check the actual theme, not only token names. Screen-reader review should identify landmarks, headings, filter labels, status changes, and the empty state.
7. **Design review:** Identify the primary task at a glance. Confirm that one accent and one distinguishing device lead the composition, repeated elements share type/spacing/radius rules, and the narrow layout retains the same hierarchy. Remove decorative panels that displace useful content. Check replacement content and reachable states, not just the polished default dataset.

For real data, replace the local filter with the application's supported route/load flow and implement genuine pending/error/retry states. Do not carry a “local only” claim into a persisted feature or add fake success feedback to this recipe.

Sources: [core 5.0.1 CSS and pairings](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/theme.css), [included presets](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/presets.css), [Cerberus tokens](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/themes/cerberus.css), [Forms prerequisites](https://www.skeleton.dev/docs/svelte/tailwind-components/forms), [user-generated presets](https://www.skeleton.dev/docs/svelte/tailwind-utilities/presets#user-generated), [semantic typography examples](https://www.skeleton.dev/docs/svelte/design/typography#semantic-typography), [Svelte runes](https://svelte.dev/docs/svelte/what-are-runes), [Svelte lifecycle](https://svelte.dev/docs/svelte/lifecycle-hooks), [native disclosure behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details).
