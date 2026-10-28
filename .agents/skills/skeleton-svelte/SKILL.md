---
name: skeleton-svelte
description: >-
  Build, style, debug, or migrate Skeleton UI 5 apps exclusively on SvelteKit 3.1+,
  with Svelte 5, Tailwind CSS 4, and Lucide for useful icons. Use for components,
  themes, icon imports and accessible icon controls, responsive composition,
  progressive motion, SSR, and server forms. Exact framework baseline:
  Skeleton 5.0.1, Svelte 5.57.2, Kit 3.1.0, Tailwind 4.3.3; optional
  @lucide/svelte 1.61.0. Older conventions are migration context only. Not React.
compatibility: >-
  Skeleton core and Svelte components 5.0.1, Svelte 5.57.2, SvelteKit 3.1.0,
  Tailwind CSS 4.3.3; optional @lucide/svelte 1.61.0 (Svelte ^5 peer).
  Targets Kit 3.1+ exclusively with compatible Node/Vite/adapter tooling;
  later releases need matching API checks. Bundled guidance and installed
  packages support offline inspection; installation requires registry/cache access.
metadata:
  version: "3.1"
  skeleton-core: "5.0.1"
  skeleton-svelte: "5.0.1"
  svelte: "5.57.2"
  sveltekit: "3.1.0"
  tailwindcss: "4.3.3"
  lucide: "1.61.0"
---

# Skeleton + SvelteKit + Tailwind CSS + Lucide

Create coherent UI using Skeleton's theme vocabulary and the application's
visual language. Prefer styled native HTML for simple controls; use a verified
framework component when managed interaction requires it. Prefer Lucide when an
icon improves comprehension, not as mandatory decoration. React is out of scope.

## Version boundary: inspect before using examples

The exact reference baseline is **`@skeletonlabs/skeleton@5.0.1`** (CSS),
**`@skeletonlabs/skeleton-svelte@5.0.1`**, **Svelte `5.57.2`**,
**SvelteKit `3.1.0`**, and **Tailwind CSS `4.3.3`**.

The independently observed icon pin is **`@lucide/svelte@1.61.0`**, with a
Svelte `^5` peer. Install it only where icons are used; existing dependency-free
recipes do not require it.

- **Existing app:** require SvelteKit 3.1 or later. Inspect resolved versions;
  preserve compatible tooling, adapter, application conventions, and unrelated work.
  An older app needs the [prerequisite migration](references/migration.md), not
  a legacy-compatible implementation. Establish migration scope before editing it.
- **Later release:** retrieve matching primary documentation/types/source for
  affected APIs. The tested 3.1.0 baseline does not certify all future releases.
  Do not downgrade a supported app merely to copy an example.
- **Greenfield:** use [setup](references/setup.md); inspect scaffold output and
  dependency contracts rather than assuming CLI defaults. Never force peers.

## Read only the references needed for the task

Read the relevant sections, not the full reference set.

