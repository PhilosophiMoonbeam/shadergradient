# Setup: Skeleton + SvelteKit 3.1+ + Tailwind CSS + Lucide

- [Version contract](#version-contract)
- [Greenfield project](#greenfield-project)
- [Existing project](#existing-project)
- [Lucide when icons are useful](#lucide-when-icons-are-useful)
- [TypeScript configuration](#typescript-configuration)
- [Vite integration](#vite-integration)
- [Kit 3 package imports and environment](#kit-3-package-imports-and-environment)
- [Global CSS and dependency scanning](#global-css-and-dependency-scanning)
- [Root layout and active theme](#root-layout-and-active-theme)
- [Targeted diagnosis](#targeted-diagnosis)

## Version contract

This skill supports **SvelteKit `>=3.1.0` only**. The framework/toolchain pins below form the tested, reproducible Kit `3.1.0` baseline for greenfield projects and prerequisite framework migrations; the optional Lucide pin was observed independently. For a newer existing Kit release, check its matching official documentation, package metadata, public declarations and sources before retaining its toolchain; the baseline does not certify every later release. Both Skeleton packages are pinned to `5.0.1`; their equal versions do not justify inferring versions for other generations.

| Package | Pin | Evidence |
| --- | --- | --- |
| `@skeletonlabs/skeleton` | `5.0.1` | [Registry](https://registry.npmjs.org/@skeletonlabs/skeleton/5.0.1): Tailwind peer `^4.0.0`, CSS exports |
| `@skeletonlabs/skeleton-svelte` | `5.0.1` | [Registry](https://registry.npmjs.org/@skeletonlabs/skeleton-svelte/5.0.1): Svelte peer `^5.40.0` |
| `@lucide/svelte` (optional icons) | `1.61.0` | [Registry](https://registry.npmjs.org/@lucide/svelte/1.61.0): independently observed package, Svelte peer `^5`; [official guide](https://lucide.dev/guide/svelte/) |
| `svelte` | `5.57.2` | [Registry](https://registry.npmjs.org/svelte/5.57.2) |
| `@sveltejs/kit` | `3.1.0` | [Registry](https://registry.npmjs.org/@sveltejs/kit/3.1.0): Svelte `^5.57.1`, Vite `^8.0.12`, Svelte Vite plugin `^7.0.0` |
| `vite` | `8.3.4` | [Registry](https://registry.npmjs.org/vite/8.3.4) |
| `@sveltejs/vite-plugin-svelte` | `7.3.1` | [Registry](https://registry.npmjs.org/@sveltejs/vite-plugin-svelte/7.3.1): Vite 8, Svelte `^5.46.4` |
| `typescript` | `6.0.3` | [Registry](https://registry.npmjs.org/typescript/6.0.3): satisfies Kit's optional `^6.0.0` peer |
| `svelte-check` | `4.7.7` | [Registry](https://registry.npmjs.org/svelte-check/4.7.7): supports TypeScript 5 or 6 |
| `tailwindcss`, `@tailwindcss/vite` | `4.3.3` each | [Plugin registry](https://registry.npmjs.org/@tailwindcss/vite/4.3.3) |
| `@tailwindcss/forms` | `0.5.11` | [Registry](https://registry.npmjs.org/@tailwindcss/forms/0.5.11): needed for Skeleton native form utilities |
| `@sveltejs/adapter-auto` | `8.0.0` | [Registry](https://registry.npmjs.org/@sveltejs/adapter-auto/8.0.0): compatible with stable Kit 3 |

Use **Node 22.17+ within 22.x, or Node 24+**; maintained Node 24 LTS is recommended. Kit requires `>=22.17`; the Svelte Vite plugin requires `^20.19 || ^22.12 || >=24`. Node 20 and 23 fail the combined contract. JavaScript-only projects can omit TypeScript and its checker. Do not substitute TypeScript 7 for Kit's optional TypeScript 6 peer.

The [current Skeleton installation guide](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit) describes Skeleton's upstream requirements, not this skill's framework support boundary. Kit `>=3.1.0` is required here; Kit `3.1.0`, Vite 8 and TypeScript 6 form the exact reproducible baseline. Direct pins require a committed lockfile to freeze transitive resolution. Published peer compatibility does not establish runtime behavior.

Lucide is the preferred icon family when icons improve the interface; it is not
a required dependency for every app or existing recipe. Its `1.61.0` pin is
independent of the Skeleton versions and was observed separately from the
historical framework baseline checks. Use the current scoped package
`@lucide/svelte`.

## Greenfield project

Use the [official Svelte CLI](https://svelte.dev/docs/kit/creating-a-project) to generate a project:

```sh
npx sv create my-skeleton-app
cd my-skeleton-app
```

Choose TypeScript if desired. Select the intended package manager in the prompts. Configure Tailwind manually as shown below if needed; do not assume the current generator selects this reference's dependency versions. Inspect the generated manifest before proceeding.

Honor `packageManager`, the existing lockfile, and workspace conventions. The examples below use npm; translate their version-qualified arguments to the repository's package manager's exact-version syntax, preserving each command's dependency scope. Do not create a second lockfile. Run installation in the application workspace, not an unrelated monorepo root.

For a TypeScript project, replace generated versions with these exact dependencies:

```sh
npm install -D --save-exact @skeletonlabs/skeleton@5.0.1 @skeletonlabs/skeleton-svelte@5.0.1 svelte@5.57.2 @sveltejs/kit@3.1.0 vite@8.3.4 @sveltejs/vite-plugin-svelte@7.3.1 typescript@6.0.3 svelte-check@4.7.7 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 @tailwindcss/forms@0.5.11 @sveltejs/adapter-auto@8.0.0
```

For JavaScript-only projects without TypeScript tooling, omit `typescript@6.0.3` and `svelte-check@4.7.7`. Omit forms only when not using Skeleton native form utilities. Keep other scaffold tools only if their peers support this toolchain.

Adapter auto 8's Kit `^3.0.0-next.0` peer includes stable `3.1.0`. For an existing application, retain the deployment target and select a compatible release of its adapter instead of replacing it with auto. Preserve ESM `"type": "module"` and scripts; merge the TypeScript changes below. If the generator created `svelte.config.*`, migrate supported options into the Vite plugin and remove the obsolete file. Adapter auto is not a substitute for selecting a production deployment target.

## Existing project

First inspect `package.json`, the resolved lockfile, Node version, `vite.config.*`, `svelte.config.*`, root layout, `src/app.html`, and the imported global stylesheet. **Inspection does not authorize an upgrade.** An application below Kit `3.1.0` requires an explicitly scoped [prerequisite framework migration](migration.md) before this setup applies; if that migration is outside the request, report the prerequisite and leave the unrelated application unchanged. For an application already on Kit `>=3.1.0` with this Skeleton pair, preserve its compatible framework, deployment adapter, toolchain, lockfile and working conventions and make only the requested UI changes.

For an approved Skeleton installation or migration on Kit `>=3.1.0`, install the destination pair with the repository's package manager; the npm command is:

```sh
npm install -D --save-exact @skeletonlabs/skeleton@5.0.1 @skeletonlabs/skeleton-svelte@5.0.1
```

Retain compatible existing Kit `>=3.1.0`, Svelte 5, Tailwind 4 and Vite integration versions only after checking the selected Kit release's framework, plugin and adapter contracts. Skeleton's component peer `^5.40.0` and core Tailwind peer `^4.0.0` do not lower this skill's framework floor; the exact Kit `3.1.0` baseline requires Svelte `^5.57.1`. Older Skeleton apps require the staged [migration](migration.md), not just a dependency update.

For a prerequisite framework migration, use the [Kit migration guidance](migration.md) and the exact baseline above, or source-checked compatible versions for a newer Kit `>=3.1.0` target. Coordinate Kit, Svelte, Vite, the Svelte Vite plugin, optional TypeScript, Node and the existing deployment adapter; never force incompatible peers or silently rewrite unrelated applications. Apply the configuration and module changes below to the supported target. Preserve application settings, plugins, layouts and CSS; merge supported changes rather than overwriting whole files.

## Lucide when icons are useful

For either project path, add the optional icon dependency only when using icons:

```sh
npm install --save-exact @lucide/svelte@1.61.0
```

Follow the [current Lucide Svelte guide](https://lucide.dev/guide/svelte/) and the
[exact package metadata](https://registry.npmjs.org/@lucide/svelte/1.61.0), not
another framework's icon package. Prefer canonical public per-icon default imports:

```ts
import Search from '@lucide/svelte/icons/search';
```

Root named imports such as `import { Search } from '@lucide/svelte'` are also
public and valid. Per-icon imports keep the traversed module graph focused;
do not claim an unmeasured build-speed or bundle-size improvement.

Lucide renders inline SVG and needs no stylesheet, Tailwind plugin, `@source`,
DOM-scanning initializer, or client-only/`onMount` workaround for static imports.
Skeleton styles native controls or supplies interactive components; Lucide
supplies the icon, not the button's semantics or accessible name. Keep icons directly inside
Skeleton `btn`/`btn-icon` controls for their SVG sizing rules, and label the
actual control. See [Lucide imports](lucide.md#imports-and-package-boundary),
[props and styling](lucide.md#props-and-styling), and
[accessible icons and controls](lucide.md#accessible-icons-and-controls).

Find the icon in the [official catalog](https://lucide.dev/icons/), then
[verify its canonical export](lucide.md#discover-and-verify-an-icon) against the
installed version. A rolling catalog can contain icons absent from an older pin.
Use [offline package inspection](lucide.md#offline-package-inspection) without
network access and the [focused troubleshooting table](lucide.md#troubleshooting)
for import, SVG/CSS, naming, or context failures.

**Optional advanced Lab example only:** install the additional package when
using the [custom-data/Lab pattern](lucide-patterns.md#custom-icon-data-and-lab),
not as part of the default application dependency set:

```sh
npm install --save-exact @lucide/lab@0.7.0
```

Lab supplies icon data for Lucide's generic `Icon`; it does not replace
`@lucide/svelte`. Check its exact metadata, exported data and compatibility with
the resolved Svelte icon types before adapting an example. No global wrapper,
registry, or all-icon catalog is required.

## TypeScript configuration

The application's root `tsconfig.json` (or `jsconfig.json` for JavaScript) must extend `$app/tsconfig`, not `./.svelte-kit/tsconfig.json`. The old generated `.svelte-kit/tsconfig.json` is obsolete; do not try to restore it by rerunning sync. Kit's new base configuration does not supply `include` or `exclude`, so set them explicitly. Use this complete minimal configuration:

`tsconfig.json`:

```json
{
  "extends": "$app/tsconfig",
  "include": ["src", "test", "*"],
  "exclude": ["src/service-worker"]
}
```

For an existing project, merge these fields into its configuration rather than replacing the file: preserve application `compilerOptions` and other supported settings, retain additional source and test paths in `include`, and retain existing exclusions alongside `src/service-worker`. `$app/tsconfig` supplies essential `isolatedModules` and `verbatimModuleSyntax` options; do not disable them when merging. If the project has a TypeScript service worker, give it a separate `src/service-worker/tsconfig.json` extending `$app/tsconfig/service-worker`, as described in the same migration guide.

Sources: [Kit 3 `$app/tsconfig` migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3#$app-tsconfig), [exact 3.1.0 tsconfig generator](https://unpkg.com/@sveltejs/kit@3.1.0/src/core/sync/write_tsconfig/index.js).

## Vite integration

Kit `>=3.1.0` no longer supports `svelte.config.js`. Move its `kit` options to the object passed to `sveltekit()`; put `preprocess`, `compilerOptions`, and other supported Svelte options alongside them. Preserve the deployment adapter, then remove the obsolete configuration file. Review removed or renamed Kit options instead of copying them blindly. Merge the Tailwind Vite plugin **before** `sveltekit()`. A minimal greenfield configuration using adapter auto is:

`vite.config.ts`:

```ts
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit({ adapter: adapter() })]
});
```

If existing components require `vitePreprocess()`, keep its import from `@sveltejs/vite-plugin-svelte` and pass `preprocess: vitePreprocess()` to `sveltekit(...)`. Migrate Kit 3 module imports as described below; moving configuration alone is insufficient.

Sources: [Kit 3 configuration migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3#Configuration), [exact Kit 3.1.0 declarations](https://unpkg.com/@sveltejs/kit@3.1.0/types/index.d.ts), [Tailwind Vite installation](https://tailwindcss.com/docs/installation/using-vite). Do not add Skeleton's historical Tailwind plugin. Avoid processing Tailwind a second time via PostCSS; preserve unrelated PostCSS transforms.

## Kit 3 package imports and environment

`$lib` is no longer generated. Merge this public Node subpath-import mapping into the **application's** `package.json`, preserving its other fields and existing import mappings:

```json
{
  "imports": {
    "#lib/*": "./src/lib/*"
  }
}
```

Replace every `$lib/...` import and re-export with `#lib/...`, including in wrappers, tests, and shared helpers. Include the actual filename extension: `src/lib/components/ProfileCard.svelte` becomes `#lib/components/ProfileCard.svelte`; `src/lib/utils.ts` becomes `#lib/utils.ts` (or `.js` for a JavaScript file). The mapping does not create files or infer directory indexes. If callers import bare `$lib`, also map `"#lib": "./src/lib/index.ts"` (or `.js`) to the real barrel file and migrate those callers to `#lib`. Remove obsolete `files.lib` and `$lib` alias overrides; for a custom library directory, point the package mapping at that directory instead. Do not add a `$lib` compatibility alias.

Use `$app/env` instead of the deprecated `$app/environment` compatibility module in Kit 3.1.0; public `browser`, `building`, `dev`, and `version` exports remain available:

```ts
import { browser, building, dev, version } from '$app/env';
```

`$app/stores` is removed: migrate to read-only rune-reactive `$app/state`, not `$page`/`subscribe`/`set`. For environment configuration, export `variables = defineEnvVars({...})` from `src/env.ts`/`.js`, importing `defineEnvVars` from `@sveltejs/kit/env`; public/static default false. Runtime values are read at startup, not per request; without a schema values must exist but may be empty. Keep private values out of browser imports; public values are deliberately exposed. Sources: [Kit 3 import migration](https://svelte.dev/docs/kit/migrating-to-sveltekit-3), [environment variables](https://svelte.dev/docs/kit/environment-variables), [exact 3.1.0 declarations](https://unpkg.com/@sveltejs/kit@3.1.0/types/index.d.ts).

## Global CSS and dependency scanning

For `src/app.css` with `node_modules` in the app root, use:

```css
@import 'tailwindcss';
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';
@import '@skeletonlabs/skeleton/themes/cerberus';

```

These are the [current installation imports](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit). Presets are included in core. The historical optional-presets subpath is not exported by 5.0.1. The framework CSS import replaces the historical manual Skeleton `dist` scan. Keep imports grouped before plugins and application rules.

**Install form normalization when using Skeleton's styled native form classes** (`input`, `select`, `textarea`, `checkbox`, etc.). The [forms prerequisites](https://www.skeleton.dev/docs/svelte/tailwind-components/forms) require `@tailwindcss/forms` for those utilities, not for every Skeleton app or unstyled native form. Install the pinned release with the same package manager:

```sh
npm install -D --save-exact @tailwindcss/forms@0.5.11
```

Insert this directive **after all `@import` rules**, including theme imports, and before `@source` directives or application styles. Keep the imports grouped first:

```css
@plugin '@tailwindcss/forms';
```

See [styling](styling.md) for complete form and theme patterns.

Tailwind still supports `@source` for shared application UI and ignored dependencies outside automatic scanning. Default scanning begins at the working directory and excludes ignored files, CSS and `node_modules`. Use complete static class strings. **`@source` and `source()` paths are relative to the stylesheet**, not to `vite.config.*`.

For a monorepo with `apps/web/src/app.css`, hoisted dependencies in the repository's `node_modules`, and shared components in `packages/ui/src`, use the following. `source('../')` scans the app root, not only `apps/web/src`; the separate shared source is outside that scope.

`apps/web/src/app.css`:

```css
@import 'tailwindcss' source('../');
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';
@import '@skeletonlabs/skeleton/themes/cerberus';

@plugin '@tailwindcss/forms';
@source '../../../packages/ui/src';
```

Adjust the shared application path to an existing directory and register every additional shared UI source. Do not add a manual Skeleton dependency scan. Source: [Tailwind source detection and base-path rules](https://tailwindcss.com/docs/detecting-classes-in-source-files).

## Root layout and active theme

Import the stylesheet once in `src/routes/+layout.svelte`. A minimal Svelte 5 layout uses a `children` snippet:

**File: `src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
```

Source: [Svelte 5 children/snippet migration](https://svelte.dev/docs/svelte/v5-migration-guide#Snippets-instead-of-slots). Merge with existing layout data, providers and markup; preserve per-layout/request state isolation. A JavaScript layout can omit the type import and annotation. Historical Skeleton 2 store initialization is not part of this setup.

In `src/app.html`, **add only `data-theme="cerberus"` to the existing `<html>` element**. Preserve language attributes and the rest of the template. Partial HTML fragment for an existing English template:

```html
<html lang="en" data-theme="cerberus">
```

Theme registration (CSS import) and activation (`data-theme`) are distinct requirements, and their names must match. Do not place this attribute only on `<body>`. Preserve `%sveltekit.head%`, `%sveltekit.body%` and its wrapper, asset paths, CSP placeholders, metadata and preload attributes. Sources: [Skeleton theme activation](https://www.skeleton.dev/docs/svelte/get-started/installation/sveltekit), [Kit template placeholders](https://svelte.dev/docs/kit/project-structure#Project-files-src).

## Targeted diagnosis

| Symptom | Inspect and correct |
| --- | --- |
| Unexpected dependency versions | Check both Skeleton pins (`5.0.1`), workspace manifest and resolved lockfile; pinning a migration CLI does not pin its generated ranges. |
| Peer conflict involving Vite | Check the selected Kit release's peers; the exact Kit `3.1.0` baseline requires Vite `^8.0.12` and Svelte-plugin `^7.0.0`, and the pinned Tailwind 4.3.3 Vite plugin supports Vite 8. An older application needs the scoped prerequisite migration, not forced peers. |
| TypeScript peer error in the Kit 3 target | Kit's optional peer is `^6.0.0`; the published target pin is `6.0.3`. Check installed tooling peers rather than bypassing them. |
| `tsconfig_extends_missing` or missing `.svelte-kit/tsconfig.json` | Extend `$app/tsconfig` and explicitly set `include`/`exclude` as in [TypeScript configuration](#typescript-configuration); preserve application compiler options. |
| Kit 3 complains about `svelte.config.*` or old module aliases | Move configuration to `sveltekit({...})`, remove the old file, and migrate imports per the Kit 3 guide. This is a Kit upgrade issue, not a Skeleton stylesheet problem. |
| Tailwind works, component internals lack styles | Check `@import '@skeletonlabs/skeleton-svelte'` and the root layout CSS import. |
| Utilities exist, theme colors do not | Check core CSS, theme CSS and matching `<html data-theme>`. |
| `preset-*` styles missing | Presets come from core; inspect the import and exact class spelling, not a historical optional-presets import or plugin. |
| Export/prop error for a component | Inspect installed root exports and declarations. Historical `/composed` imports are not public 5.0.1 entrypoints; see [migration](migration.md). |
| Lucide import, sizing, naming, or context failure | Use the focused [Lucide troubleshooting table](lucide.md#troubleshooting), then [offline package inspection](lucide.md#offline-package-inspection) for the resolved export/types/source. Do not add a Skeleton scanner/plugin or client-only workaround. |
| HTML/hydration template error | Restore Kit's template placeholders and body wrapper; adding a theme never requires replacing `app.html`. |

Before handing off, inspect resolved versions with the chosen package manager, run the project's existing typecheck and build, and smoke-test a rendered styled page and one interactive component. Record exact commands and results; a successful compile does not establish focus behavior, keyboard behavior, or deployment compatibility. For offline API inspection, use the [migration reference](migration.md#offline-inspection-fallback).
