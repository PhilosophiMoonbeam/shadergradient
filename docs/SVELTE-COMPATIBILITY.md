# Native Svelte compatibility matrix

## Evidence status

**The orchestrator accepted all nine cells after executing them:** eight plain-Svelte combinations and the actual Kit 3.1 production consumer. Each passed raw neutral ESM import, compiled SSR with no server canvas, real hydration, all twelve shader/geometry renders and unmount/remount. This is pre-extraction fixture evidence, not final native-package certification. `matrix.json` records conservative implementation bounds; cell-local `advertisedBounds` remain null because each cell proves its exact tuple, not an independent publication range.

Parent-observed initial current-cell installation **failed** strict peer resolution: Vite **8.2.1** requires optional peer esbuild `^0.27.0 || ^0.28.0`, while the initial fixture pinned **0.25.10**. The complete failed-install output is retained in parent execution artifact `artifact://179`; preparation itself succeeded, but no runtime compatibility follows. The four Vite 8 plain cells and Kit cell now pin registry-confirmed **esbuild 0.28.1**; Vite 7 floor cells retain **0.25.10**. Strict peer checks remain enabled; the original failed attempt is not erased or relabeled as passing.

The parent subsequently observed current-cell **raw neutral import, compiled SSR with zero server canvas and client production build passing**, followed by a browser-harness failure: `TypeError` because `chromium` was undefined. The fixture-scoped Playwright CommonJS entry exposed only a default export through the original dynamic import. Parent retained the complete result as `evidence/matrix-current-before-loader-fix.json` and original output `artifact://182`. The harness now uses its existing fixture-scoped `createRequire` to load Playwright; no browser/rendering success is inferred before the parent reruns it. The parent also observed an ignored esbuild build-script warning; every isolated manifest now explicitly approves **only esbuild** through `pnpm.onlyBuiltDependencies`, without changing root policy. `observations.json` preserves both reported failures and their corrections.

All eight plain cells passed (`artifact://210`, with the current cell in `artifact://190`), and corrected Kit qualification passed (`artifact://222`). Parent acceptance inspected every retained JSON result: twelve passing cases per cell, zero shader/page errors, exact hydration, zero SSR canvases and one remounted canvas. The accepted result/lock hashes are indexed externally in `/home/bbferko/.cache/shadergradient-a0q/evidence/f03-accepted-matrix.json`. These cells used Playwright **1.62.1** and Chromium **151.0.7922.34**; the separate initial three-engine capability probe used root Playwright **1.63.0**, not this browser version.

Kit's first build failed with `config_file_unsupported` because Kit **3.1** no longer accepts `svelte.config.js`; it also reported missing generated `$app/tsconfig`. That failed result remains in the Kit cell's results/history. The corrected fixture configures `sveltekit({ adapter: adapter() })` directly in `vite.config.js` and removes the legacy file. Preparation invokes the **installed Kit 3.1 `svelte-kit sync` CLI** after writing the route and `tsconfig.json`; Kit bootstraps/generates its own configuration. The corrected production build, HTTP SSR response, exact-response hydration and twelve shader cases passed. Initial esbuild preparation still warned about `$app/tsconfig` before sync; that diagnostic is preserved, not promoted into a failed runtime or hidden by a handwritten placeholder.

These fixtures qualify the pre-extraction canonical shader/data/material approach, not the final `@shadergradient/core` or `@shadergradient/svelte` package. There is no fabricated core dependency. F26 owns actual packed-package certification. Previously observed feasibility at Svelte **5.57.1** in `SVELTE-ASSESSMENT.md` is not evidence for these **5.57.3** candidate cells.

## Candidate cells and isolated toolchains

All versions below are exact manifest pins. The eight plain consumers span the full 2 × 2 × 2 Cartesian product, so Svelte and Threlte floor failures can be distinguished from Three shader failures.

