# Lucide patterns: typed consumers and advanced SVG

Progressive examples for **@lucide/svelte 1.61.0**, Svelte 5, and the [core Lucide guide](lucide.md). Use only the patterns the application needs; no global wrapper or registry is required. All files except the explicitly optional Lab example need only the existing baseline dependencies.

Native form classes use the [global CSS and forms integration](setup.md#global-css-and-dependency-scanning). Use theme-aware `input`/`select` classes rather than inheriting light text onto forms normalization's white background in dark mode.

## Reactive consumer

Keep a reusable consumer's boundary narrow: `LucideIcon` describes a component value; `Pick<LucideProps, ...>` selects its reactive presentation props. This consumer owns accessibility: visible button text supplies the name, `aria-pressed` supplies state, and the SVG is always decorative. It forwards only approved SVG/data attributes, not arbitrary rest props, `children`, `title`, `role`, or caller-provided ARIA names.

Place these two files together and mount `ReactiveIconDemo.svelte`. Native button styling deliberately avoids Skeleton's `.btn`/`.btn-icon` SVG sizing, so the selected size controls the actual rendered dimensions. Do not add conflicting size utilities/global SVG rules.

**File: `IconToggle.svelte`**
```svelte
<script lang="ts">
  import type { LucideIcon, LucideProps } from '@lucide/svelte';

  type Props = Pick<LucideProps,
    'size' | 'color' | 'strokeWidth' | 'nonScalingStroke' | 'stroke-linecap'
  > & {
    icon: LucideIcon;
    label: string;
    pressed: boolean;
    disabled: boolean;
    onclick: () => void;
    'data-icon-key'?: string;
  };

  let {
    icon: Icon, label, pressed, disabled, onclick,
    size = 24, color = 'currentColor', strokeWidth = 2,
    nonScalingStroke = false,
    'stroke-linecap': strokeLinecap = 'round',
    'data-icon-key': iconKey
  }: Props = $props();
</script>

<button
  type="button"
  class="inline-flex items-center gap-2 rounded border p-3 focus-visible:outline-2 disabled:opacity-50"
  aria-pressed={pressed}
  {disabled}
  {onclick}
>
  <Icon
    {size} {color} {strokeWidth} {nonScalingStroke}
    stroke-linecap={strokeLinecap}
    data-icon-key={iconKey}
    aria-hidden="true"
    focusable="false"
  />
  {label}
</button>
```

**File: `ReactiveIconDemo.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { LucideIcon } from '@lucide/svelte';
  import Heart from '@lucide/svelte/icons/heart';
  import Star from '@lucide/svelte/icons/star';
  import IconToggle from './IconToggle.svelte';

  const icons = { heart: Heart, star: Star } satisfies Record<string, LucideIcon>;
  type IconKey = keyof typeof icons;
  function isIconKey(key: string): key is IconKey {
    return Object.hasOwn(icons, key);
  }

  // A raw string models external data; never index the map before validating it.
  let rawKey = $state('heart');
  let size = $state(32);
  let strokeWidth = $state(2);
  let nonScalingStroke = $state(false);
  let favorite = $state(false);
  let ready = $state(false);
  const SelectedIcon = $derived(isIconKey(rawKey) ? icons[rawKey] : undefined);
  onMount(() => { ready = true; });
</script>

<section class="space-y-4">
  <h2 class="h2">Local favorite preview</h2>
  <label class="block">
    Icon key (heart or star; try an unknown key)
    <input class="input w-full max-w-sm" type="text" bind:value={rawKey} disabled={!ready} />
  </label>
  <label class="block">
    Icon size: {size}px
    <input class="block" type="range" min="16" max="64" step="8" bind:value={size} disabled={!ready} />
  </label>
  <label class="block">
    Stroke width: {strokeWidth}
    <input class="block" type="range" min="1" max="4" step="0.5" bind:value={strokeWidth} disabled={!ready} />
  </label>
  <label class="flex items-center gap-2">
    <input type="checkbox" bind:checked={nonScalingStroke} disabled={!ready} />
    Keep stroke width constant as the icon scales
  </label>

  {#if SelectedIcon}
    <IconToggle
      icon={SelectedIcon}
      label="Favorite"
      pressed={favorite}
      disabled={!ready}
      onclick={() => favorite = !favorite}
      {size} {strokeWidth} {nonScalingStroke}
      color="currentColor"
      stroke-linecap="square"
      data-icon-key={rawKey}
    />
  {:else}
    <p role="status">Unknown icon key “{rawKey}”; the control remains text-only.</p>
    <button
      type="button"
      class="rounded border p-3 focus-visible:outline-2 disabled:opacity-50"
      aria-pressed={favorite}
      disabled={!ready}
      onclick={() => favorite = !favorite}
    >Favorite</button>
  {/if}
  <p role="status">Favorite: {favorite ? 'on' : 'off'}. Local preview only; not saved.</p>
</section>
```

The component prop and every selected presentation prop remain reactive through `$props()`; this is not a mutable-context recipe. Keep raw external keys serializable in load data, then validate and resolve component values in the Svelte caller. Never return component functions from a serialized load response. This finite map is local to the example, not a mandatory application registry.

Expected assertions: before mount, every local control is disabled and SSR contains the initial heart SVG. After mount, heart → star replaces the SVG; changing size changes computed width/height; changing stroke changes the rendered stroke; the checkbox adds/removes shape `vector-effect="non-scaling-stroke"`. The SVG carries `stroke-linecap="square"` and the current `data-icon-key`, remains hidden from assistive technology, and never names the button. Favorite toggles `aria-pressed` and visible status; an unknown key keeps a named, working text-only control.

## Fill and composition

Lucide is an outline set, not a solid-icon set. SVG `fill` works on suitable geometry (such as a closed star), but filling arbitrary outlines can obscure details or close open paths unexpectedly. Inspect the particular icon; do not globally fill `.lucide`. In the comparison below, `strokeWidth={0}` intentionally removes the filled star's outline.

Child snippets can add native SVG elements or nested icon SVGs. Here the composed image has exactly one accessible name: the outer SVG references an instance-safe nested `<title>`; the inner SVG stays decorative. Coordinates are in the outer 24×24 viewBox, not the displayed pixel size.

**File: `IconArtwork.svelte`**
```svelte
<script lang="ts">
  import Star from '@lucide/svelte/icons/star';
  import Scan from '@lucide/svelte/icons/scan';
  import User from '@lucide/svelte/icons/user';

  const id = $props.id();
</script>

<div class="space-y-4">
  <figure>
    <div class="flex gap-3">
      <Star size={40} fill="none" aria-hidden="true" focusable="false" />
      <Star size={40} fill="currentColor" strokeWidth={0} aria-hidden="true" focusable="false" />
    </div>
    <figcaption>Outline star and filled star: the same shape, different paint.</figcaption>
  </figure>
  <Scan size={48} nonScalingStroke role="img" aria-labelledby={`${id}-scan-title`} focusable="false">
    <title id={`${id}-scan-title`}>Scanned user</title>
    <User size={12} x={6} y={6} nonScalingStroke aria-hidden="true" focusable="false" />
  </Scan>
</div>
```

Expected assertions: only the composed image is exposed as “Scanned user”; duplicate component instances have distinct title IDs and correct references. The inner user is positioned within the scan frame. Review filled geometry and contrast in both themes; an attractive star does not establish fill support for other icons.

## Directional icons

Choose direction from the application's real locale/direction boundary. Mirror only icons whose meaning follows reading/navigation direction. A “next section” arrow can mirror in RTL; a checkmark, logo, clock, or physical-direction symbol must not inherit a blanket mirror rule. Brand SVGs are not part of Lucide v1. An explicit left/right icon choice is also valid when it better matches the application's semantics.

**File: `DirectionalIcons.svelte`**
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';

  const id = $props.id();
  let direction = $state<'ltr' | 'rtl'>('ltr');
  let ready = $state(false);
  onMount(() => { ready = true; });
</script>

<label class="block">
  Preview reading direction
  <select class="select w-fit max-w-full" bind:value={direction} disabled={!ready}>
    <option value="ltr">Left to right</option>
    <option value="rtl">Right to left</option>
  </select>
</label>
<section dir={direction} class="space-y-4">
  <a class="inline-flex items-center gap-2 underline" href={`#${id}-next`}>
    <ArrowRight class={direction === 'rtl' ? '-scale-x-100' : ''} aria-hidden="true" focusable="false" />
    Next section
  </a>
  <p class="flex items-center gap-2">
    <Check aria-hidden="true" focusable="false" />
    Confirmed: this checkmark is never mirrored.
  </p>
  <section id={`${id}-next`}>
    <h2 class="h2">Next section</h2>
    <p>This is the local navigation target.</p>
  </section>
</section>
```

Expected assertions: the select is disabled until mount; RTL flips only the arrow, not the checkmark; keyboard activation reaches the real, instance-safe section target. The link works before hydration.

## Custom icon data and Lab

Use ordinary icon components at a `LucideIcon` consumer boundary. The generic `Icon` has a different contract: exactly one of `icon: LucideIconData` or `iconNode: LucideIconNode[]`. These complete examples demonstrate the two branches without casting or the deprecated `IconNode` alias. Keep geometry static and trusted; this is not an arbitrary SVG/HTML ingestion mechanism.

**File: `CustomIconData.svelte`**
```svelte
<script lang="ts">
  import { Icon, type LucideIconData } from '@lucide/svelte';

  const addition = {
    name: 'local-addition',
    size: 24,
    node: [
      ['circle', { cx: 12, cy: 12, r: 9 }],
      ['path', { d: 'M8 12h8M12 8v8' }]
    ]
  } satisfies LucideIconData;
</script>

<Icon icon={addition} size={32} role="img" aria-label="Addition symbol in a circle" focusable="false" />
```

### Optional dependency: @lucide/lab 0.7.0

Only the next file requires this extra package; none of the preceding examples imports it:

```sh
npm install --save-exact @lucide/lab@0.7.0
```

Exact 0.7.0 metadata declares an ESM entry and declarations; its ESM entry exports `pear`, whose implementation is a path-node array, not a Svelte component or a `LucideIconData` object. Its declared tuple names and string attributes fit 1.61.0's `LucideIconNode[]` shape. The typed assignment below makes that compatibility explicit; use the generic `iconNode` branch, not `icon={pear}` or `<pear />`. Lab is optional experimental artwork, not a promise that its symbols will enter the core catalog.

**File: `OptionalLabIcon.svelte`**
```svelte
<script lang="ts">
  import { Icon, type LucideIconNode } from '@lucide/svelte';
  import { pear } from '@lucide/lab';

  const pearNode: LucideIconNode[] = pear;
</script>

<Icon iconNode={pearNode} size={40} role="img" aria-label="Pear" focusable="false" />
```

Expected assertions: the custom-data image is named “Addition symbol in a circle”; with the optional package installed, the Lab image is named “Pear” and renders the two paths from the pinned export. Import/type-check both branches against the resolved packages; a metadata/source inspection is not a claim that an application build or browser check has passed.

## Primary references

- Current official guidance: [filled icons](https://lucide.dev/guide/svelte/advanced/filled-icons), [combining icons](https://lucide.dev/guide/svelte/advanced/combining-icons), and [Lucide Lab](https://lucide.dev/guide/svelte/advanced/with-lucide-lab).
- Exact **@lucide/svelte 1.61.0**: [public types](https://unpkg.com/@lucide/svelte@1.61.0/dist/types.d.ts), [data types](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/types.d.ts), [Icon implementation](https://unpkg.com/@lucide/svelte@1.61.0/dist/Icon.svelte), and [SVG construction](https://unpkg.com/@lucide/svelte@1.61.0/dist/utils/buildLucideIconNode.js).
- Exact **@lucide/lab 0.7.0**: [metadata](https://registry.npmjs.org/@lucide/lab/0.7.0), [named ESM exports](https://unpkg.com/@lucide/lab@0.7.0/dist/esm/lucide-lab.js), [declarations](https://unpkg.com/@lucide/lab@0.7.0/dist/lucide-lab.d.ts), and [pear data](https://unpkg.com/@lucide/lab@0.7.0/dist/esm/icons/pear.js).
