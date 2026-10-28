# Lucide for Svelte

Use Lucide when icons improve recognition or communication; do not add decorative clutter. This guide targets SvelteKit **3.1+**, Svelte **5**, Skeleton **5**, and Tailwind **4** only. The exact icon package observed is **@lucide/svelte 1.61.0**, with peer dependency **Svelte ^5**; existing framework pins remain unchanged. Recipes without icons need no icon dependency.

## Imports and package boundary

```sh
npm install --save-exact @lucide/svelte@1.61.0
```

Prefer canonical public per-icon default imports, such as `import Camera from '@lucide/svelte/icons/camera'`. Public root named imports, such as `import { Camera } from '@lucide/svelte'`, are also valid and can be tree-shaken. Per-icon imports keep the traversed module graph focused; they do not establish a measured bundle-size or build-speed advantage. Never import internal `dist` files. Root type-only imports are appropriate.

Static icon imports render inline SVG during SSR. No CSS import, Tailwind plugin, `@source`, icon font, DOM scanner, `createIcons`, `onMount`, or `ssr: false` workaround is needed for the icons. Client-only local controls below wait for mount; the SVG does not.

Use the scoped package, not deprecated `lucide-svelte`. Prefer canonical names, not deprecated aliases (some aliases still resolve). Brand icons were removed in v1; obtain an appropriate authorized brand SVG separately rather than inventing a Lucide replacement.

## Discover and verify an icon