| Cell               | Svelte | Threlte core | Three   | Vite  | Svelte plugin | Status                                |
| ------------------ | ------ | ------------ | ------- | ----- | ------------- | ------------------------------------- |
| `p-s540-t800-r180` | 5.40.0 | 8.0.0        | 0.180.0 | 7.1.4 | 6.2.1         | Passed (parent)                       |
| `p-s540-t800-r186` | 5.40.0 | 8.0.0        | 0.186.1 | 7.1.4 | 6.2.1         | Passed (parent)                       |
| `p-s540-t861-r180` | 5.40.0 | 8.6.1        | 0.180.0 | 7.1.4 | 6.2.1         | Passed (parent)                       |
| `p-s540-t861-r186` | 5.40.0 | 8.6.1        | 0.186.1 | 7.1.4 | 6.2.1         | Passed (parent)                       |
| `p-s557-t800-r180` | 5.57.3 | 8.0.0        | 0.180.0 | 8.2.1 | 7.3.0         | Passed (parent)                       |
| `p-s557-t800-r186` | 5.57.3 | 8.0.0        | 0.186.1 | 8.2.1 | 7.3.0         | Passed (parent)                       |
| `p-s557-t861-r180` | 5.57.3 | 8.6.1        | 0.180.0 | 8.2.1 | 7.3.0         | Passed (parent)                       |
| `p-s557-t861-r186` | 5.57.3 | 8.6.1        | 0.186.1 | 8.2.1 | 7.3.0         | Passed (parent)                       |
| `kit-current`      | 5.57.3 | 8.6.1        | 0.186.1 | 8.2.1 | 7.3.0         | Passed after configuration correction |

The Kit cell additionally pins Kit **3.1.0**, adapter-node **6.0.0** and TypeScript **6.0.3**. Every cell records pnpm **10.12.4** and uses Node **>=22.17** as its fixture-toolchain requirement. This is not a new root Node engine or native runtime peer claim. esbuild **0.25.10** in Vite 7 floor cells and **0.28.1** in Vite 8 current/Kit cells perform the explicit canonical fixture build; Playwright **1.62.1** owns browser evidence.

The proposed plain-Svelte API floor is **5.40.0**, because the fixture actually calls `createContext`, provides a per-tree value and consumes it below Canvas. The lower toolchain's plugin 6.2.1 accepts Svelte `^5.0.0` and Vite `^6.3.0 || ^7.0.0`. Kit 3.1 instead requires Svelte `^5.57.1`, Vite `^8.0.12`, plugin `^7.0.0`, Node `>=22.17` and optional TypeScript `^6.0.0`. A Kit install conflict at Svelte 5.40 would therefore not demonstrate a library runtime failure; no intentionally incompatible Kit/5.40 cell is used as floor evidence.

Threlte 8.0.0 declares Svelte `>=5` and Three `>=0.155`; Threlte 8.6.1 declares Svelte `>=5` and Three `>=0.172`. Upstream peers are not ShaderGradient feature proof. F05's conservative selected native bounds are **Svelte `>=5.40.0 <=5.57.3`, Threlte `8.6.1`, Three `0.186.1`**. The Svelte interval has tested floor/current compilers; Threlte and Three remain exact demonstrated implementation pins rather than an inferred continuous Three interval or untested future patches. Passing 8.0/r180 shader cells do not certify native controls/HDR/composer APIs there. F26 must repeat real generated/packed native consumers at the selected bounds before final support is claimed.

## Orchestrator commands

Run serially from the repository root. Do not run root installation, root upgrades or legacy adapter version changes for this matrix. `--ignore-workspace` prevents the nested consumers from silently joining the root workspace; `.npmrc` requires strict peer resolution and disables workspace linking. Use `npx` rather than corepack's direct download path.

```sh
# Choose one listed cell; repeat independently for every row above.
CELL=tests/svelte/version-matrix/p-s540-t800-r180
npx --yes pnpm@10.12.4 --dir "$CELL" install --ignore-workspace --no-frozen-lockfile

# Install the matching browser once in the shared Playwright browser cache.
npx --yes pnpm@10.12.4 --dir "$CELL" exec playwright install chromium

# Retain this cell's own pnpm-lock.yaml, install diagnostics and complete results directory.
npx --yes pnpm@10.12.4 --dir "$CELL" run qualify

# Subsequent reproduction on the retained lock:
npx --yes pnpm@10.12.4 --dir "$CELL" install --ignore-workspace --frozen-lockfile
npx --yes pnpm@10.12.4 --dir "$CELL" run qualify
```

