# Contributing to the native Svelte SDK

The native implementation is `@shadergradient/svelte`, built with Svelte 5,
Threlte and Three.js. It is not a React bridge. Read the
[native package guide](packages/shadergradient-svelte/README.md),
[consumer examples and local installation guide](apps/examples/README.md), and
[browser qualification guide](tests/browser/README.md) alongside this document.
Core and native version `0.1.0` are **local, unpublished artifacts**; a successful
local pack is not evidence of registry availability.

## Scoped toolchain

Use the root engine range, `^22.19.0 || ^24.11.0 || >=26.0.0`, and the pinned
`pnpm@10.12.4` (the engine minimum is pnpm 10.2.1). Current qualification used
Node 24.15.0. Do not infer support for every Node version from that observation.

| Native lane               | Qualified versions                                             |
| ------------------------- | -------------------------------------------------------------- |
| SDK and plain Svelte      | Svelte 5.40.0 lower / 5.57.3 current and maximum declared peer |
| SvelteKit                 | Kit 3.1.0, Svelte 5.57.1 lower / 5.57.3 current                |
| Scene peers               | `@threlte/core` 8.6.1 and `three` 0.186.1, exact               |
| Native compiler tooling   | TypeScript 6.0.3, svelte-check 4.7.7, `@types/three` 0.186.0   |
| Package producer          | `@sveltejs/package` 3.0.1                                      |
| Current consumers         | Vite 8.2.1, `@sveltejs/vite-plugin-svelte` 7.3.0               |
| Plain lower consumer only | Vite 7.1.4, plugin 6.2.1                                       |
| Kit adapter               | `@sveltejs/adapter-node` 6.0.0                                 |
| Browser runner            | Playwright 1.63.0                                              |

Kit's own Svelte floor is 5.57.1: do not force Svelte 5.40 into Kit 3.1.
These bounds are scoped native evidence, not permission to upgrade all legacy
React, Vue, UI, editor, TypeScript or Three dependencies. Root/core and existing
framework packages retain their own toolchains, including TypeScript 5.7.3.