| Task | Reference and starting section |
| --- | --- |
| Installation or toolchain/CSS integration failure | [Setup](references/setup.md): version contract, existing or greenfield project, targeted diagnosis |
| Explicit Skeleton 2/3/4-to-5 or Kit 3 migration; mixed-major APIs | [Migration](references/migration.md): staged migration, affected configuration and every caller |
| Choose a control; verify exports, props, callbacks, anatomy | [Components](references/components.md): functional inventory, native alternatives, installed-types lookup |
| Implement a functional control; customize providers/elements | [Recipes](references/recipes.md) for complete controls; [Components](references/components.md#six-supported-composition-patterns) for provider/element patterns |
| Find an icon or confirm its installed export | [Discover and verify an icon](references/lucide.md#discover-and-verify-an-icon); catalog names must match the resolved package |
| Import icons; style SVGs or label icon controls | [Lucide imports](references/lucide.md#imports-and-package-boundary), [props and styling](references/lucide.md#props-and-styling), and [accessible icons and controls](references/lucide.md#accessible-icons-and-controls) |
| Lucide export, SVG/CSS, accessibility, or context failure; work offline | [Troubleshooting](references/lucide.md#troubleshooting) and [offline package inspection](references/lucide.md#offline-package-inspection) |
| Finite runtime icon selection or static subtree defaults | [Finite runtime selection](references/lucide.md#finite-runtime-selection) and [subtree defaults](references/lucide.md#subtree-defaults) |
| Typed icon consumer with reactive runtime props | [Reactive consumer](references/lucide-patterns.md#reactive-consumer); validate external string keys before selecting component values |
| Fill/shape composition, RTL, custom data, or optional Lucide Lab | [Fill and composition](references/lucide-patterns.md#fill-and-composition), [directional icons](references/lucide-patterns.md#directional-icons), or [custom icon data and Lab](references/lucide-patterns.md#custom-icon-data-and-lab) |
| Theme, tokens, brand presets, native classes, dark mode | [Styling](references/styling.md): theme registration, colors/presets, mode, diagnosis |
| Page composition, visual refinement, or performance | [Design](references/design.md): brief, visual system, purposeful feedback, performance constraints; app-shell recipe when useful |
| Labels, errors, keyboard/focus, contrast, continuous motion | [Accessibility](references/accessibility.md): relevant interaction contract and browser checks |
| Runes, SSR, lifecycle, route/load data, native server forms | [SvelteKit](references/sveltekit.md): selected framework boundary or example |
| Springs, transitions, attachments, or route view transitions | [SvelteKit](references/sveltekit.md#purposeful-motion): smallest mechanism, reduced motion, navigation lifecycle |
| Conflicting documentation, offline inspection, evidence | [Sources](references/sources.md): authority hierarchy, primary-source map, verification limits |

For a page refresh, combine **design + styling** and relevant accessibility
checks. Add **components + the selected recipe** for interaction, **Lucide** when
icons help, or **SvelteKit** for server data/forms. An explicit migration needs
**migration + setup** and each affected control's contract. Do not copy the app
shell merely to restyle a page.

## Blind-session workflow

Scale inspection to the request: a card restyle needs its markup, theme/CSS, and
relevant versions; setup or migration needs the full toolchain/configuration.

1. **Inspect and route.** Establish existing-app, greenfield, or migration scope.
   Distinguish manifest ranges from resolved versions. Inspect affected callers;
   read corresponding references. Preserve package manager and lockfile; merge
   configuration rather than replacing unrelated work.
2. **Calibrate the design.** Inspect representative screens, theme tokens, type,
   spacing, and density. Preserve the visual language unless redesign is requested.
   For new compositions, establish hierarchy, primary action, realistic states,
   and narrow/wide layouts before markup.
3. **Implement the verified contract.** Confirm exact declarations for changed
   APIs and source when types omit behavior. Adapt the selected recipe's labels,
   callbacks, anatomy, and rendered tags. Keep mutable state instance-owned.
   Preserve application validation/persistence; local previews do not save data.
4. **Verify affected behavior.** Use the project's authorized check/build workflow.
   For visual work, inspect narrow/wide rendering, contrast, and overflow. Exercise
   relevant keyboard/focus, state, native/enhanced form, and hydration checks from
   [accessibility](references/accessibility.md). Setup or migration also needs a
   production build and representative runtime smoke.
5. **Report evidence.** State checks actually performed and material limits.
   Compilation is not proof of visual quality, accessibility, persistence,
   deployment, or compatibility across an entire peer range.

## Version-specific traps

- **Modern framework conventions are mandatory.** Use the Vite-based Kit
  configuration, `$app/tsconfig`, `#lib/*`, `$app/env`, and `$app/state`.
  Historical conventions are migration inputs, never alternative target paths.
- **Use current public anatomy.** Callable roots such as `<Tabs>` and `<Dialog>`
  have verified child members; do not invent `.Root`. Tabs uses `.List`,
  `.Trigger`, and `.Content`, not old `.Control`/`.Panel` or list snippets.
  `Dialog`, `Toast`, `QrCode`, `Progress`, `RatingGroup`, and `SegmentedControl`
  are current names. `/composed`, `Modal`, and `Toaster` are obsolete destinations.
- **Props do not imply bindings.** Verified recipe roots use props/callbacks:
  Accordion `value: string[]` / `onValueChange(e.value)`, Switch
  `checked` / `onCheckedChange(e.checked)`. Native inputs support bindings.
  Verify other APIs individually; use `.Context` for an API getter when required.
- **Providers and custom elements have contracts.** Supply a hydration-stable
  `$props.id()` to `useTooltip` and similar factories; pass their API getter to
  `.Provider`, then call methods through the getter. An `element(attributes)`
  snippet replaces markup: spread all supplied attributes onto the real element.
  Do not nest a button inside a trigger that already renders one.
- **CSS is integration, not behavior.** Import Tailwind, Skeleton core, Skeleton
  Svelte CSS, and the chosen theme; activate matching `data-theme` on `<html>`.
  Presets are in core, not `/optional/presets`; framework CSS replaces the old
  Skeleton distribution scan. Retain `@source` for other shared UI when needed.
  Styled native form utilities require `@tailwindcss/forms`. CSS alone does not
  make a dialog modal or a styled disabled control semantically disabled.
- **Lucide is a Svelte SVG component library.** Prefer canonical per-icon default
  imports from `@lucide/svelte/icons/<slug>`; root named imports remain public and
  valid. No icon stylesheet, Tailwind plugin, scanner, or client-only workaround
  is required. Name the actual button/link and keep its icon decorative.
  See [Lucide verification](references/lucide.md#verification) for affected checks.
- **Motion decorates real state.** Accessible values and success messages must
  report actual work, not animated interpolation. Honor reduced motion in CSS
  and JavaScript; preserve static feedback and normal-navigation fallbacks.
  Tailwind's browser baseline does not establish support for every Skeleton CSS
  feature. Test the application's cumulative browser requirements.
- **SSR must isolate users.** Keep mutable user state, dialogs, and toast queues
  per component/layout/request, not a shared server module. Guard browser-only
  work and clean it up. Initial markup and IDs must agree across hydration.
  Never disable app-wide SSR to hide one browser-only import. Preserve native
  POST forms, server validation, and exact raw failed values; enhance only
  supported POST page actions. See [SvelteKit](references/sveltekit.md).

## Evidence hierarchy and offline fallback

Use resolved installed exports/types/source/CSS for the actual API and exact
registry metadata for peers/engines. Current official **`skeleton.dev`** v5 docs
are relevant; archived v4 docs support only the staged migration to v5. Framework
docs must match the requested version. Search, Context7, supplied Gemini research,
and supplemental research are discovery/secondary evidence, not proof against
shipped declarations.

Offline, follow [components' installed-types lookup](references/components.md#offline-installed-types-lookup)
or [Lucide's package inspection](references/lucide.md#offline-package-inspection)
through the actual dependency layout. [Sources](references/sources.md) records
primary links, research corrections, and evidence limits. If evidence is missing,
name the unknown contract rather than inventing an API or claiming verification.