`prepare` is also an install lifecycle script and explicitly builds the fixture data before use. Every cell manifest sets `pnpm.onlyBuiltDependencies: ["esbuild"]` as a narrow pnpm 10 approval for the required installation script. Preserve any ignored-build warning; if an external configuration still prevents that approved build, resolve the cell-local policy before treating a clean install as reproducible. Never globally allow dependency scripts or modify the root policy to hide a failure. The orchestrator owns lockfiles and installs. Browser system dependencies are an environment prerequisite, not an application compatibility result.

For component static analysis, the parent may additionally run the Svelte skill's autofixer against `shared/App.svelte` and `shared/Scene.svelte` at both selected Svelte versions. No worker static analysis, formatter or gate result is asserted.

`qualify` performs preparation and the raw Node import first, compiles SSR through Svelte-aware Vite tooling in plain cells, builds the client, then runs production-preview hydration/browser checks. The Kit cell runs a real Kit production build and its adapter-node server with SSR enabled; it does not set `ssr: false` or replace Kit with a plain-Svelte SSR approximation. Servers and browsers started by qualification are closed in `finally`.

A failed install must retain the complete command, Node/pnpm version, stdout/stderr and peer/engine diagnostics beside the affected cell's evidence; it is **not** a passing or skipped runtime cell. A qualification failure writes `results/result.json` with the failing phase, error and all already observed data. Before writing a new qualification result, the runner archives the preceding complete `results/` directory into a unique `<cell>/results-history/<timestamp>-<uuid>/` directory, preserving prior logs, SSR HTML, observations and screenshots. The parent must still preserve install diagnostics and archive externally before any install lifecycle preparation can replace generated provenance. The runner stops at a prerequisite phase failure; shader cases that render but fail pixel/chunk/REVISION checks remain individually marked failed, and all twelve observations are collected before asserting aggregate success.

## What the fixtures measure

### Canonical source build and raw pure data

The initial nine-cell run bundled canonical shader/preset sources before extraction; that immutable provenance is retained in the accepted index and histories. After F04 moved those assets, `shared/prepare.mjs` imports the **actual public `@shadergradient/core` dependency** through its migrated Vue consumer, with no deleted-path fallback or source alias. It separately bundles the unchanged Vue material adapter, resolving that adapter's public core import normally and externalizing Three to the selected cell pin. The material-local adaptation and canonical shader values remain unchanged; no global `ShaderChunk` patch or divergent shader copy is introduced.

The generated `.fixture/pure.mjs` is a neutral ESM data fixture. A separate raw Node process traps browser APIs/fetch, imports it, and inspects ten presets and twelve shader pairs; raw Node never imports `.svelte`. Provenance hashes actual esbuild inputs. Historical `canonical-pre-extraction-fixture` records remain valid historical evidence; renewed `canonical-public-core-fixture` records identify the real built-core entry. Neither label certifies the final native package. Preserve initial artifacts rather than relabeling them; final packed-core/native certification belongs to F26.

After the public-core cutover, the orchestrator renewed `p-s540-t861-r186`, `p-s557-t861-r186`, and `kit-current`: **36 shader cases, raw neutral imports, compiled/production SSR, real hydration and remount passed again**, with zero shader/page errors (`artifact://267`). The separate index is `/home/bbferko/.cache/shadergradient-a0q/evidence/f03-public-core-renewal.json`. These are the selected implementation bounds; the original six additional tuples remain preserved pre-extraction evidence, not newly certified native APIs.

### Server boundary and exact initial hydration

`shared/App.svelte` statically imports Threlte, Three and the Scene component, but renders Canvas and Scene **only after `onMount`**. The server therefore renders a stable 640 × 360 layout/fallback, not browser scene snippets or a canvas. Plain cells server-render this component through Vite's Svelte compiler and `svelte/server`; fetch is trapped while loading and rendering. Kit executes its actual compiled server route in Node with a preload fetch guard. No HDR request, WebGL construction or browser DOM is needed on the server.

Plain qualification saves the exact server body into `results/ssr-body.html`, inserts that body into the production client document, holds hydration, checks the parsed server body/fallback with zero canvas and calls `hydrate` with `recover: false`. Browser serialization of boolean attributes is normalized only for the DOM equality assertion; the source body itself is not rewritten or replaced with a separately mounted approximation. Kit captures its entire production SSR document and serves those exact response bytes for the browser's initial navigation. Both require one visible canvas, fallback removal, unchanged layout, no hydration/mismatch/error diagnostics, and successful canvas unmount/remount. Kit uses its own normal hydration pipeline.