1. Search the [official icon catalog](https://lucide.dev/icons/) by meaning, synonym, or category; open a candidate to confirm its actual shape and canonical label. The live catalog can be newer than the installed package.
2. Check the application's **installed** `@lucide/svelte` version and public declarations, not just a current website snippet. Follow `dist/lucide-svelte.d.ts` to `dist/icons/index.d.ts`; confirm the exact named export and its file mapping. Check aliases separately for renamed/deprecated names.
3. Follow that confirmed mapping to the public `./icons/*` export in `package.json`. For example, 1.61.0 declares `ArrowDown01` from `./arrow-down-0-1.svelte`; the public default-import path is `@lucide/svelte/icons/arrow-down-0-1`. The root alternative is `import { ArrowDown01 } from '@lucide/svelte'`.

The workflow is **catalog label → confirmed export/file mapping → public import slug**, not a guessed PascalCase-to-kebab-case conversion. Digits, acronyms, and historical aliases make mechanical conversion unreliable: `ArrowDownAZ` maps to `arrow-down-a-z`, while deprecated `ArrowDownAz` has a different alias entry. Do not build import paths from external strings.

## Offline package inspection

Run this from the consuming application's directory after dependencies are installed. It reads files without evaluating Svelte components or requiring network access:

```sh
node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const entry = realpathSync(require.resolve('@lucide/svelte'));
const root = dirname(dirname(entry));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
console.log('Package directory:', root);
console.log(JSON.stringify({
  version: pkg.version, peerDependencies: pkg.peerDependencies, exports: pkg.exports
}, null, 2));
NODE
```

Use the printed physical directory, not an assumed package-manager store path. The inspected npm installation has an ordinary `node_modules/@lucide/svelte` directory and regular per-icon files; other layouts may symlink the package directory (for example, into pnpm's `.pnpm` store). `realpathSync` follows the actual installation. In 1.61.0 the resolved root entry is `dist/lucide-svelte.js`, so two parent directories locate the package root.

Inspect these files in that directory with an editor or text search:

| File | What to establish |
| --- | --- |
| `package.json` | Actual version, Svelte peer range, and allowed public entry points. In 1.61.0, `./icons/*` maps to `dist/icons/*.js` and `dist/icons/*.svelte.d.ts`. |
| `dist/lucide-svelte.d.ts` → `dist/icons/index.d.ts` | Exact canonical root exports and their file mappings; search meaning-related names, not only a guessed identifier. |
| `dist/aliases/index.d.ts` → `aliases.d.ts`, `prefixed.d.ts`, `suffixed.d.ts` | Historical, prefixed, and suffixed names. Read deprecation comments and follow the canonical replacement rather than adding a new alias-based import. |
| `dist/icons/<confirmed-slug>.js`, `.svelte.d.ts`, `.svelte` | Public default re-export, component props/type, and actual geometry. For example, `camera.js` re-exports the default from `camera.svelte`; the declaration confirms `Camera` accepts `LucideProps`. |
| `dist/types.d.ts`, `dist/Icon.svelte`, `dist/context.js` | Exact-version prop, accessibility, and default/context behavior when documentation and observed rendering differ. |

If a candidate is absent, search canonical declarations and aliases before concluding it is unavailable. It may be renamed, added after the installed version, or removed; a catalog match does not prove this version exports it. Brand removals in v1 are not fixed by guessing another slug. Choose an available semantic icon, deliberately update the dependency, or obtain an authorized external brand asset as appropriate.

These `dist` paths are **inspection sources**, not application import paths. Continue importing through `@lucide/svelte`, `@lucide/svelte/context`, or the confirmed public `@lucide/svelte/icons/<slug>` entry. Neither filesystem presence nor internal `__iconData` declarations alone establish a public named export.

## Props and styling

| Input | Current behavior |
| --- | --- |
| `size` | Number or string; defaults to `24`; supplies width and height unless explicitly supplied. |
| `color` | Stroke color; defaults to `currentColor`, inheriting the surrounding theme foreground. |
| `strokeWidth` | Number or string; defaults to `2`. Prefer this spelling for component/context defaults. |
| `nonScalingStroke` | Defaults to `false`; applies `vector-effect="non-scaling-stroke"` to shapes, including when CSS sizes the SVG. |
| `class` | Ordinary class prop, combined with generated Lucide classes and context class. There is no `default-class` configuration prop or Tailwind conflict merger. |
| SVG attributes | Forwarded to the SVG; explicit raw attributes such as `stroke-width` are spread after generated attributes. |

Explicit component props override subtree defaults. CSS can override SVG presentation attributes: `class="size-5"` can determine dimensions despite `size={32}`; a global `.lucide` stroke/color rule can defeat explicit/context styling. Choose deliberate local utilities or context ownership, not blanket overrides. Conflicting utility classes do not have guaranteed last-token precedence.

Keep the SVG a **direct child** of Skeleton `.btn`/`.btn-icon` for its zero-specificity direct-child sizing rules. A wrapper changes that relationship. Tailwind size utilities can override those defaults. Check actual computed size, stroke, foreground contrast, and focus indicators in light and dark themes. `absoluteStrokeWidth` remains present but deprecated: use `nonScalingStroke` for non-scaling strokes, not as a claim that both mechanisms produce identical results.

## Accessible icons and controls

- Name the button or link itself with visible text or `aria-label`; its icon stays decorative with `aria-hidden="true"`. Tooltips supplement names, not replace them.
- A standalone meaningful SVG needs `role="img"` and an accessible name (`aria-label`, or an instance-safe `aria-labelledby` referencing a nested `<title>`).
- Automatic hiding is conditional: **any** `aria-*`, `role`, `title` attribute, or child snippet suppresses the default `aria-hidden="true"`. Do not assume that adding `aria-describedby`, an unrelated child, or a `title` leaves an icon decorative. Set hiding explicitly when decorative. A `title` string attribute is not a nested SVG `<title>`.
- `focusable="false"` keeps the SVG itself out of legacy SVG focus behavior; the surrounding control remains keyboard accessible.

**File: `IconControls.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let count = $state(0);
  let ready = $state(false);
  onMount(() => { ready = true; });
</script>

<section class="space-y-4">
  <h2 class="h2">Local counter</h2>
  <div class="flex gap-3">
    <button type="button" class="btn preset-filled" disabled={!ready} onclick={() => count += 1}>
      <Plus aria-hidden="true" focusable="false" />
      Add one
    </button>
    <button type="button" class="btn-icon preset-tonal-primary" aria-label="Reset counter" disabled={!ready} onclick={() => count = 0}>
      <RotateCcw aria-hidden="true" focusable="false" />
    </button>
  </div>
  <p role="status">Count: {count}</p>
  <p class="flex items-center gap-2">
    <CircleAlert role="img" aria-label="Warning" class="size-5 shrink-0" focusable="false" />
    This counter is local and resets when this component is recreated.
  </p>
</section>
```

### Skeleton element-snippet trigger

Spread all trigger attributes onto the replacement button; do not nest buttons. The icon remains its direct SVG child. This is the only icon-trigger implementation location; the [dependency-free recipes](recipes.md#floating-help-tooltip) remain available.

**File: `IconTooltip.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Portal, Tooltip } from '@skeletonlabs/skeleton-svelte';
  import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';

  let ready = $state(false);
  onMount(() => { ready = true; });
</script>

<p>Use Tab to move between controls.</p>
<Tooltip positioning={{ placement: 'top' }} openDelay={200}>
  <Tooltip.Trigger>
    {#snippet element(attributes)}
      <button {...attributes} type="button" class="btn-icon preset-tonal-primary" aria-label="Keyboard navigation help" disabled={!ready}>
        <CircleQuestionMark aria-hidden="true" focusable="false" />
      </button>
    {/snippet}
  </Tooltip.Trigger>
  <Portal>
    <Tooltip.Positioner class="z-50">
      <Tooltip.Content class="card max-w-[var(--available-width)] preset-filled-surface-100-900 p-3 shadow-xl">
        Shift+Tab moves to the previous control.
      </Tooltip.Content>
    </Tooltip.Positioner>
  </Portal>
</Tooltip>
```

After mount, focus/hover opens help and Escape dismisses it. The name is present even when the tooltip is closed. Essential instructions stay visible.

## Finite runtime selection

Use a finite typed whitelist of statically imported **component values**. Svelte 5 renders `<SelectedIcon />` directly; do not use legacy `svelte:component`, `SvelteComponentTyped`, a namespace/all-icon registry, or arbitrary user-derived `import()` paths. All runtime-reachable whitelist entries can remain in the bundle; tree-shaking cannot remove an entry merely because it is not selected initially.

**File: `RuntimeIconLinks.svelte`**
```svelte
<script lang="ts">
  import type { LucideIcon } from '@lucide/svelte';
  import House from '@lucide/svelte/icons/house';
  import Settings from '@lucide/svelte/icons/settings';

  const id = $props.id();
  const icons = { home: House, settings: Settings } satisfies Record<string, LucideIcon>;
  type IconKey = keyof typeof icons;
  function isIconKey(key: string): key is IconKey {
    return Object.hasOwn(icons, key);
  }
  const items: { icon: string; label: string; target: string }[] = [
    { icon: 'home', label: 'Overview', target: 'overview' },
    { icon: 'settings', label: 'Preferences', target: 'preferences' },
    { icon: 'unrecognized', label: 'Additional information', target: 'information' }
  ];
</script>

<nav aria-label="On this page" class="flex flex-wrap gap-3">
  {#each items as item}
    <a class="btn preset-tonal-primary" href={`#${id}-${item.target}`}>
      {#if isIconKey(item.icon)}
        {@const SelectedIcon = icons[item.icon]}
        <SelectedIcon aria-hidden="true" focusable="false" />
      {/if}
      {item.label}
    </a>
  {/each}
</nav>
<section id={`${id}-overview`}><h2 class="h2">Overview</h2><p>Local overview content.</p></section>
<section id={`${id}-preferences`}><h2 class="h2">Preferences</h2><p>No preferences are saved here.</p></section>
<section id={`${id}-information`}><h2 class="h2">Additional information</h2><p>Unknown icon keys retain a usable text link.</p></section>
```

The string keys model external data without pretending to fetch it. Validate external destinations separately; this example owns every fragment target. Duplicate instances have separate IDs. No JavaScript action is required for these links.

For a reusable, explicitly reactive **typed consumer boundary**, see [reactive consumer](lucide-patterns.md#reactive-consumer). It is optional local composition, not a required global icon wrapper or registry. Keep component values in `.svelte`/client modules; serialized SvelteKit load data carries validated string keys and other serializable values, not component functions.

## Subtree defaults

`setLucideProps` from the public `@lucide/svelte/context` entry sets context during **component instance initialization**. Pass an object, not a getter/factory. Do not call it in a module script, load function, mutable global singleton, event callback, or `onMount`. Descendants capture that context reference. This example promises initial static defaults only, not reactive context updates; pass explicit reactive props when runtime changes are needed.

Place these two complete files together; mount the parent.

**File: `IconDefaults.svelte`**
```svelte
<script lang="ts">
  import { setLucideProps } from '@lucide/svelte/context';
  import IconDefaultsChild from './IconDefaultsChild.svelte';

  setLucideProps({ size: 32, color: 'currentColor', strokeWidth: 1, class: 'shrink-0' });
</script>

<div class="space-y-3">
  <IconDefaultsChild />
</div>
```

**File: `IconDefaultsChild.svelte`**
```svelte
<script lang="ts">
  import Camera from '@lucide/svelte/icons/camera';
</script>

<p class="flex items-center gap-2">
  <Camera aria-hidden="true" focusable="false" />
  Inherited: size 32 and stroke width 1.
</p>
<p class="flex items-center gap-2">
  <Camera size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
  Explicit override: size 20 and stroke width 2; context class still applies.
</p>
```

These SVGs are outside Skeleton buttons so button auto-sizing does not mask the size comparison. For runtime size/stroke changes, use [explicit reactive consumer props](lucide-patterns.md#reactive-consumer), not an assumed reactive context provider.

## Custom icons and Lab boundary

The generic public `Icon` accepts **exactly one** of `icon: LucideIconData` or `iconNode: LucideIconNode[]`. Use `LucideIcon` for ordinary icon-component maps; the generic custom `Icon` has additional required data props. Avoid deprecated `IconNode` aliases. Keep custom geometry static and trusted, not arbitrary SVG/HTML from external input.

**File: `CustomIcon.svelte`**
```svelte
<script lang="ts">
  import { Icon, type LucideIconNode } from '@lucide/svelte';

  const iconNode: LucideIconNode[] = [
    ['path', { d: 'M4 12h16M12 4v16' }],
    ['circle', { cx: 12, cy: 12, r: 9 }]
  ];
</script>

<Icon {iconNode} role="img" aria-label="Addition symbol in a circle" size={32} />
```

For [fill and composition](lucide-patterns.md#fill-and-composition), [directional/RTL decisions](lucide-patterns.md#directional-icons), and [custom data plus verified optional `@lucide/lab@0.7.0`](lucide-patterns.md#custom-icon-data-and-lab), continue to the advanced patterns reference. Lab remains a separate optional dependency, not part of this baseline; the advanced example records its exact export/data compatibility rather than assuming any Lab symbol works.

## Troubleshooting

| Symptom | Diagnose and correct |
| --- | --- |
| “No default export” at the root, or “no exported member” at a per-icon path | Root components use named imports (`{ Camera }`); `@lucide/svelte/icons/camera` uses a default import (`Camera`). Confirm the exact public mapping; do not import an internal `.svelte`/`dist` path to bypass it. |
| A catalog icon or old name cannot resolve | Check the actual installed version, canonical declaration, alias replacement, and public per-icon file using the [discovery workflow](#discover-and-verify-an-icon). The live catalog, a different workspace package, or a removed brand may explain the mismatch. |
| `size` seems ignored, or a button icon changes size | Inspect computed `width`/`height`: Tailwind `size-*` and Skeleton direct-child button CSS can override SVG attributes. Keep the SVG a direct child where intended; remove conflicting utilities instead of assuming prop or class-token order wins. |
| Stroke or color differs from props/context | Inspect computed `stroke`, `stroke-width`, inherited `color`, raw SVG attributes, and global `.lucide` rules. CSS overrides presentation attributes; raw `stroke-width` overrides generated attributes. `currentColor` needs a suitable foreground. Use `nonScalingStroke` for CSS-resized non-scaling strokes; `absoluteStrokeWidth` is deprecated, not removed. |
| An icon is unexpectedly exposed, unnamed, or announced twice | Any `aria-*`, `role`, `title`, or child snippet suppresses automatic hiding. Explicitly hide decorative SVGs and name the control; give meaningful SVGs `role="img"` plus a name. Check the accessibility tree, not only visual tooltips. |
| Defaults are missing or do not update | Call `setLucideProps` from `@lucide/svelte/context` during an ancestor instance's initialization, with an object. Confirm subtree scope and explicit prop overrides. These examples promise static defaults; use [reactive props](lucide-patterns.md#reactive-consumer) for runtime changes. |
| Development traverses many modules, or a bundle is unexpectedly large | Check for namespace imports, an all-icon registry, or an oversized runtime map; use finite static imports. Root named imports are tree-shakeable, so distinguish traversed module graph from retained production output and inspect the actual bundle before claiming savings. |
| Props/types disagree with an example, or resolution differs by workspace | Read the resolved package metadata and lockfile in the consuming app; confirm the intended 1.61.0 package, Svelte 5 peer, and public export conditions. Match source/docs to that version before changing code; do not switch to deprecated `lucide-svelte` or add SSR workarounds. |

## Verification

For copied examples, use the exact baseline and the application's existing global Skeleton/Tailwind/theme setup:

1. Run the project's type/Svelte check and production build; include both context files. Check public import resolution and all component props.
2. Inspect SSR HTML: inline SVG is present; local JS-only buttons start disabled; links target real, instance-safe fragments. Mount duplicate instances and check associations and hydration warnings.
3. Click Add one and Reset counter; confirm the local count changes without persistence claims. Test the tooltip by keyboard and pointer, including Escape and focus visibility.
4. Inspect the accessibility tree: named controls, hidden decorative SVGs, and the meaningful warning/custom symbol exposed as named images. Unknown runtime keys retain text links.
5. Inspect computed dimensions, stroke widths, `currentColor`, and contrast in light/dark themes. Open the tooltip at 320px and verify its available-width constraint prevents page overflow. Context icons should show 32/1 versus 20/2 outside button sizing rules.
6. Inspect actual production bundle/module analysis before asserting size or speed savings. Compare equivalent imports in the same build; do not infer that root named imports ship every icon.
7. For [advanced patterns](lucide-patterns.md), exercise reactive props, unknown-key fallback, composed-image associations, selective RTL, and the chosen custom/Lab geometry. Inspect native input/select text in both schemes; a select's CSS caret image can require manual contrast review.

These are verification requirements, not a claim that every downstream project has passed them. See [sources and verification](sources.md) for recorded evidence.

Primary references: [official icon catalog](https://lucide.dev/icons/), [official Svelte guide](https://lucide.dev/guide/svelte/), [1.61.0 package metadata](https://registry.npmjs.org/@lucide/svelte/1.61.0), [public root declarations](https://unpkg.com/@lucide/svelte@1.61.0/dist/lucide-svelte.d.ts), [canonical export mappings](https://unpkg.com/@lucide/svelte@1.61.0/dist/icons/index.d.ts), [rename aliases](https://unpkg.com/@lucide/svelte@1.61.0/dist/aliases/aliases.d.ts), [per-icon public entry](https://unpkg.com/@lucide/svelte@1.61.0/dist/icons/camera.js), [per-icon declaration](https://unpkg.com/@lucide/svelte@1.61.0/dist/icons/camera.svelte.d.ts), [exact Icon implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), [public types](https://unpkg.com/@lucide/svelte@1.61.0/dist/types.d.ts), [context implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/context.js), [SVG construction](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/buildLucideIconNode.js), [automatic hiding detection](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/hasA11yProp.js), and [Skeleton button sizing](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/utilities/buttons.css).