SvelteKit 3 extends `$app/tsconfig`; it no longer generates the old `$lib`
alias. Use relative local imports, or explicitly declare Node `#lib` subpath
imports in the application's `package.json`. SDK imports remain public
`@shadergradient/svelte` imports. See the
[official Kit 3 migration guide](https://github.com/sveltejs/kit/blob/main/documentation/docs/60-appendix/35-migrating-to-sveltekit-3.md);
do not retrofit Kit 2 configuration to hide compiler diagnostics.

## Workspace build and development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte build
```

Build core first: native imports its generated public exports. In separate
terminals, watch core and native, then start the consumer:

```sh
pnpm --filter @shadergradient/core dev
```

```sh
pnpm --filter @shadergradient/svelte dev
```

```sh
pnpm --filter example-svelte-dev dev --force
```

For Kit, use `pnpm --filter example-sveltekit-dev dev --force` instead. Restart
Vite with `--force` after rebuilding a linked SDK to invalidate optimized linked
dependencies; do not diagnose stale optimized output as current package behavior.
Run initial builds before starting watchers. Stop only the processes you own.

Consumer imports must come from `@shadergradient/svelte`; framework-neutral
shaders, presets, constants and types come from `@shadergradient/core` where
exported. Both packages expose the public `.` entry. Do not introduce source
aliases, private `dist` subpaths, copied SDK shims, React adapters, or a second
public implementation to make a consumer pass. Native's `types`, `svelte` and
`default` export conditions are intentional. Raw Node can import neutral core;
raw Node parsing uncompiled `.svelte` files is not a native SSR qualification.
Compile native SSR through the actual Svelte toolchain and keep Kit SSR enabled.

## Ownership and runtime invariants

Preserve these contracts when changing implementation or examples:

- **Managed Canvas:** `ShaderGradientCanvas` owns its renderer lifecycle and
  Threlte context. The default managed `ShaderGradient` owns gradient camera,
  controls, lighting and effects. Allow one managed owner per context. Pass
  Gradient settings directly as props, not as a `settings` object.
- **External Canvas:** put `ShaderGradient mode="external"` in the host's
  Threlte Canvas. The host owns renderer, camera, lighting, controls and effects;
  the gradient contributes mesh/time only. Managed camera, lighting, effect and
  camera-callback props are rejected in external mode. Do not dispose borrowed
  host resources.
- **One scheduler and render path:** use the existing Threlte scheduling and
  selected render path. Do not add an independent requestAnimationFrame ticker,
  second renderer or duplicate composer draw. Grain/effect rendering and normal
  rendering must not both draw the same frame.
- **Explicit Source handles:** create `createGradientSource()` per component,
  tree or SSR request, never in a shared module singleton. The caller owns its
  terminal `dispose()` operation. Source and View detach their own resources but
  do not dispose the caller's handle. Release subscriptions and one-shot
  `requestFrame()` leases when their owner ends.
- **One producer, many mirrors:** `ShaderGradientSource` receives a required
  `source`, nested `gradient` managed props and nested `canvas` options. It always
  mounts its built-in managed Gradient; its children add scene content rather
  than replace that Gradient. Views copy completed frames into 2D canvases with
  centered cover sizing. They are not independent cameras, renderers or pointer
  forwarders. A completed frame/canvas is borrowed for synchronous use only;
  copy its pixels immediately if retaining output. Do not retain the borrowed
  canvas/frame as a stable snapshot or read an unfinished draw.
- **Bounded backing stores:** Source defaults to 1024 × 1024, pixel density 1
  and maximum dimension 2048; View defaults to pixel density 1 and maximum
  dimension 2048. Preserve positive-size rounding and density bounds rather
  than allowing unbounded DPR-driven allocations.
- **SSR isolation:** no browser globals, WebGL construction or shared mutable
  renderer/handle state during server evaluation. Preserve fallback markup,
  hydration and independent concurrent requests; never solve SSR by disabling
  it or hiding a failure behind a browser-only import workaround.
- **Accessibility:** Source's producer wrapper is hidden, inert and
  `aria-hidden`; a Source fallback inside it is not a visible announcement.
  View is decorative (`aria-hidden`) by default. Put meaningful visible fallback
  UI adjacent to it or deliberately override the wrapper's `aria-hidden` for
  semantic fallback content. Canvas pixels are not accessible text. Keep actual
  DOM controls, focus behavior and keyboard alternatives accessible; do not
  promise built-in orbit keyboard controls.
- **Motion and failure:** respect reduced motion, visibility, lazy activation
  and explicit activity without accumulating timers or replaying hidden elapsed
  time. Reduced motion stops time animation, not all drawing: props, camera,
  resize and HDR completion can request a one-shot redraw. Preserve fallback,
  error, context-loss/restoration and terminal disposal behavior; do not swallow
  failures or invent a nonexistent Canvas/Source `onReady` callback.

Core ships an HDR manifest, not HDR binaries. Checked-in assets are
`packages/ui/assets/hdr/{city,dawn,lobby}.hdr`. Copy them into the application's
public `hdr` directory and configure `envBasePath` as described in the examples;
remote hosting requires suitable CORS. Use the actual Three r186 HDRLoader
path, not a guessed private core binary import.

## Checks and what they establish

These are commands for the integration owner, not an instruction for parallel
editing agents to run overlapping gates. Agents in the documentation workflow
edit only; the owner integrates and qualifies once after all writers finish.
After building core/native, the smaller checks are:

```sh
pnpm --filter @shadergradient/core typecheck
pnpm --filter @shadergradient/svelte typecheck
pnpm test:svelte:contracts
pnpm test:svelte:types
pnpm --filter example-svelte-dev check
pnpm --filter example-svelte-dev build
pnpm --filter example-sveltekit-dev check
pnpm --filter example-sveltekit-dev build
```

- Core/native typechecks check their implementation declarations and Svelte
  diagnostics. They are not consumer runtime proof.
- `test:svelte:contracts` runs semantic settings/time unit contracts. It does not
  render a browser or certify shader pixels.
- `test:svelte:types` compiles positive and deliberately negative public consumer
  fixtures, including managed/external ownership, callbacks and snippets, against
  generated exports. It does not install, build or prepare consumers itself.
- Workspace app checks/builds exercise the local app compiler and Kit build;
  they do not establish independence from workspace aliases or dependencies.

For actual artifact qualification:

```sh
pnpm test:svelte:packages
```

This builds and packs core/native, installs outside-workspace plain/Kit
lower/current consumers, and runs actual compiler, production, compiled SSR and
browser runtime qualification. Linux isolation requires Bubblewrap and a real
pnpm executable installed outside the checkout; the checkout is hidden from the
consumers. Its public-import graph and installed-byte checks are not mocks or
source-text assertions. It retains an owned manifest and evidence; see the
examples guide for the independent manual setup and artifact locations.

The canonical full browser gate is:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

The runner requires the Linux browser/system dependencies and Xvfb described in
the [browser guide](tests/browser/README.md). `test:e2e` owns **one** preparation,
one packed runtime qualification and serial browser project waves. Do not run
`prepare:e2e && test:e2e`; do not launch competing preparations. Native projects
have a preparation guard: directly invoking Playwright is not an equivalent
native entry point. Use `pnpm test:e2e:native` for the native subset or
`pnpm test:e2e:legacy` for legacy-only execution. A preparation-only run is
`pnpm prepare:e2e`; reuse requires an unchanged validated manifest, not a bypass
of the guard. These subsets are not substitutes for the full final gate.

### Performance characterization

`tests/svelte/performance.mjs` consumes an actual retained F26 preparation
manifest for the same packed candidate. It does not prepare artifacts or own the
supplied servers. Use the instrumented workspace native and Vue fixture launch
commands in the browser guide. This is source-correlated workspace profiling,
not a claim that a packed production page was profiled. Do not substitute
arbitrary starter URLs or mutate candidate inputs after preparation. Keep those
owned servers alive for the run. With `NATIVE_URL`,
`VUE_URL`, `MANIFEST` and a uniquely owned on-disk `EVIDENCE_DIR` set to those
actual resources:

```sh
node tests/svelte/performance.mjs \
  --native-url "$NATIVE_URL" \
  --vue-url "$VUE_URL" \
  --manifest "$MANIFEST" \
  --output-dir "$EVIDENCE_DIR" \
  --cycles 100
```

Exactly 100 complete measured cycles after warm-up are required. The harness
records six allocation profiles, two heap snapshots, source/served-byte identity,
resource disposal and same-backend Vue observations. It checks the recorded
candidate inputs rather than relabeling stale preparation. Inspect and adjudicate
allocation/heap flags against their actual source: passing counters alone is not
zero allocation or GPU/driver leak proof. Do not shorten timings, remove
assertions, suppress traces or switch backends to erase a failure.

### Existing framework regressions

Build neutral core first, then preserve the existing framework/UI build lanes:

```sh
pnpm --filter @shadergradient/react build
pnpm --filter @shadergradient/vue build
pnpm --filter ui build
pnpm --filter @shadergradient/react exec tsup --config tsup.framer.config.ts --out-dir dist-framer
pnpm --filter @shadergradient/framer-plugin build
pnpm --filter @shadergradient/figma-plugin plugin:build
```

Keep the Framer bundle in the separate `dist-framer` output: do not replace the
normal React package output while qualifying its consumers. Framer/Figma bundle
builds and shared UI regressions are not proof inside the hosted editors. Record
pre-existing failures with their original scope and evidence; do not silently
repin dependencies, suppress the baseline or claim every legacy path passes.
The integration runner explicitly retains the F02 baseline of 22 known product
failures and 24 unexercised editor/Next limits. This is not a native regression
waiver or authorization for a blanket legacy upgrade.

## Scoped formatting

For native SDK source only, its package scripts select Prettier 3.9.10 and the
explicit Svelte plugin 4.1.1:

```sh
pnpm --filter @shadergradient/svelte format:check
pnpm --filter @shadergradient/svelte format
```

Do not run the root Prettier 2 command over Svelte source: it is not the native
formatter and can empty Svelte files. Do not run repository-wide formatters as
incidental cleanup. During parallel agent work, leave formatting to the single
integration owner after the union of edits; agents do not run these commands.

## Reproducible local package pair

For a manual consumer install, choose a new absolute directory outside the
checkout (the example below uses `/var/tmp/shadergradient-native-manual-pack`).
Do not reuse another person's evidence directory.

```sh
mkdir /var/tmp/shadergradient-native-manual-pack
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte build
pnpm --dir packages/shadergradient-core pack --pack-destination /var/tmp/shadergradient-native-manual-pack
pnpm --dir packages/shadergradient-svelte pack --pack-destination /var/tmp/shadergradient-native-manual-pack
```

The resulting pair is `shadergradient-core-0.1.0.tgz` and
`shadergradient-svelte-0.1.0.tgz`. Install **both** into each independently
scaffolded outside-workspace app. In that app's `package.json`, use these actual
paths for dependencies and the pnpm override (merge with its existing fields):

```json
{
  "dependencies": {
    "@shadergradient/core": "file:/var/tmp/shadergradient-native-manual-pack/shadergradient-core-0.1.0.tgz",
    "@shadergradient/svelte": "file:/var/tmp/shadergradient-native-manual-pack/shadergradient-svelte-0.1.0.tgz"
  },
  "pnpm": {
    "overrides": {
      "@shadergradient/core": "file:/var/tmp/shadergradient-native-manual-pack/shadergradient-core-0.1.0.tgz"
    }
  }
}
```

Packed native depends on core `^0.1.0`; merely adding the direct core tarball does
not replace that transitive resolution. The file override prevents a registry
lookup or accidentally qualifying a different core. Follow the
[examples guide](apps/examples/README.md) for complete plain Svelte and Kit
scaffolding, exact peer/tool installation, self-contained components, builds and
SSR execution. Keep Kit SSR enabled and use public exports. Registry installation
instructions become applicable only after a separately authorized publication of
both packages; they are not a promise that these versions exist remotely.

## Observed support, limitations and evidence ownership

The current pre-final local qualification recorded 34 browser projects, 1,808
rows: 1,684 passes and 124 adjudicated applicability skips, with zero unexpected,
flaky, unexecuted or unknown outcomes. All four outside-workspace packed
lower/current plain/Kit consumers passed runtime and SSR/type gates. This is a
local image-equivalent matrix, **not an actual hosted GitHub Actions run**.
Firefox WebGL2 worked both headless and headed using Mesa llvmpipe; the suite uses
headed Xvfb at 2560 × 2160. Do not repeat the obsolete claim that Firefox headless
WebGL is unavailable.

Touch projects emulate devices rather than exercise real phones/tablets.
Firefox uses `hasTouch=true` with `isMobile=false`; Firefox/WebKit lack the public
trusted touchMove operation used by Chromium, but actual tap, mouse and keyboard
scenarios execute. Protocol limits are not a blanket waiver of required paths.
WebKit privacy GPU labels are not physical-device proof. Hosted Framer/Figma
editors and real mobile hardware remain outside the demonstrated support.

F27's ordinary Chromium `launchOptions: {}` run observed SwiftShader and completed
100 cycles, 1,796 checks, six profiles and two heaps; all 57 allocation and 15 heap
flags were adjudicated. Overall JavaScript heap grew approximately 16.0 to
18.0 MB: this is not universal zero allocation. The separate opt-in
`E2E_CHROMIUM_VULKAN=1` AMD/RADV stress run crashed native Chromium with SIGFPE
(`FPE_INTDIV`, code 136). It is **not fixed** and is not a successful hardware
100-cycle result; no SDK cause has been established. Preserve that evidence
rather than claiming all hardware passes or applying speculative production fixes.

Acquire resources under a unique owner before starting work; register partially
acquired browsers, contexts, process groups, servers, temporary configurations
and directories so interruption cleans them up too. The performance harness owns
its browser/contexts, not the supplied servers. Preserve release/disposal evidence
and stop only owned processes; inspect cleanup failures rather than hiding them.
The package preparation budget is 4 GiB. Integration budgets include 3 GiB active
browser reports and 12 GiB for the whole owned CI tree; performance records caps
of 80 files / 256 MiB, two contexts, six profiles, two heaps and a 20-minute
deadline. Heap capture has separate raw/compressed bounds in its receipt.

Retain canonical lossless ZIP/HTML/JSON attachments and hashes, including failure
evidence. The integration retention policy keeps at most three verified inactive
owned runs up to 14 days old; hosted artifact retention is 14 days. Never prune
active or unknown owners, shared pnpm/browser caches, or unique proof. Archive
verification must cover contents and hashes before retiring expanded evidence;
no broad filesystem prune is an acceptable cleanup strategy.

## Release preparation is not publication

This guide does not authorize publishing, committing, pushing or syncing remotes.
The root `release` script builds core/React/Vue/Svelte and invokes Changesets publish;
it is not a native local qualification command and must not be used as one.
Review the paired public artifacts, exports, declarations, licenses, notices and
consumer evidence in the separately authorized release-preparation work.

F29 documentation does not make the branch finally ready. F30 release preparation
and F31 remain separate work: F31 must qualify **one unchanged integrated
candidate** after documentation/release changes, with fresh full gates, current
100-cycle characterization and independent review. Do not mix receipts from
changed candidates or present the pre-final observations above as final approval.