### Four shader families × three real geometries

Each cell renders `defaults`, `positionMix`, `cosmic`, `glass` against `plane`, `sphere`, `waterPlane`. Topology is canonical: plane `10 × 10, 1 × 192`, sphere icosahedron radius `1`, detail `64`, water plane `10 × 10, 192 × 192`. The probe uses deterministic time, halo settings/colors, an ambient/directional lighting fixture, linear output and no tone mapping. It does not claim HDR, composer, motion, final native feature parity or baseline screenshot equality.

The scene reads pixels in a Threlte render-stage task ordered **after the existing default render task**. There is no second render path, extra renderer or independent RAF. Per case it records exact Three `REVISION`, physical geometry parameters, actual shader-program presence, WebGL error, pixel range/nonzero count/hash, global `ShaderChunk` equality, per-tree context value and backend strings; a canvas PNG accompanies the observation. Shader compiler errors retain program/vertex/fragment logs. Console, failed requests, page errors and browser version are retained. Pixel evidence establishes visible nonblank output, not perceptual equality or GPU-leak absence. Manually created geometry/material are disposed by Scene; Canvas owns its renderer lifecycle.

## Evidence formats and promotion

- `matrix.json`: accepted fixture inventory and conservative F05 implementation bounds; not a claim of completed native-package certification.
- `<cell>/cell.json`: candidate pins/status; `cell.schema.json` defines the metadata shape.
- `<cell>/results/provenance.json`: hashed canonical input list; `provenance.schema.json` defines the provenance shape.
- `<cell>/results/result.json`: observed Node/direct dependency resolutions, lock hash, command phases/log paths, SSR and browser observations; `result.schema.json` defines the result shape.
- `<cell>/results-history/<timestamp>-<uuid>/`: previous complete qualification evidence, archived automatically before the next qualification.
- `<cell>/results/*.log`, SSR HTML and twelve PNGs: diagnostic artifacts. Generated dependencies/builds/evidence are ignored by the subtree's `.gitignore`; the orchestrator must archive selected evidence deliberately. Cell-local lockfiles are not ignored.

Promote a cell only after all required phases actually pass on its retained lock. Record failed cells without weakening shader/SSR assertions. Cite the named passing cell and its artifact hashes when selecting a bound. Keep plain-Svelte floor, Kit consumer toolchain and final native addon bounds separate. Update this document and metadata with observed results only; no package publication or full sprint acceptance follows from fixture implementation.

## Primary sources

Consulted for fixture design; metadata remains distinct from exercised evidence:

- [Svelte context/createContext (introduced in 5.40)](https://svelte.dev/docs/svelte/context)
- [Svelte onMount (does not run on the server)](https://svelte.dev/docs/svelte/lifecycle-hooks)
- [Svelte hydrate imperative API](https://svelte.dev/docs/svelte/svelte#hydrate)
- [Svelte library packaging and pure entry distinction](https://svelte.dev/docs/kit/packaging)
- [Kit project structure and generated TypeScript configuration](https://svelte.dev/docs/kit/project-structure)
- [Kit 3 inline `sveltekit(config)` configuration; legacy config removal](https://svelte.dev/docs/kit/@sveltejs-kit-vite)
- [Kit generated `$app/tsconfig` contract](https://svelte.dev/docs/kit/$app-tsconfig)
- [Kit 3.1.0 exact registry metadata](https://registry.npmjs.org/@sveltejs/kit/3.1.0)
- [Adapter-node 6.0.0 metadata](https://registry.npmjs.org/@sveltejs/adapter-node/6.0.0)
- [Lower plugin 6.2.1 metadata](https://registry.npmjs.org/@sveltejs/vite-plugin-svelte/6.2.1)
- [Threlte 8.0.0 metadata](https://registry.npmjs.org/@threlte/core/8.0.0), [8.6.1 metadata](https://registry.npmjs.org/@threlte/core/8.6.1)
- [Threlte Canvas](https://threlte.xyz/docs/reference/core/canvas/), [useThrelte](https://threlte.xyz/docs/reference/core/use-threlte/), [task ordering](https://threlte.xyz/docs/reference/core/use-task/)
- [Three r186 renderer/shader diagnostics implementation](https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js)
