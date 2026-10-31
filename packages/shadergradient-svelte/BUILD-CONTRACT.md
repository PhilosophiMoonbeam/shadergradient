# Native package build contract

`@shadergradient/svelte` is an ESM Svelte library packaged by
`@sveltejs/package`, not a React bridge or a SvelteKit application. Its source
entry is `src/lib/index.ts`; package exports resolve only generated `dist`
files. `types` is the first export condition, followed by `svelte` and
`default`. Internal files are not public subpaths. The legacy `svelte` field
also points at the generated entry. CSS is the only declared side effect.

## Build and local artifacts

From the workspace root, with the public core built first:

```sh
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte typecheck
pnpm --filter @shadergradient/svelte build
pnpm --filter @shadergradient/core pack --pack-destination <absolute-artifact-directory>
pnpm --filter @shadergradient/svelte pack --pack-destination <absolute-artifact-directory>
```

`build` runs `svelte-package --input src/lib --output dist --tsconfig
./tsconfig.json`. The SDK preprocesses real `.svelte` components, transpiles
TypeScript, and emits adjacent declarations. It does not precompile components
into a browser-only renderer or require a GLSL loader. Fully specified local
`.js`/`.svelte` imports survive publication. Declarations do not use repository
source aliases. Source maps/declaration maps are not enabled, so the package
need not ship raw TypeScript to satisfy map references.

The standalone library's `svelte.config.js` supplies
`vitePreprocess({ script: true })` and runes mode. Explicit script preprocessing
erases TypeScript before publication; the default skips it in Svelte 5 and left
optional typed parameters that the independently installed Svelte 5.40/Vite 7
consumer could not compile. Consumers must not need a private preprocessing shim.
See the primary [TypeScript preprocessing](https://svelte.dev/docs/svelte/typescript)
and [packaging](https://svelte.dev/docs/kit/packaging) guidance. No Kit
configuration, generated Kit tsconfig, `$app` import or Kit runtime dependency
belongs here. Kit 3 consumers configure their own `@sveltejs/kit/vite` plugin
rather than copying this library configuration.

The initial types/presets-only F05 checkpoint used the scoped TypeScript
compiler: `svelte-check` correctly warned that no real Svelte input files
existed. That observation remains recorded, not hidden by a stub or filter.
With actual components landed, `typecheck` now runs
`svelte-check --tsconfig ./tsconfig.json --fail-on-warnings` across Svelte
and TypeScript sources. The integrator exercised this gate and the same SDK
publication pipeline. The complete Canvas/Gradient/Source/View surface is
exported; F26 still owns independently packed certification.

The scoped development tuple is Svelte 5.57.3, Threlte 8.6.1, Three 0.186.1,
Three declarations 0.186.0, Vite 8.2.1/plugin 7.3.0, SDK 3.0.1,
svelte-check 4.7.7 and TypeScript 6.0.3. Development uses Node 22.17+; actual
sprint execution records its exact Node version in Beads. This does not
upgrade root TypeScript 5.7.3 or any existing React/Vue peer range. SDK 3's
optional TypeScript peer is major 6. Camera controls are scoped to 2.9.0;
managed-camera runtime qualification is separate from package creation.

Formatting is native-scoped Prettier 3.9.10 with Svelte plugin 4.1.1,
inheriting the existing root style options without upgrading root Prettier.
Use `pnpm --filter @shadergradient/svelte format` or `format:check`; the
latter is available for shared CI integration. Only development tooling is
added; no formatter enters the published runtime dependency graph.

Peers deliberately match F03's evidence-bounded selection: Svelte
`>=5.40.0 <=5.57.3`, exact `@threlte/core` 8.6.1 and exact Three 0.186.1.
Do not widen these from shader-only evidence. F26 must qualify the final
packed native API at the selected lower/current Svelte bounds, including
controls, official r186 addons and SSR/hydration, before F31 acceptance.

## Public source and export handoff

The F05 types/presets-only checkpoint is historical. Current public values
are real `ShaderGradientCanvas`, `ShaderGradient`, `ShaderGradientSource`,
`ShaderGradientView`, `createGradientSource`, `presets` and `presetsArray`,
with F01's public type whitelist retained. Managed Gradient assembles the native
helpers; external mode owns mesh/material/time only. Source/View uses explicit
caller-owned handles and synchronous completed-frame copies, not a global ID
registry or independent mirror animation loop. Core shader strings, adaptation,
Halftone and camera/HDR constants are not duplicated or reexported as another
native asset API.

The public component entry requires a Svelte-aware compiler/bundler for SSR:
the SDK intentionally ships preprocessed `.svelte` components, not raw-Node
component code or browser-only stubs. Raw Node pure-data consumers import
`@shadergradient/core`. The initial raw-Node preset-only smoke is not a promise
that Node can execute later `.svelte` reexports without a compiler.

F19 is the final ordered `index.ts` export handoff. Sources, views and handles
use the same SDK publication pipeline as Canvas/Gradient, without temporary
renderer paths, placeholder components or private-source subpath shims.

Owned renderer recreation depends on eligibility, actual
`preserveDrawingBuffer`/`powerPreference` changes and genuine context restoration.
Unrelated spread-prop invalidations, DPR, FOV and positive-size changes do not
recreate the renderer. Positive subpixel backing dimensions remain at least one
pixel per axis without changing the logical CSS size, camera aspect or DPR.

Post-mount context loss removes the failed Threlte scene, stops publication and
releases owned scene/renderer resources. The Canvas wrapper retains only its
bounded old-context restoration capability until a genuine restoration event or
wrapper teardown; it does not run an automatic retry loop. Restoration installs
a fresh generation without briefly remounting the retired one.

Source hands normalized dimensions and DPR to its child Canvas through
reservation-owned primitive state. Child cleanup can finish after the parent
component's derived prop graph is destroyed; it must not read that retired
graph. The keyed scene reference is captured once inside its key, rather than
following a reactive binding that teardown has already retired. Full component
teardown releases external leases without invalidating its dead render graph.
Paused size/DPR updates still reuse the renderer and producer generation, and
source retirement clears publication before releasing its owned renderer.

The core dependency uses `workspace:^` in the repository; pnpm packing must
rewrite it to a real semver range. Local consumers install both actual
packages from identified tarballs, with a local core override where needed
because no registry publication is authorized or assumed. React, R3F and
Kit are not native runtime dependencies. Core itself has no framework or
runtime Three dependency, so native's Three pin cannot propagate through
core into older adapters.

## Acceptance boundary

The integrator owns installs, root lock updates, formatting, build/typecheck,
tarball inspection and independently installed public import/type smokes.
Workers edit only. F05 certifies its actual available source set, not a
rendering scaffold or the final sprint. F26/F28 must share one identified
artifact preparation for complete plain-Svelte/Kit consumers and browsers;
F31 qualifies an unchanged final source/lock/artifact candidate independently.
Do not prepend preparation to `test:e2e`: that command already owns it.

No command above publishes, commits, pushes, deploys or synchronizes Dolt.
Remote publication and upstream submission require separate authorization.

Primary references: [Svelte packaging](https://svelte.dev/docs/kit/packaging),
[Kit Vite plugin](https://svelte.dev/docs/kit/@sveltejs-kit-vite), and the
package registry metadata for the exact scoped tool versions. The native
API/resource contract and compatibility evidence remain in the repository's
`docs/SVELTE-NATIVE-CONTRACT.md` and `docs/SVELTE-COMPATIBILITY.md`.
