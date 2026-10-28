# Migration and version-mixed documentation

## Identify the installed generation first

Inspect the application's manifest **and resolved lockfile**. This skill targets **SvelteKit `>=3.1.0` only**, with `@skeletonlabs/skeleton@5.0.1` and `@skeletonlabs/skeleton-svelte@5.0.1`. Core exports CSS; framework components come from the Svelte package root. Historical framework and Skeleton versions below are migration sources or temporary intermediates, not supported destinations.

| Signal | Interpretation/action |
| --- | --- |
| Components/store helpers imported from core; `initializeStores`, `getModalStore`, `getToastStore`, `getDrawerStore`, `AppShell`, `variant-*`, Skeleton Tailwind plugin | Historical v2 integration: inventory every caller before removal. |
| Core `3.x` plus component `1.x` | Historical v3 pair; unequal majors were intentional. Follow the archived v3-to-v4 guide first. |
| Core/component `4.x` | Establish a functional `4.15.2` pair before v5. |
| Both packages `5.0.1`, framework CSS import, Kit `>=3.1.0` | Target generation; still inspect component contracts and all local wrappers, plus the selected Kit release's matching contracts. |

Sources: [core 5.0.1 metadata](https://registry.npmjs.org/@skeletonlabs/skeleton/5.0.1), [component 5.0.1 metadata](https://registry.npmjs.org/@skeletonlabs/skeleton-svelte/5.0.1), [current v5 migration](https://www.skeleton.dev/docs/svelte/get-started/migrate-from-v4). A store name alone is only a clue: confirm its import and usage before removing application state.

## Separate prerequisite framework migration from Skeleton migration

Use a dedicated migration branch, preserving existing user changes. An application below Kit `3.1.0` requires an explicitly scoped prerequisite framework migration before reaching this skill's supported destination. If that scope is not authorized, report the prerequisite and leave the unrelated application unchanged; do not offer its older framework as an alternative supported setup. Skeleton 5 core requires Tailwind `^4.0.0` and its Svelte package requires Svelte `^5.40.0`, but these lower peer floors do not replace Kit's stricter framework contract.

For historical **Kit 2 sources**, the [official Kit 3 migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3) recommends upgrading to the latest Kit 2 release first to expose targeted deprecations, then running `npx sv migrate sveltekit-3` (not `sv@next`). Latest Kit 2 is a **temporary migration step only, never a supported destination**. Finish at [the exact tested Kit `3.1.0` baseline](setup.md#version-contract), or a newer Kit `>=3.1.0` release after checking its matching official documentation, metadata, declarations and sources. A Kit `3.0` application also needs the prerequisite upgrade to at least `3.1.0`; it is not an in-scope destination.

Coordinate Node, Vite, the Svelte plugin, optional TypeScript and the existing deployment adapter. Automation does not replace manual review: move supported configuration into `sveltekit({...})`, remove obsolete `svelte.config.*`, merge [tsconfig](setup.md#typescript-configuration), and migrate every `$lib` import/re-export to `#lib` with explicit extensions. Use `$app/env`; `$app/environment` is deprecated, not absent, in exact Kit `3.1.0`. Replace removed `$app/stores` with read-only rune-reactive `$app/state`. Apply the remaining breaking changes relevant to the application from [Kit's migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3) and [Kit integration](sveltekit.md), preserving application behavior and unrelated configuration. The exact baseline does not certify all later Kit releases.

1. Inventory imports, providers/hosts, wrappers, stores, themes, utility classes, Tailwind/PostCSS configuration and every affected callsite, including shared packages.
2. For **v2**, follow the [archived v2-to-v4 guide](https://v4.skeleton.dev/docs/svelte/get-started/migrate-from-v2), including `skeleton-3` then `skeleton-4` transformations. For **v3**, follow the [archived v3-to-v4 guide](https://v4.skeleton.dev/docs/svelte/get-started/migrate-from-v3). Complete manual component/prop conversion and establish a working v4 app, not merely a changed manifest.
3. Finish the intermediate stage at **both Skeleton packages `4.15.2`**. Use exact intermediate pins, not archived `@latest` or release-candidate instructions:

```sh
npm install -D --save-exact @skeletonlabs/skeleton@4.15.2 @skeletonlabs/skeleton-svelte@4.15.2
```

4. From the functional intermediate app, follow the [v4-to-v5 guide](https://www.skeleton.dev/docs/svelte/get-started/migrate-from-v4). Preserve the selected Kit `>=3.1.0` framework/toolchain contract, including its Svelte peer (`^5.57.1` at the exact baseline), not merely Skeleton's lower Svelte floor; the CLI does not perform the necessary peer bump. Install the destination pair using [existing-project setup](setup.md#existing-project), integrate its CSS and finish the manual changes below.
5. Import custom themes into the [Theme Generator](https://themes.skeleton.dev/themes/import), inspect converted CSS and restore custom fonts through typography controls: theme import strips them. Preserve local font loading and assets. Register the converted theme and activate the same name on `<html>`.

For an authorized automated application migration, the pinned CLI supports these commands; run only the stages appropriate to the starting version:

```sh
npx skeleton@5.0.1 migrate skeleton-3
npx skeleton@5.0.1 migrate skeleton-4
npx skeleton@5.0.1 migrate skeleton-5
```

**CLI version is not output dependency version.** These commands mutate files and install dependencies. CLI `5.0.1`'s `skeleton-3` resolves core `>=3.0.0-0 <4.0.0` and components `>=1.0.0-0 <2.0.0`; `skeleton-4` writes `^4.0.0`; `skeleton-5` writes `^5.0.0`. Restore exact intermediate/destination pins and the chosen package manager's lockfile after each applicable stage. Review every diff. The v3-to-v4 conversion still requires manual composition/prop work; automated renames are not component conversion.

The v5 scanner selects source folders and includes `.svelte`, `.css`, `.pcss`, `.postcss`, `.jsx`, `.tsx`, `.js`, `.mjs`, `.cjs`; it **omits `.ts` and `.html`**. Manually inspect those files and all callers outside selected folders, including themes, generated class strings, shared libraries and tests. Package/token/class automation does not cover semantic Field Group markup or every removed utility. Exact CLI source: [skeleton@5.0.1](https://unpkg.com/skeleton@5.0.1/dist/index.mjs).

## Remove Tailwind 3 and v2 plugin assumptions

These are historical-source cleanup steps, not v5 installation APIs:

- Remove the old Skeleton Tailwind plugin/import from `@skeletonlabs/tw-plugin` and its dependency after all callers migrate. Remove `vite-plugin-tailwind-purgecss` integration if present.
- Rename historical `app.postcss`/`app.pcss` to `app.css` if appropriate and update every import. Replace old Tailwind directives with the [current CSS recipe](setup.md#global-css-and-dependency-scanning): Tailwind, core, Svelte framework CSS, then theme imports. Presets are included in core; remove the historical optional-presets import and manual Skeleton `dist` source scan.
- Put the Tailwind Vite plugin before framework plugins. Remove only obsolete Tailwind PostCSS processing; delete PostCSS configuration/dependencies only if unused. **Retain unrelated transforms.**
- Move necessary Tailwind configuration to CSS. If retaining non-Skeleton JavaScript configuration temporarily, load it explicitly with `@config` and review [Tailwind 4's unsupported options](https://tailwindcss.com/docs/upgrade-guide). Do not preserve the old Skeleton plugin through it.
- Map historical `variant-*` classes through the archived guides, then inspect the final v5 `preset-*` contract. Do not mechanically guess suffixes. Preserve application `@source` registrations outside automatic scanning and stylesheet-relative ordering.
- Review every `@apply`, theme override and literal/generated class string. Theme import and theme activation remain separate requirements.

## Remove legacy store wiring and migrate every caller

Historical v2 modal/toast/drawer stores and `initializeStores()` have no v5 compatibility API. Replace behavior, not just imports:

- Replace each modal/drawer trigger and global host with current `Dialog` composition or a documented native dialog/application-owned implementation; a drawer is a layout/interaction design, not a renamed v2 queue store. Preserve dismissal, focus return, labels and state ownership. See [Dialog](https://www.skeleton.dev/docs/svelte/framework-components/dialog).
- Replace historical toast stores/hosts with current `Toast`, `createToaster` and `Toast.Group` integration. Translate payloads, dismissal and queue behavior using the [current Toast contract](https://www.skeleton.dev/docs/svelte/framework-components/toast); do not retain historical `Toaster` wrappers as shims.
- Replace `AppShell` with semantic HTML and responsive Tailwind layouts. Replace historical component `Table` with a styled native table. Preserve mobile navigation, landmarks and domain behavior.
- After every caller has migrated, remove obsolete Skeleton initialization, helpers, hosts, aliases, wrappers and dependencies. Never delete unrelated `svelte/store` state or disable SSR to conceal a migration error. User/request state must remain per component/layout/request, not mutable server singletons.

## Migrate Lucide to the current Svelte package

For icons in the supported Svelte 5 / Kit 3.1+ application, cut over from
deprecated `lucide-svelte` to independently versioned **`@lucide/svelte@1.61.0`**
(peer `svelte: ^5`). Keep the existing stack pins, package manager and lockfile.
An application without icons does not need this dependency.

1. Inventory every old package import, icon wrapper/re-export, type alias,
   generated icon map and dependency declaration, including shared packages.
   Add the exact current package and migrate every caller; then remove the old
   package and obsolete aliases/wrappers. Do not keep compatibility shims.
2. Prefer canonical public per-icon default imports, for example
   `import House from '@lucide/svelte/icons/house'` and
   `import CircleAlert from '@lucide/svelte/icons/circle-alert'`.
   Root named imports such as `import { Camera } from '@lucide/svelte'` remain
   supported; changing their spelling is not required to make tree-shaking
   possible. Never replace them with an all-icon runtime namespace or internal
   `dist` imports. See [imports and package boundary](lucide.md#imports-and-package-boundary).
3. Replace deprecated names with canonical ones throughout imports and markup:
   `Home` → `House`, `AlertCircle` → `CircleAlert`, and
   `HelpCircle` / `CircleHelp` → `CircleQuestionMark`. Their deprecated aliases
   can still resolve in 1.61.0; they are not removed exports. Check the shipped
   alias declarations for other names rather than guessing replacements.
4. Replace deprecated `absoluteStrokeWidth` usage with the intended
   `nonScalingStroke` behavior and review the actual rendered stroke at relevant
   sizes. The old prop is **still present**, not removed: its numeric resize
   formula and the new per-shape SVG non-scaling vector effect are different
   mechanisms. Keep `strokeWidth` for the ordinary component prop.
5. Replace legacy component-class types (`SvelteComponentTyped`, old
   `ComponentType` icon wrappers) and general icon-map `typeof Icon` aliases
   with `import type { LucideIcon } from '@lucide/svelte'`.
   `LucideIcon` is `Component<LucideProps>` for generated icon component values.
   Generic custom `Icon` is a different contract requiring `icon` or `iconNode`;
   the issue is that contract, not whether the import uses `import type`.
   Render finite component values directly in Svelte 5, not through legacy
   `<svelte:component>`. See [finite runtime selection](lucide.md#finite-runtime-selection).
6. Brand icons were **removed in Lucide 1.x**. Replace uses such as `Github`,
   `Gitlab` or `Facebook` with the respective brand's official SVG (or a
   separately chosen brand library and its own license/contract). Do not invent
   a new Lucide brand name or substitute an unrelated symbol.
7. Remove old iconfont assets, `data-lucide` DOM scanning or initialization only
   when they belong to the migrated implementation. Imported Svelte icons render
   inline SVG during SSR and hydration; no `createIcons`, `onMount`, browser guard
   or `ssr: false` workaround is needed. Preserve unrelated browser-only work.

Recheck [control names and decorative SVG semantics](lucide.md#accessible-icons-and-controls)
when wrappers change; a tooltip is not the control's only accessible name.
For shared defaults, use [component-instance subtree context](lucide.md#subtree-defaults),
not a module singleton or a getter-shaped API copied from Skeleton providers.

Sources: [official Svelte guide](https://lucide.dev/guide/svelte/),
[v1 brand removal](https://lucide.dev/guide/svelte/migration),
[old package deprecation](https://registry.npmjs.org/lucide-svelte/1.0.1),
[current metadata](https://registry.npmjs.org/@lucide/svelte/1.61.0),
[exact aliases](https://unpkg.com/@lucide/svelte@1.61.0/dist/aliases/aliases.d.ts),
[exact types](https://unpkg.com/@lucide/svelte@1.61.0/dist/types.d.ts).

## Components are not a rename-only migration

This table identifies historical source families and final v5 destinations; the intermediate v4 stage still applies.

| Historical source | v5 destination | Required review |
| --- | --- | --- |
| `RangeSlider` | `Slider` | Array-valued value, labels, markers and `onValueChange` payload |
| `SlideToggle` | `Switch` | `checked` / `onCheckedChange`, `e.checked`, control/thumb/label/hidden input |
| `TabGroup` or old Tabs snippets | `Tabs` | `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`, optional indicator |
| `InputChip` | `TagsInput` | Values, input behavior and callbacks |
| `FileButton`, `FileDropzone` | `FileUpload` | Upload composition, files and validation |
| `ProgressBar`, `ProgressRadial`, `ProgressRing` | `Progress` | Linear/circular composition and determinate/indeterminate semantics |
| `AppRail`, historical `Navigation` | Semantic navigation | Responsive layout and active-route semantics |
| Historical ratings/radio-group/QR integrations | `RatingGroup`, `SegmentedControl`, `QrCode` where appropriate | Compare exact purpose and declarations; these are not blind renames |

Read [current components](components.md) and exact installed declarations. `Accordion` uses `value: string[]` / `onValueChange` / `e.value`. Props are input and callbacks are output; do not assume library props support `bind:` or callbacks use `.detail`. Preserve labels, keyboard behavior, SSR-safe IDs (`$props.id()`), state ownership and domain logic. Custom element snippets must spread supplied attributes; conditional transitions must respect hidden state.

## Avoid v4/v5 compound-API traps

This heading is retained for existing links; **v5 compound APIs are now the target**, not an API to avoid. Import them from `@skeletonlabs/skeleton-svelte`. Historical v3 root components, alpha `/composed` components and v4 examples are migration sources only. There is no public `/composed` entrypoint in 5.0.1.

Use callable roots such as `<Avatar>`, `<Switch>`, `<Accordion>` and `<Tabs>`, with their declared children. Root names alone do not establish compatibility: historical `Tabs.Control`/`Tabs.Panel` and old list snippets are not current `Tabs.List`/`Tabs.Trigger`/`Tabs.Content`. Inspect child exports, required props and callback payloads. Do not combine old single-component props with current compound children or invent missing exports.

### Theme token and utility cutover

Apply these historical v4 → v5 replacements everywhere, including files omitted by the CLI:

| Historical token | v5 token |
| --- | --- |
| `--base-font-family`, `--base-font-size` | `--typo-base--font-family`, `--typo-base--font-size` |
| `--base-font-color`, `--base-font-color-dark` | `--typo-base--color-light`, `--typo-base--color-dark` |
| `--base-line-height`, `--base-font-weight`, `--base-font-style`, `--base-letter-spacing` | `--typo-base--line-height`, `--typo-base--font-weight`, `--typo-base--font-style`, `--typo-base--letter-spacing` |
| `--heading-font-family` | `--typo-heading--font-family` |
| `--heading-font-color`, `--heading-font-color-dark` | `--typo-heading--color-light`, `--typo-heading--color-dark` |
| `--heading-font-weight`, `--heading-font-style`, `--heading-letter-spacing` | `--typo-heading--font-weight`, `--typo-heading--font-style`, `--typo-heading--letter-spacing` |
| `--anchor-font-family`, `--anchor-font-size` | `--typo-anchor--font-family`, `--typo-anchor--font-size` |
| `--anchor-font-color`, `--anchor-font-color-dark` | `--typo-anchor--color-light`, `--typo-anchor--color-dark` |
| `--anchor-line-height`, `--anchor-font-weight`, `--anchor-font-style`, `--anchor-letter-spacing` | `--typo-anchor--line-height`, `--typo-anchor--font-weight`, `--typo-anchor--font-style`, `--typo-anchor--letter-spacing` |
| `--anchor-text-decoration` | `--typo-anchor--text-decoration-line` |
| `--anchor-text-decoration-hover`, `--anchor-text-decoration-active`, `--anchor-text-decoration-focus` | `--typo-anchor--hover--text-decoration-line`, `--typo-anchor--active--text-decoration-line`, `--typo-anchor--focus--text-decoration-line` |
| `--body-background-color`, `--body-background-color-dark` | `--color-root-bg-light`, `--color-root-bg-dark` |

Remove `--heading-font-size` and `--heading-line-height`; use the typographic scale. Remove `--default-divide-width`; division derives from `--default-border-width`. New typography controls add stretch, kerning, text shadow, word spacing, hyphens and text transform; anchor decoration controls add color/style/thickness/underline offset/position, including hover/active/focus variants. Review converted theme defaults rather than copying removed tokens.

Review new brand tokens `--color-brand-light/dark` and `--color-brand-contrast-light/dark`, plus `preset-filled-brand`, `preset-tonal-brand`, `preset-outlined-brand`. Brand is the default accent for several controls; most themes use primary 500, while nouveau varies by mode. Review resulting light/dark contrast; tokens alone do not guarantee accessibility. Preserve visible focus outlines (`--default-outline-width`).

| Historical utility | v5 replacement |
| --- | --- |
| `card-hover` | `card` automatically applies hover styles on anchors/buttons; use semantic interactive elements |
| `@variant theme-[name]` | Removed; target `[data-theme='name']` with ordinary CSS |
| `input-group` | `field-group`, with semantic label/input markup |
| `ig-cell` | `label label-text` on a label/span appropriate to its meaning |
| `ig-input`, `ig-select`, `ig-btn` | `input`, `select`, `btn` |

Do not just rename Input Group classes: create associated visible labels and match grid tracks to actual children. Complete native field group below; it performs no submission or persistence and requires the forms plugin from setup.

`MigrationFieldGroup.svelte`

```svelte
<script lang="ts">
  const id = $props.id();
</script>

<div class="field-group grid-cols-[auto_1fr]">
  <label class="label label-text preset-tonal" for={id}>Website URL</label>
  <input class="input" id={id} name="website" type="url" placeholder="https://example.com" />
</div>
```

Review historical typography/theme-variant classes reported by the CLI; choose current semantic typography, explicit styles or the appropriate current preset instead of retaining dead classes. Use `--spacing-elem-{size}` via `size-elem-*`, `w-elem-*`, `h-elem-*`, spacing utilities, `btn-{size}` and `field-{size}` (`xs`, `sm`, `base`, `lg`, `xl`, `2xl`–`9xl`). Existing `btn-sm/base/lg` remain; new sizes do not require changing every control. Nested control SVG sizing is automatic where documented; remove conflicting manual sizes only when appropriate. See [official migration](https://www.skeleton.dev/docs/svelte/get-started/migrate-from-v4), [core API](https://www.skeleton.dev/docs/svelte/get-started/core-api), [typography](https://www.skeleton.dev/docs/svelte/design/typography) and [forms](https://www.skeleton.dev/docs/svelte/tailwind-components/forms).

Typography utility names also change independently of token names:

| Historical utility | v5 utility |
| --- | --- |
| `base-font-family`, `base-font-size` | `font-typo-base`, `text-typo-base` |
| `base-line-height`, `base-letter-spacing` | `leading-typo-base`, `tracking-typo-base` |
| `base-font-color`, `base-font-color-dark` | `text-typo-base-light`, `text-typo-base-dark` |
| `heading-font-family`, `heading-letter-spacing` | `font-typo-heading`, `tracking-typo-heading` |
| `heading-font-color`, `heading-font-color-dark` | `text-typo-heading-light`, `text-typo-heading-dark` |
| `anchor-font-family`, `anchor-font-size` | `font-typo-anchor`, `text-typo-anchor` |
| `anchor-line-height`, `anchor-letter-spacing` | `leading-typo-anchor`, `tracking-typo-anchor` |
| `anchor-font-color`, `anchor-font-color-dark` | `text-typo-anchor-light`, `text-typo-anchor-dark` |
| `body-background-color`, `body-background-color-dark` | `bg-root-bg-light`, `bg-root-bg-dark` |
| `heading-font-size`, `heading-line-height` | Choose current `text-*` / `leading-*` scale utilities |
| `base-font-weight`, `heading-font-weight`, `anchor-font-weight` | Choose `font-*` weight or consume matching typography token |
| `base-font-style`, `heading-font-style`, `anchor-font-style` | `italic` / `not-italic`, or consume matching typography token directly |
| `anchor-text-decoration` and `-hover`/`-active`/`-focus` suffixes | Explicit decoration utilities/state variants or matching anchor tokens |

The historical `code` utility class is not shipped in 5.0.1. Remove that redundant class while preserving semantic `<code>` markup: core CSS styles the native element. Add explicit application styles only where additional presentation is needed; do not remove semantic code markup to satisfy the CLI warning.

## Offline inspection fallback

When web research is unavailable or mixes versions:

1. Read resolved versions from the workspace lockfile and installed `package.json`; distinguish ranges from actual versions.
2. Resolve the app's actual dependency directory/symlink. Read the Svelte package's `exports` and `dist/index.d.ts`; follow declared relative paths to component declarations and paired sources. Internal files do not establish public entrypoints.
3. Inspect required props, child exports, snippet attributes, callback payloads and bindability before translating a caller.
4. Core CSS is **`src/index.css`**, themes are **`src/themes/*.css`**; presets are included through core's CSS. Framework CSS is **`dist/index.css`** in the Svelte package. Do not restore historical core `dist/index.css`, optional-presets or `/composed` paths.
5. If no public export matches, use documented native HTML or an application-owned implementation preserving the behavior; never fabricate a prop/component.

Exact source links: [core index](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/index.css), [Cerberus](https://unpkg.com/@skeletonlabs/skeleton@5.0.1/src/themes/cerberus.css), [framework CSS](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.css), [framework declarations](https://unpkg.com/@skeletonlabs/skeleton-svelte@5.0.1/dist/index.d.ts). Metadata query: `npm view @skeletonlabs/skeleton-svelte@5.0.1 peerDependencies exports --json`. Do not replace inspection with an unpinned install.

## Diagnose the failing layer

| Failure | Targeted next step |
| --- | --- |
| Historical `initializeStores`/`get*Store` import fails | Complete caller/host migration; no initialization workaround exists in CSS core. |
| Compound child or prop missing | Compare root 5.0.1 declarations; remove historical subpath/snippet assumptions. |
| Value/callback type error after rename | Check value shape and callback payload directly; do not assume `.detail` or bindability. |
| Theme/preset utilities disappear | Fix current CSS imports, theme activation and class names, not the old Tailwind plugin. |
| CLI leaves classes/tokens unchanged | Inspect `.ts`, `.html`, unselected/shared folders and dynamic class construction manually. |
| Kit fails before rendering | Inspect resolved Kit, configuration, modules, adapter and peers. Below Kit `3.1.0`, establish the scoped prerequisite migration; for a supported target, diagnose the actual failing layer rather than forcing peers or silently upgrading unrelated applications. |
| Styling vanishes in monorepo builds | Resolve application `@source` paths relative to the stylesheet and inspect the scan base. |

The integrating agent should run existing checks/build, then exercise real component interactions, overlays, keyboard/focus behavior, themed styling and SSR/hydration isolation. Report only exercised checks; metadata/types are not runtime certification.
