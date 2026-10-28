# Styling and themes — Skeleton v5

Use the framework-agnostic CSS from `@skeletonlabs/skeleton@5.0.1` with Tailwind CSS 4.3.3. Native-element utilities are distinct from the optional Svelte components in `@skeletonlabs/skeleton-svelte@5.0.1`. The [package exports](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/package.json) and [core stylesheet](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/index.css) define this reference's versioned contract; consult the [current Core API](https://www.skeleton.dev/docs/svelte/get-started/core-api) for usage. This skill targets SvelteKit 3.1+ exclusively, with Kit 3.1.0 as the exact tested baseline; check matching package metadata and source contracts before using later releases.

## Theme registration and activation

A theme is a set of CSS custom properties scoped by `[data-theme='name']`. Import its stylesheet **and** activate its exact name on the root HTML element. Importing alone does not select it. Register only themes the application uses; each import adds CSS.

Global stylesheet example (`src/app.css`):

```css
@import 'tailwindcss';
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';
@import '@skeletonlabs/skeleton/themes/cerberus';

@plugin '@tailwindcss/forms';
```

The forms plugin requires the installed `@tailwindcss/forms` package and is required for Skeleton's documented native form utilities, not for every use of Skeleton CSS. Keep **all imports before** `@plugin`, application `@source` directives, variants, and style rules. Presets are included in the core import; the framework CSS import supplies component styles without a Skeleton `node_modules` source scan. Shared application packages outside automatic detection can still need `@source`; paths are stylesheet-relative. Load this global stylesheet through the root layout. Set `data-theme="cerberus"` on the existing `<html>` element in `src/app.html`; preserve language, metadata, CSP, and SvelteKit's head and body placeholders.

For a custom theme:

1. Open the [Theme Generator](https://themes.skeleton.dev/), linked from [Themes](https://www.skeleton.dev/docs/svelte/design/themes).
2. Give the theme a unique name; customize palette, independently assigned contrast colors, brand, typography, spacing, and radii. Export its CSS.
3. Compare output with the [5.0.1 theme shape](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/themes/cerberus.css). For an existing custom theme, use the [import workflow](https://themes.skeleton.dev/themes/import) recommended by the [migration guide](https://www.skeleton.dev/docs/svelte/get-started/migrate-from-v4). Import accepts CSS/TS/JS, but strips custom fonts: restore them through Typography controls and load their assets. Do not assume lossless legacy conversion.
4. Save the exported stylesheet, for example `src/acme.css`. Add `@import './acme.css';` after the imported Skeleton theme and before directives or style rules. Set `data-theme="acme"` on `<html>` to match the exported selector, not necessarily the file name. Inspect current tokens, font loading, and both modes.
5. If switching at runtime, change `document.documentElement.dataset.theme` in browser-only code to one of your imported theme names. Ensure the initial server theme and any theme-dependent rendered text agree.

Core v5 tokens include (double hyphens inside typography names are significant):

| Purpose | Properties |
| --- | --- |
| Palette | `--color-{primary,secondary,tertiary,success,warning,error,surface}-{50,100,200,300,400,500,600,700,800,900,950}` |
| Foreground for each shade | `--color-primary-contrast-500` and equivalent palettes/shades; `--color-primary-contrast-light` and `--color-primary-contrast-dark` are theme-authored foreground choices |
| Independent brand emphasis | `--color-brand-light`, `--color-brand-dark`, `--color-brand-contrast-light`, `--color-brand-contrast-dark` |
| Root background | `--color-root-bg-light`, `--color-root-bg-dark` |
| Typography | `--typo-base--font-family`, `--typo-base--color-light`, `--typo-base--color-dark`; corresponding `--typo-heading--*` and `--typo-anchor--*` properties |
| Density and element size | `--spacing`; `--spacing-elem-{xs,sm,base,lg,xl,2xl…9xl}` |
| Type scale and shape | `--text-scaling`, `--radius-base`, `--radius-container`, `--corner-shape-base`, `--corner-shape-container` |
| Edge widths | `--default-border-width`, `--default-ring-width`, `--default-outline-width` |

Override a token after the imported theme; scope it to the theme rather than globally altering every palette:

```css
[data-theme='cerberus'] {
  --radius-container: 0.75rem;
  --typo-heading--font-family: system-ui, sans-serif;
  --typo-base--font-family: system-ui, sans-serif;
  --color-root-bg-light: var(--color-surface-50);
  --color-root-bg-dark: var(--color-surface-950);
}
```

Use the smallest override that expresses the brief. `--radius-base` shapes buttons and controls; `--radius-container` shapes cards. Body type uses `--typo-base--*`, while `h1`–`h6` classes consume heading tokens; an unclassed heading does not acquire that styling. The recipe's custom `.page-title` consumes the heading family but explicitly sets weight and size, so change those local declarations if that title needs a different treatment. Corner-shape tokens require explicit utilities or application selectors; they do not automatically reshape every button/card.

Keep `--spacing` stable for a local density change: adjust card padding, row gaps, and control sizing instead. `--text-scaling` changes the core's Tailwind text sizes **and their line-height values**, not arbitrary `clamp()` sizes or browser zoom. When recoloring a palette, update its full shade ramp and per-shade contrast assignments together; changing only `--color-primary-500` neither rebuilds the ramp nor recomputes foreground contrast. Compare the title, body, metadata, action, form, and card in both modes before propagating the choice.

Sources: [Themes](https://www.skeleton.dev/docs/svelte/design/themes), [installation](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit), [pinned core CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/index.css), [pinned Cerberus theme](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/themes/cerberus.css), [Forms prerequisites](https://www.skeleton.dev/docs/svelte/tailwind-components/forms), [CSS import ordering](https://developer.mozilla.org/en-US/docs/Web/CSS/@import).

## Colors, pairings, and presets

Use semantic palettes instead of hardcoded colors: `surface` for neutral containers and `success`, `warning`, or `error` for status accompanied by text. Use independent brand tokens/presets for an adaptable principal action; intentional `primary`-palette styling remains valid. Brand light/dark may select different palettes or shades, and their contrast values are assigned independently, not computed from the background. Standard utilities include `bg-primary-500`, `text-surface-950`, `border-secondary-600`, and `ring-primary-500`.

A single shade does **not** automatically invert in dark mode. Pairings use `{property}-{color}-{lightShade}-{darkShade}`; for example `bg-surface-100-900` selects 100 in a light color scheme and 900 in a dark color scheme. Supported pairs are `50-950`, `100-900`, `200-800`, `300-700`, `400-600`, and their reverses. Pairing values use CSS `light-dark()`, so check the computed `color-scheme`, not just the presence of a `.dark` class.

Match a filled background with its contrast token, such as `bg-primary-500 text-primary-contrast-500`, or `bg-secondary-200-800 text-secondary-contrast-200-800`. These are theme-supplied values, not a runtime contrast calculator. Recheck contrast after theme edits, opacity, gradients, or translucent backgrounds.

The preset styles have **different rules** in [5.0.1's actual CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/presets.css):

| Class example | What it sets |
| --- | --- |
| `preset-filled-primary-500` | Background primary 500; text primary contrast 500. |
| `preset-filled-primary-100-900` | Background primary 100/900; corresponding contrast 100/900. |
| `preset-tonal-primary` | Background primary **50/950**; text primary **950/50**. No shade suffix. |
| `preset-outlined-primary-500` | A 1px primary-500 border only; does **not** assign a matching text color or filled background. |
| `preset-outlined-primary-200-800` | A 1px primary 200/800 border only. Supply foreground/background as needed. |
| `preset-filled` | Neutral surface 950/50 background with surface 50/950 text. |
| `preset-tonal` | A **10%** surface 950/50 mix with transparent; explicit surface 950/50 text. |
| `preset-outlined` | Neutral 1px surface 950/50 border; foreground/background are inherited. |
| `preset-filled-brand` | Mode-specific brand background and independent brand contrast foreground. |
| `preset-tonal-brand` | A **25%** mode-specific brand mix with transparent; explicit surface 950/50 text. |
| `preset-outlined-brand` | A 1px mode-specific brand border only; supply foreground/background as needed. |

Do not invent `preset-tonal-primary-500`, arbitrary filled shade suffixes, or a uniform “all presets use 500” rule. Separate shape (`btn`, `card`) from paint (`preset-*`) and layout (`p-4`, `gap-4`).

Slash opacity modifiers such as `bg-primary-500/20` change the composite color through color mixing; remeasure contrast over the actual backing surface. Neither OKLCH palettes nor contrast token names certify WCAG compliance.

Optional strict palette clearing is advanced Tailwind configuration, **not** a Skeleton prerequisite. A wildcard reset such as `--color-*: initial` clears intended semantic colors too if placed after their declarations. Do not append it to the working recipe. In an intentionally rebuilt theme layer, order the reset **before** the complete definitions to retain, then restore all required semantic shades, contrast colors, brand and derived color mappings; retain any other deliberately used colors. Review import/layer order and generated utilities before adoption. It does not prohibit arbitrary CSS colors.

Sources: [Colors](https://www.skeleton.dev/docs/svelte/design/colors), [Presets](https://www.skeleton.dev/docs/svelte/tailwind-utilities/presets), [pinned pairing definitions](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/theme.css), [pinned preset CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/presets.css), [Tailwind custom palette](https://tailwindcss.com/docs/colors#using-a-custom-palette).

## Lucide icon styling

When icons carry meaning, prefer the coherent Lucide family from `@lucide/svelte@1.61.0`; keep icon-free recipes dependency-free. See [imports and package boundaries](lucide.md#imports-and-package-boundary). Lucide renders inline SVG: it needs no icon stylesheet, Tailwind plugin, package `@source` scan, or DOM initialization.

The default stroke is `currentColor`, so icons inherit the surrounding foreground, including Skeleton preset contrast colors and theme changes. Prefer inherited color or a local semantic `text-*` utility to hardcoded icon colors; an explicit `color` prop sets the SVG stroke and replaces that inheritance. Check the actual foreground in both schemes rather than assuming every palette shade adapts.

Keep the rendered SVG a **direct child** of a Skeleton `btn` or `btn-icon`. Their `> :where(svg)` rules size it from `--btn-size`, including the selected button-size variant; a wrapper breaks that automatic sizing. Use those defaults for ordinary controls. An explicit Tailwind `size-4` on the icon overrides the default dimensions; the glyph size is not the button's hit-target size.

Choose one owner for each property: component `size`/`strokeWidth` props or deliberate local CSS. CSS width/height and `stroke-width` declarations override SVG presentation attributes, so `size-4` or `stroke-1` can win over `size` or `strokeWidth` props. Avoid blanket global `.lucide` rules that silently override per-icon or subtree defaults. See [props and styling](lucide.md#props-and-styling), [subtree defaults](lucide.md#subtree-defaults), and [accessible controls](lucide.md#accessible-icons-and-controls) for complete examples.

Sources: [Lucide Svelte styling](https://lucide.dev/guide/svelte/advanced/global-styling), [pinned SVG rendering](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), [pinned SVG attribute generation](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/buildLucideIconNode.js), [Skeleton button sizing](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/buttons.css), [Tailwind stroke width](https://tailwindcss.com/docs/stroke-width).

## Typography, spacing, and responsive layout

Most typography treatments are opt-in: use `h1`–`h6`, `anchor`, `blockquote`, `pre`, `kbd`, `abbr`, `cite`, `quote` (on `<q>`), `sub`, `sup`, and `time` classes on appropriate semantic elements; `ins`, `del`, and `mark` are also available. Inline `<code>` instead receives base element styling in 5.0.1, with resets inside `<pre>` and `.ec-line`; it is not an opt-in `code` utility. Preserve semantic code markup rather than treating a migration-tool warning as grounds to delete working styling. A visual class is not a semantic heading level: `<h2 class="h3">` remains a level-two heading. Choose levels from document structure and visual size separately. Font-family tokens select fonts, which must also be loaded unless they are system fonts.

The pipeline is **theme token → Tailwind theme token → utility**. For example, `--typo-base--font-family` maps through `--font-typo-base` to `font-typo-base`; `--typo-base--line-height` through `--leading-typo-base` to `leading-typo-base`; and `--radius-container` to `rounded-container`. Palette `--color-primary-500` enables `bg-primary-500`, `text-primary-500`, `outline-primary-500`, and other color properties. Not every theme property has a dedicated utility: consume unmapped values directly, for example `[font-style:var(--typo-heading--font-style)]`.

Base, heading, and anchor typography cover family, weight, style, stretch, kerning, letter/word spacing, text shadow, hyphenation, transform, and light/dark colors. Base and anchor also expose font-size/line-height; headings derive size/leading from the typographic scale, not separate heading-size tokens. Anchor decoration has line, color, style, thickness, underline offset/position and hover/active/focus state properties such as `--typo-anchor--hover--text-decoration-line`. Use the [Core API](https://www.skeleton.dev/docs/svelte/get-started/core-api) for exact names. Dividers use the default border width. Preserve visible focus outlines when adjusting any edge-width token; CSS does not enforce an accessible minimum.

Use the theme's spacing scale with `p-4`, `gap-4`, `space-y-4`, and related Tailwind utilities. Changing `--spacing` affects many dimensions, not only padding: review widths, heights, gaps, and hit targets after altering it. Use a small spacing vocabulary consistently rather than arbitrary pixel offsets.

Start with one column, `w-full`, and readable maximum widths; add `md:grid-cols-2` or `lg:grid-cols-3` only when content benefits. Use `min-w-0` for grid and flex children that must shrink, allow labels to wrap, and use horizontal overflow for wide data tables rather than squeezing cells or changing their semantics. Keep visual order consistent with keyboard and reading order. Check narrow widths and zoom in real browsers.

Sources: [Typography](https://www.skeleton.dev/docs/svelte/design/typography), [exact typography CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/typography.css), [Spacing](https://www.skeleton.dev/docs/svelte/design/spacing), [Core API mappings](https://www.skeleton.dev/docs/svelte/get-started/core-api).

For visual direction, hierarchy, density, and a complete responsive shell, see [design.md](design.md). These utilities implement a design; they do not choose one.

## Tailwind CSS-first extensions

Keep Skeleton's theme as the palette, typography, and shape authority. Add a top-level `@theme` only for new Tailwind utility or variant names; ordinary custom properties belong in `:root`, a theme selector, or a component rule when no generated name is needed. A supported namespace matters: `--ease-expressive` enables `ease-expressive`; an arbitrary variable name does not create a utility. Existing scoped Skeleton token overrides do not need another `@theme` block.

Append this extension after the global stylesheet's imports. `@utility` registers an application utility in Tailwind's utilities layer, including support for variants; it does not add a new Skeleton preset family:

```css
@theme {
  --ease-expressive: cubic-bezier(0.2, 0.8, 0.2, 1);
}

:root {
  --frame-width: 1px;
}

@utility expressive-frame {
  padding: var(--frame-width);
  border-radius: var(--radius-container);
  background-image: linear-gradient(
    135deg,
    var(--color-primary-500),
    var(--color-secondary-500),
    var(--color-tertiary-500)
  );
}
```

Use the frame around a stable reading surface, not as the text background:

```html
<div class="expressive-frame">
  <section class="card bg-surface-50-950 text-surface-950-50 p-6">
    <h2 class="h3">Release overview</h2>
    <p>The checklist is ready for review.</p>
  </section>
</div>
```

Tailwind 4 supports linear, radial, and conic gradients with semantic palette stops. These complete decorative fragments have explicit dimensions:

```html
<div aria-hidden="true" class="h-16 rounded-container bg-linear-to-br from-primary-500 to-secondary-500"></div>
<div aria-hidden="true" class="h-16 rounded-container bg-radial from-secondary-300 to-primary-900"></div>
<div aria-hidden="true" class="size-24 rounded-container bg-conic from-primary-500 via-tertiary-500 to-primary-500"></div>
```

Gradients are static until classes, variables, or styles change. Tailwind defaults gradient interpolation to OKLab; use a documented interpolation modifier when a different path is intentional. OKLCH separates lightness, chroma, and hue, but neither equal lightness nor a vivid palette guarantees contrast; high chroma can exceed a display's gamut. Check intermediate gradient colors and keep essential text on a verified surface.

Source detection and runtime values solve different problems. Tailwind scans text, not evaluated Svelte expressions: map finite choices to complete literal classes instead of constructing `bg-${palette}-500`. Automatic detection skips dependencies, ignored files, and CSS files. Register required external application sources with stylesheet-relative `@source` paths; a source directive does not make interpolated names discoverable. Do not add a legacy Skeleton package scan to replace the v5 framework CSS import.

For continuous runtime values, keep one detectable utility and update a custom property instead of generating unbounded class names. Standalone decorative preview:

**File: `OpacityPreview.svelte`**

```svelte
<script lang="ts">
  let { opacity = 0.6 }: { opacity?: number } = $props();
</script>

<div aria-hidden="true" class="h-16 rounded-container bg-primary-500 opacity-(--preview-opacity)"
  style:--preview-opacity={opacity}></div>
```

Sources: [Tailwind theme namespaces and scope](https://tailwindcss.com/docs/theme), [custom utilities](https://tailwindcss.com/docs/adding-custom-styles#adding-custom-utilities), [gradients](https://tailwindcss.com/docs/background-image), [source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files).


## Native button, form, card, and table classes

| Native markup | V5 utility classes | Preserve behavior |
| --- | --- | --- |
| `<button>` / navigation `<a>` | `btn`, `btn-{size}`, `btn-icon`, `btn-icon-{size}`; add a preset | Use a button for an action, anchor with `href` for navigation. Set button `type`; use native `disabled`. Name icon-only buttons. |
| `<label>` + controls | `label`, `label-text`, `input`, `textarea`, `select`, `checkbox`, `radio`; `field-{size}` | Enable the forms plugin. Preserve type, label association, `name`, required state, and native keyboard behavior. |
| `<fieldset>` / `<legend>` | `fieldset`, `legend` | Group related controls semantically; a visual field group is not a replacement. |
| `<meter>` | `meter` | Represent a bounded scalar measurement, not task progress. Supply an accessible label, correct bounds/value, and useful textual value. |
| Adjacent field controls | `field-group`, with explicit grid columns | Keep each input/select/button named; visual prefixes do not necessarily label a field. |
| `<article>` / `<section>` / container | `card`; add a preset and padding | `card` adds hover treatment automatically on actual anchors/buttons, not ordinary containers. Use real links/buttons; avoid nested interactive elements inside a card link. |
| `<table>` in a wrapper | `table-wrap`, `table` | Use caption, header cells and scope. Actions belong in cells, not row click handlers. |
| Native `<dialog>` | `dialog`, optional `dialog-fullscreen`, `animate-dialog`; add paint | CSS does not create modality; use `showModal()` and the interaction contract below. |
| `<details>` / `<summary>` | `disclosure`, inner `disclosure-content`; optional `disclosure-group` wrapper | Preserve native toggling, marker, accessible summary, and document flow. |

Element sizes `xs`, `sm`, `base`, `lg`, `xl`, `2xl` through `9xl` expose `--spacing-elem-*` and spacing utilities such as `size-elem-xl`, `w-elem-lg`, and `h-elem-sm`. Control variants remain separate: coordinate `field-xl` with `btn-xl`; there is no group-size variant. Direct SVG children of supported controls auto-size, not every arbitrary nested icon format. Neither size names nor density tokens certify minimum hit targets.

`field-group` is a grid with small gaps and joined logical corner radii. Set one track per child; use `minmax(0,1fr)` for a shrinking input. Migrate legacy group wrappers to `field-group`, prefix cells to semantic `label`/appropriate `span` with `label label-text`, and use ordinary `input`, `select`, and `btn` children. Independently name currency selects and icon-only actions.

Standalone grouped field; compose into a real form when submission is needed:

**File: `UsernameField.svelte`**
```svelte
<script lang="ts">
  const uid = $props.id();
</script>

<div class="field-group grid-cols-[auto_minmax(0,1fr)]">
  <label class="label label-text" for={`${uid}-username`}>Username</label>
  <input id={`${uid}-username`} class="input field-xl min-w-0"
    type="text" name="username" autocomplete="username" required />
</div>
```

Standalone local example content; no network dependency. Svelte supplies an instance ID that stays consistent through SSR hydration.

**File: `Summary.svelte`**
```svelte
<script lang="ts">
  const uid = $props.id();
  const titleId = `${uid}-summary-title`;
</script>

<section class="card preset-filled-surface-100-900 space-y-4 p-4 md:p-6" aria-labelledby={titleId}>
  <h2 id={titleId} tabindex="-1" class="h3">Project summary</h2>
  <p>Two tasks remain before the release.</p>
  <div class="table-wrap">
    <table class="table">
      <caption class="p-2 text-left">Release checklist</caption>
      <thead>
        <tr><th scope="col">Task</th><th scope="col">Status</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Documentation</th><td>In review</td></tr>
        <tr><th scope="row">Keyboard checks</th><td>Pending</td></tr>
      </tbody>
    </table>
  </div>
  <a href={`#${titleId}`} class="btn preset-tonal-primary">Return to summary heading</a>
</section>
```

Each instance owns its heading ID, label association, and real fragment target; callers do not need to allocate IDs. Do not replace `$props.id()` with random values or a shared module counter. See [accessibility.md](accessibility.md) for a local-only form recipe and interaction checks.

Sources: [Buttons](https://www.skeleton.dev/docs/svelte/tailwind-components/buttons), [Forms](https://www.skeleton.dev/docs/svelte/tailwind-components/forms), [Cards](https://www.skeleton.dev/docs/svelte/tailwind-components/cards), [Tables](https://www.skeleton.dev/docs/svelte/tailwind-components/tables), [Svelte hydration-safe instance IDs](https://svelte.dev/docs/svelte/$props#%24props.id()).

### Native dialogs, disclosures, and decorative geometry

`dialog` CSS exposes `--dialog-top`, `--dialog-left`, `--dialog-translate`, `--dialog-width`, `--dialog-height`, `--dialog-max-width`, `--dialog-radius`, and `--dialog-backdrop`. `showModal()` supplies top-layer modality and background inertness; `show()` is nonmodal. Close with `close()` or a `method="dialog"` form. Provide a name, deliberate initial focus, explicit close/cancel, Escape behavior, and focus restoration. Newer `closedby="any"` light-dismiss and `command`/`commandfor` invoker controls have separate browser support; do not assume them from basic dialog support. See [accessibility.md](accessibility.md#modal-and-tooltip-interaction-contracts).

For native disclosure styling, use `details.disclosure > summary` followed by a `div.disclosure-content`. A shared `name` enables exclusive native grouping where supported; keep group names unique across unrelated component instances. Its intrinsic-size animation uses `::details-content` and `interpolate-size: allow-keywords`; unsupported browsers retain instant native toggling. `animate-dialog` uses `--anim-duration`, discrete display/overlay transitions, and `@starting-style`. These animations still need an application reduced-motion policy.

Optional `mask mask-circle`, `mask mask-squircle`, `mask mask-hexagon`, and other documented shapes are decorative. `mask-custom` requires user-authored CSS. Mask only a decorative layer, never essential content or the focusable control itself: unsupported masking and a failed supported mask resource differ, and an empty/failed/unsupported-format resource can hide the element entirely. Keep meaningful media/text and accessible names outside the mask.

Optional corner utilities (`corner-shape-bevel`, `corner-shape-squircle`, documented side/corner/logical variants or arbitrary values) need a nonzero `rounded-*` radius. `corner-shape-base`/`corner-shape-container` consume their theme tokens only when applied. Preserve useful rounded geometry where unsupported; shape must not carry essential meaning or clip focus indicators. See the [corner catalog](https://www.skeleton.dev/docs/svelte/tailwind-utilities/corner-shapes) rather than inventing class names.

Sources: [Dialogs](https://www.skeleton.dev/docs/svelte/tailwind-components/dialogs), [Disclosures](https://www.skeleton.dev/docs/svelte/tailwind-components/disclosures), [Masks](https://www.skeleton.dev/docs/svelte/tailwind-utilities/masks), [mask resource failure](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image).

## Dark mode, initial paint, and hydration

Media strategy is the default: CSS follows `prefers-color-scheme`. In [core 5.0.1](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/globals.css), `:root` sets `color-scheme: light` and switches to `dark` through `@variant dark`. The `html` background uses `light-dark(var(--color-root-bg-light), var(--color-root-bg-dark))`; body foreground uses `light-dark(var(--typo-base--color-light), var(--typo-base--color-dark))`. Pairings likewise inherit the computed scheme. For an explicit class-based choice, define this after imports in the global stylesheet and toggle `.dark` on `<html>`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Alternatively, choose the attribute strategy instead:

```css
@custom-variant dark (&:where([data-mode=dark], [data-mode=dark] *));
```

Then set `data-mode="dark"` on `<html>`. Choose **one** strategy; changing `data-mode` does nothing to a `.dark`-configured variant. `data-theme` chooses a theme, not light or dark mode. Tailwind's `scheme-light` and `scheme-dark` locally force `color-scheme` and thus `light-dark()` colors and native control appearance; they do not change which `dark:` selectors match. For theme-scoped rules use ordinary `[data-theme='name']` selectors, optionally with `@variant dark` inside.

For an SSR app, choose the initial mode deliberately. CSS media mode needs no browser JavaScript to determine the initial color scheme. Render a persisted explicit choice server-side from a cookie, or apply it with a small pre-paint browser script consistent with the selected CSS strategy. The server cannot read `localStorage` or `matchMedia`. Reading preferences only in `onMount` is browser-safe but occurs after mount, so the default theme or mode may visibly flash. A head script must respect the application's CSP and handle unavailable storage. Preserve per-request preference isolation and cookie-aware cache behavior.

Keep server and client initial component markup deterministic. If an early script changes the root mode, do not render a different mode label or icon during hydration from a separately initialized client preference. Establish one source of truth; render mode-dependent controls consistently, then update after mount when necessary. CSS-only color changes do not justify suppressing hydration warnings.

Sources: [pinned root/body CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/globals.css), [Mode](https://www.skeleton.dev/docs/svelte/guides/mode), [Tailwind color scheme](https://tailwindcss.com/docs/color-scheme), [Tailwind initial-paint guidance](https://tailwindcss.com/docs/dark-mode), [Svelte lifecycle hooks](https://svelte.dev/docs/svelte/lifecycle-hooks).

## Browser support is cumulative

Tailwind 4 documents Safari 16.4+, Chrome 111+, and Firefox 128+ as its baseline, not the complete application's browser matrix. Skeleton 5.0.1 uses `light-dark()` for essential root, text, and paired colors; some Tailwind-baseline browsers do not support it. Define the application matrix from every essential feature and provide deliberate fallback styling where required. An optional corner shape, disclosure animation, or view-transition enhancement has a separate support requirement and must not hide content or prevent interaction when unsupported.

Tailwind 4.3.3 includes first-party scrollbar styling, `@container-size` (not `size-container`), `zoom-*`, and `tab-*`. Their existence does not imply uniform browser support or make them necessary for a Skeleton app. Preserve scroll affordances and user zoom; CSS `zoom` is not a substitute for responsive layout or browser zoom testing. Validate essential colors, layout, and controls in actual target browsers, not only the current development browser.

Sources: [Tailwind browser baseline](https://tailwindcss.com/docs/upgrade-guide#browser-requirements), [4.3 utility additions](https://tailwindcss.com/blog/tailwindcss-v4-3), [exact 4.3.3 utility definitions](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/packages/tailwindcss/src/utilities.ts), [Skeleton root CSS](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/base/globals.css), [`light-dark()` support](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark#browser_compatibility).


## Styling debugging checklist

1. Inspect `<html>` in the browser. Confirm the correct imported `data-theme`, chosen mode selector, and computed `color-scheme`. Check ancestor `scheme-light` and `scheme-dark` overrides when pairings appear stuck.
2. Inspect computed styles and CSS rules. Check whether theme tokens resolve or are unset or overridden. For outlined presets, inspect the border separately from inherited text and background.
3. If `preset-*` does nothing, confirm the core stylesheet is imported globally. If forms differ, confirm `@plugin '@tailwindcss/forms'` and its installed dependency.
4. If utilities are missing, confirm Tailwind processing, the framework CSS import, and source detection for application/shared packages. Keep complete class strings visible to Tailwind; do not build names as `"bg-" + color + "-500"`. Map choices to full literal classes.
5. Compare both schemes for every active theme in actual target browsers: pairing colors use modern `light-dark()`; native form rendering varies by platform. A screenshot from one browser is insufficient.
6. Reload with JavaScript delayed and disabled, and with a persisted opposite-mode preference. Observe first paint, hydration console warnings, and navigation consistency. Use the interaction checklist in [accessibility.md](accessibility.md) before shipping.

Sources: [installation](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit), [Mode](https://www.skeleton.dev/docs/svelte/guides/mode), [Tailwind class detection](https://tailwindcss.com/docs/detecting-classes-in-source-files), [Forms browser support](https://www.skeleton.dev/docs/svelte/tailwind-components/forms).
