# Legacy adapter compatibility baseline (F02)

## Evidence state and scope

The fixture/harness sources in `tests/svelte/baseline` are implemented and exercised. **The corrected full v3 capture recorded 76 passing and 22 failing adapter scenarios, with 24 command/host/consumer rows unexercised within that index.** The first two infrastructure failures remain preserved separately. Source inspection, a build, the preexisting browser suite, and a browser feature capture are different evidence. A failing characterization is not converted into a passing regression reference.

The orchestrator's separate initial command record is `/home/bbferko/.cache/shadergradient-a0q/evidence/initial-commands.json`, source baseline `785dcd4`, Node `24.15.0`, pnpm `10.12.4`. Its reported observations are:

| Existing command                                                       | Orchestrator observation                                                                                                                           | Original evidence                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| React `build:framer`, then ordinary React `build`                      | Passed, in that order because both clean/write `dist`                                                                                              | `artifact://150`                                                                                         |
| Vue `typecheck` and `build`                                            | Passed                                                                                                                                             | `artifact://150`                                                                                         |
| Framer plugin `build`                                                  | Passed                                                                                                                                             | parent job `bg_25`, indexed in the initial command record                                                |
| Nuxt workspace `typecheck`                                             | Passed                                                                                                                                             | parent job `bg_26`, indexed in the initial command record                                                |
| Nuxt workspace production `build`                                      | Passed                                                                                                                                             | `artifact://157`                                                                                         |
| Figma plugin `plugin:build`                                            | Passed                                                                                                                                             | `artifact://172`                                                                                         |
| Next workspace production `build`                                      | **Preexisting failure**, compilation succeeded but lint failed                                                                                     | `artifact://159`                                                                                         |
| Existing root `test:e2e`                                               | **39 passed, 41 skipped**, 8.3 minutes; no test edits                                                                                              | `artifact://180`                                                                                         |
| First feature-harness attempt                                          | 98 fixture-startup failures; no feature scenario exercised                                                                                         | `/home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre/evidence-index.json`                      |
| Second feature-harness attempt                                         | **39 passed, 59 failed, 24 unexercised**; all 49 React cases failed fixture module initialization; Vue produced 39 passes and 10 recorded failures | `artifact://196`; `/home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-v2/evidence-index.json` |
| Isolated-host v3 smoke                                                 | 2 passed, 0 failed; both actual adapters rendered defaults/plane                                                                                   | `/home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-v3-smoke/evidence-index.json`             |
| Full isolated-host v3 capture                                          | **76 passed, 22 failed, 24 unexercised**, no infrastructure error; all 98 React/Vue feature scenarios attempted                                    | `artifact://215`; `/home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-v3/evidence-index.json` |
| Shared UI `build`                                                      | Passed with preexisting side-effect/unused-import warnings                                                                                         | `artifact://206`                                                                                         |
| Next workspace development runtime                                     | Actual initial/sphere/water-plane canvas output; no page errors observed; owned tab/service stopped                                                | External evidence `next-initial.webp`, `next-sphere.webp`, `next-water-plane.webp`                       |
| Standalone React consumer builds / real Framer and Figma host sessions | Not exercised; a registry starter or hosted remote component is not the extraction candidate                                                       | Reproducible recipes and missing host prerequisites below                                                |

The Next failure includes unused setters in `app/loop/page.tsx` (`setUFrequency`, `setRange`, `setRangeStart`, `setRangeEnd`), JSX comment text at lines 393/404/411, and unused `color1`/`setColor1` plus explicit `any` in `app/page.tsx`. Do not disable lint, change dependencies, fix unrelated app code, or reinterpret the build as passing. A successful Next development render does not erase this production-build failure.

The existing browser run reported multiple-Three-instance and unsupported `WEBGL_lose_context` warnings. The orchestrator separately observed unexpected standalone manifest spec changes (Tres `^5.9`→`^5.10`, Vue `^5.43`→`^5.44`, Vite `^8.3.0`→`^8.3.5`, Nuxt `^4.5.2`→`^4.6.3`). Their attribution is unknown: **treat them as user/unattributed changes, preserve them, and do not claim browser preparation caused them or roll them back**. Parent-saved HEAD originals are provenance only; current files are the capture baseline until attribution is known. Retain exact manifest/lock hashes and resolved dependency tuples; do not assume different tuples are pixel-comparable. Existing suite success does not imply coverage of its 41 skipped cases or of this harness.

`initial-commands.json` is not silently converted into richer evidence: it does not contain every exact timestamp, exit code or raw local log needed by the harness's optional import format. Keep it as an authoritative separate observation index, or export the original command outputs with their actual provenance for `--observed`; **do not rerun completed gates just to fill fields**.

The initial harness failure was package-entry resolution: installed Vite `8.2.2` exports its root as `./dist/node/index.js` without `module`/`main`, while the first resolver invented `index.js`. The resolver now selects the actual public export map (including browser/import and Node/import conditions) and checks the selected file. The second attempt exposed a different harness-infrastructure failure: Vite analyzed the dormant Vue import in the React fixture. Framework hosts are now separate modules, with exactly one selected by the server. No scenario inputs, assertion thresholds, adapter production code or Vue update semantics were changed to fit results. Preserve both failed directories unchanged; the next full capture uses **`baseline-pre-v3`**.

The ten v2 Vue failures remain observations, not green expectations:

| Category                          | Exact v2 cases / evidence                                                                                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low RGB diversity (five)          | `matrix-cosmic-waterPlane`: 7 sampled colors; `preset-interstella`, `hdr-city`, `hdr-dawn`, `hdr-lobby`: 1 sampled color each. The preset/HDR cases had an assigned environment and no emitted adapter error. Keep the unchanged `>20` threshold and original images. |
| No new interaction callback (two) | `camera-mouse`, `camera-touch`: callback count stayed 1→1 during the capture window, although actual camera pose changed in both. Do not describe this as no camera movement.                                                                                         |
| Temporal assertions (two)         | `time-resume`: paused samples advanced from `4.174000000000009` to `4.8905000000000065`; `time-seek-negative`: final uniform stayed `-2` after requesting `-3`. Causes remain unconfirmed; no production or assertion fix is included.                                |
| Deliberate HDR failure (one)      | `hdr-failure`: `/baseline-hdr/dawn.hdr` returned 404, browser console recorded the resource error, and the adapter emitted the original fetch error.                                                                                                                  |

New captures fail fast only on an unambiguous script HTTP failure or page error **before** `window.baselineFixture` initializes (or server startup failure). The first case remains failed with original logs/trace; remaining affected-adapter cases stay explicitly unexercised with `blockedBy`, never passed or silently waived. Post-initialization feature/assertion failures still run independently through the full selected matrix.

### Accepted pre-extraction reference and exceptions

F04 uses the immutable **v3** index and its successful captures, not v1/v2 infrastructure failures or the earlier feasibility probe. Both adapters attempted all twelve shader/geometry combinations, ten presets and the declared query/camera/time/grain/HDR/export scenarios. Preserve all 22 observed failures:

- React: positionMix/sphere emitted a real fragment-shader compilation error (`linearToRelativeLuminance` overload); cosmic/waterPlane and interstella had low sampled diversity; sparse/invalid/repeated-fragment queries failed after React's wholesale query replacement; the fractional-camera case emitted no callback; three synthetic HDR scenes had low diversity; deliberate HDR 404 removed the visible Canvas; live HDR did not yield an assigned environment within the observation window.
- Vue: the ten categories above were observed again—low-diversity cosmic/waterPlane, interstella and three synthetic HDR scenes; camera movement without a new settled callback in the capture window; pause/negative-seek assertions; and deliberate HDR 404.

These are failures under the frozen workload and thresholds, not confirmed universal adapter defects. Exact inputs, sampled uniforms/camera poses, screenshots, errors and traces remain in the index. Do not alter production adapters or thresholds to make the aggregate green. Post-extraction acceptance preserves every successful comparable v3 case and retains the original failure evidence. Separate existing-suite and build observations remain authoritative at their narrower exercised scope; unexercised real editor sessions and standalone registry starters are not silently counted as passes.

## Owned, isolated implementation

- `scenarios.mjs`: deeply frozen, versioned scenario inputs, capture policy, build commands and existing-consumer IDs. Preserve the same file across F04. Preset names resolve the real public preset values; the exact resolved props and source hashes are retained in every run, so an extraction changing a preset cannot hide behind its name.
- `fixture/index.html`, `fixture/fixture.mjs`, `fixture/react.mjs` and `fixture/vue.mjs`: common observation/configuration plus isolated real framework hosts. Each server resolves exactly one host, with ordinary React `createRoot` or Vue `createApp` and the unchanged adapter's own Canvas/gradient. No production/app edits, alternative renderer, virtual clock, reduced geometry, shader replacement or shared Playwright config.
- `server.mjs`: uses the existing Vue development app's Vite installation; resolves React/Three/Fiber from the existing Next development consumer, and Vue/Three/Tres from the Vue development consumer. It requires the real built adapter export, never falls back to source. Ports 3194/3195 are strict; an occupied port fails rather than attaching to another service. Runtime dependencies are deduplicated inside each isolated fixture, not upgraded.
- `run.mjs`: standalone executable via `node`; sequential Chromium contexts and fixture servers; real pointer/touch interactions; raw logs, PNGs, traces, provenance and pre/post comparison. It does not invoke builds unless explicitly requested with `--commands`.
- `evidence.schema.json`: version-1 machine-readable index/provenance contract. The index records every scenario, including those not selected or lacking a consumer URL.

The browser-local `Mesh.onBeforeRender` wrapper only observes real uniforms, topology, transforms, material settings, camera, environment and renderer/backend after forwarding the original method. It neither writes adapter state nor adds a render/scheduler path. The bounded time/camera samples are observations, not a claim of GPU-memory measurement. Contexts are fresh per feature scenario; servers and contexts are closed at run end.

## Exact first capture

Use the existing prepared workspace and browser installation. The implementation worker has run no installs, builds, tests, linters, formatters or browser checks. If adapter builds have already passed, **do not rebuild them for this command**:

```sh
node tests/svelte/baseline/run.mjs \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-v3 \
  --phase pre
```

`--out` must be absent or empty; the runner refuses overwrite. The generated `evidence-index.json` is incrementally updated and references SHA-256-addressed artifact entries under its adjacent `artifacts/` directory. Vite's generated cache stays under the supplied output directory, not in tracked sources. Keep the complete pre directory immutable until F04 and review finish.

If the validated Chromium backend needs explicit flags, pass the **same exact flags** to pre and post, for example:

```sh
node tests/svelte/baseline/run.mjs \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-swiftshader \
  --phase pre \
  --launch-args '["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]'
```

The selected flags, executable, Playwright/browser versions, actual GL renderer/vendor/backend, Node/platform, commit, dirty worktree, lock hash, source hashes and resolved dependency versions/paths are recorded. A software-renderer capture is labelled by its actual renderer; it is not presented as hardware evidence.

For diagnosis without losing visibility of unselected cases, `--only '^vue/matrix-'` or `--adapter react` selects a subset while all other scenario rows stay `unexercised`. A subset is not full acceptance evidence.

## Frozen feature scenarios

Every item runs separately for React and Vue:

| Surface                | Reproducible inputs / recorded evidence                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shader × geometry      | `defaults`, `positionMix`, `cosmic`, `glass` × `plane`, `waterPlane`, `sphere`; all twelve combinations with the production topology and `cameraZoom: 8`; actual nontrivial pixels, GL metadata, errors, uniforms and geometry parameters |
| Ten presets            | `halo`, `pensive`, `mint`, `interstella`, `nightyNight`, `violaOrientalis`, `universe`, `sunset`, `mandarin`, `cottonCandy`; actual public preset props, paused and transitions disabled only; preserve preset grain/lighting/camera      |
| Props/query            | explicit props; fully serialized query; sparse query overriding explicit props; invalid enum/number/boolean/unknown keys; repeated color keys plus fragment; exact resolved passed inputs and actual resulting material state/pixels      |
| Camera                 | explicit fractional degree/distance/zoom inputs with unmodified callback payloads; real mouse drag; Chromium CDP real touch gesture; `zoomOut`; before/after camera pose and callback samples                                             |
| Time                   | paused samples, pause/resume, range `[1, 1.25)`, loop `[0, 0.25)`, loop with conflicting range `[4, 5)`, and an explicit negative paused seek from `-2` to `-3`; bounded real-clock samples                                               |
| Grain / declared props | off/on, blending `0`/`1`, wireframe false/true; image pairs and actual wireframe material state; no assumption that a declared prop is implemented                                                                                        |
| HDR                    | `city`, `dawn`, `lobby` against a deterministic valid 2×2 Radiance HDR network fixture; deliberate 404; separate live remote-HDR case; exact requests/status/errors and scene-environment assignment                                      |
| Public exports         | actual built runtime export names; required existing adapter exports, including React Framer controls/helpers and Vue Source/View                                                                                                         |

Deterministic HDR responses exercise the real loaders, material, environment and renderer, not fake renderer success. The live-HDR case is separate and never receives the synthetic response. Its external asset bytes/network availability are not promised deterministic. The intentional 404 remains `failed` if it emits errors; it is not converted into a green expected-failure test. Original failures always retain their logs and screenshots.

React replaces its visual prop bag wholesale in query mode; Vue retains props for missing/invalid recognized values. React wireframe and `grainBlending` are not presumed functional; Vue does use those settings. React and Vue clock restart/modulo policies and camera rounding differ. The harness records each adapter independently rather than normalizing them. `relationships` describes observed image equality/differences for props/full-query, grain off/on, grain-blending endpoints and wireframe endpoints; it never forces a React no-op to look like Vue.

## Existing consumer runtime recipes

The isolated feature matrix is not a claim that every unchanged example app exposes runtime controls for every feature. Capture the real host routes separately. Start only the consumers needed, in separately owned terminals/services; keep their full output and stop those services after capture. These commands do not edit app sources:

| Consumer ID                      | Exact server command from repository root                                                         | URL                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| `consumer-next-workspace`        | `pnpm --filter example-nextjs-dev exec next dev --hostname 127.0.0.1 --port 3204`                 | `http://127.0.0.1:3204/` |
| `consumer-vue-tres-workspace`    | `pnpm --filter example-vue-dev exec vite --host 127.0.0.1 --port 3205 --strictPort`               | `http://127.0.0.1:3205/` |
| `consumer-nuxt-workspace`        | `pnpm --filter example-nuxtjs-dev exec nuxt dev --host 127.0.0.1 --port 3206`                     | `http://127.0.0.1:3206/` |
| `consumer-react-vite-standalone` | `pnpm --dir apps/examples/example-vite-react exec vite --host 127.0.0.1 --port 3214 --strictPort` | `http://127.0.0.1:3214/` |
| `consumer-next-standalone`       | `pnpm --dir apps/examples/example-nextjs exec next dev --hostname 127.0.0.1 --port 3215`          | `http://127.0.0.1:3215/` |
| `consumer-vue-vite-standalone`   | `pnpm --dir apps/examples/example-vite-vue exec vite --host 127.0.0.1 --port 3217 --strictPort`   | `http://127.0.0.1:3217/` |
| `consumer-nuxt-standalone`       | `pnpm --dir apps/examples/example-nuxtjs exec nuxt dev --host 127.0.0.1 --port 3218`              | `http://127.0.0.1:3218/` |

The standalone Next example has no `dev` script; use `exec next dev`, not an invented `dev` script. Nested standalone apps are not root workspace members. Their dependency installs/packing are orchestrator-owned prerequisites, not a side effect of this harness. Existing Vue standalone preparation is in `tests/browser/prepare.mjs`/`pnpm prepare:e2e`; it packs/installs those consumers. Existing React standalone apps have their own manifests and may resolve a registry React adapter, not this checkout. Record that actual version; do not call registry rendering proof of the F04 candidate. If a prerequisite is absent, retain the original install/start failure as evidence rather than substituting a different app or package.

Supply an external JSON object with only actually running endpoints; commands must match what was really used (including an `npx --yes pnpm@10.12.4` prefix if used):

```json
{
  "consumer-next-workspace": {
    "url": "http://127.0.0.1:3204/",
    "command": [
      "pnpm",
      "--filter",
      "example-nextjs-dev",
      "exec",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3204"
    ]
  },
  "consumer-nuxt-workspace": {
    "url": "http://127.0.0.1:3206/",
    "command": [
      "pnpm",
      "--filter",
      "example-nuxtjs-dev",
      "exec",
      "nuxt",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "3206"
    ]
  }
}
```

```sh
node tests/svelte/baseline/run.mjs \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-consumers-pre \
  --phase pre --only '^consumer-' \
  --consumers /absolute/path/to/actually-running-consumers.json
```

Consumer cases record HTTP status, visible real canvas, nontrivial RGB pixels, browser errors, screenshot and actual installed dependency/entry hashes. Nuxt also follows `Away` then `Back to gradient`, verifying canvas removal/recreation. A missing endpoint stays unexercised; an endpoint that fails stays failed. These are runtime checks, not production-build proof.

To exercise **all frozen feature inputs under another existing consumer's dependency tuple**, use an additional isolated capture, keeping the local adapter build but resolving peers from that consumer. Examples:

```sh
node tests/svelte/baseline/run.mjs --phase pre \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-react-vite-peers-pre \
  --adapter react --react-root apps/examples/example-vite-react
node tests/svelte/baseline/run.mjs --phase pre \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-react-next-peers-pre \
  --adapter react --react-root apps/examples/example-nextjs
node tests/svelte/baseline/run.mjs --phase pre \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-nuxt-peers-pre \
  --adapter vue --vue-root apps/example-nuxtjs-dev
node tests/svelte/baseline/run.mjs --phase pre \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-standalone-nuxt-peers-pre \
  --adapter vue --vue-root apps/examples/example-nuxtjs
```

This is explicitly a Vite-hosted adapter/peer characterization, separate from Next/Nuxt SSR/navigation. Neither kind of evidence substitutes for the other.

## Build evidence without unnecessary reruns

All named existing build consumers and original browser preparation/tests have explicit immutable command rows. By default these rows remain unexercised **within this index**, rather than being inferred from a fixture render. Keep the parent initial command index beside it.

For a genuinely not-yet-run command, opt in by ID, e.g. `--commands build-react-vite-standalone,build-next-standalone`. `--commands all` exists for a fresh environment only; **do not use it when the orchestrator already captured those gates**. The runner streams raw stdout/stderr into artifacts and preserves nonzero exits. When both are explicitly selected, Framer's clean build runs before ordinary React build. Do not select Framer alone immediately before browser fixtures: restore the ordinary React build first with its already-authorized command, since `dist` is shared. Commands require `pnpm` available on PATH; ordinary capture does not.

Existing browser suite: the actual root script already prepares once. Use either `pnpm test:e2e`, or `pnpm prepare:e2e` followed by `pnpm exec playwright test`, never root `test:e2e` after another unnecessary preparation. Keep every failure verbatim.

To import already observed commands without executing them, pass `--observed /absolute/path/observed.json`, an array with this shape, populated from real command records:

```text
[{ id, command: [exact executable and arguments], commit, startedAt,
   cwd, versions, exitCode, log: "/absolute/path/raw-output.log", source }]
```

`id` must be a known command row; the actual command must retain that row's arguments, although a pinned `npx pnpm` wrapper is allowed. Actual integer exit code, timestamp, commit and existing raw log are required. The runner copies/hashes the log and does not permit rerunning an imported row. Never invent a missing timestamp/exit code from a pass/fail summary.

## Framer and Figma applicability

A passing Framer bundle/plugin or Figma plugin build proves only that build. Actual host runtimes require an authorized Framer/Figma session, external service access and host version provenance:

- Framer plugin: run the existing plugin in a real Framer project; load its hosted light/dark iframe; use the real `ADD_TO_CANVAS` action; record the actual inserted component URL and controls plus editor/preview screenshots and host console/network output. Current plugin source inserts `https://framer.com/m/ShaderGradient-oWuS.js` with range disabled, zoomOut false and axes false. That hosted component is **not automatically the local F04 bundle**.
- Figma plugin: import the existing `apps/figma-plugin/manifest.json` development plugin (its actual outputs are `dist/code.js` and `dist/ui.html`), open it in the authorized editor, load its real `https://shadergradient.co/figma-plugin` iframe, exercise the UI's existing insertion/export workflow and resize handle, and retain the resulting node/image plus console/message log. The remote iframe is not evidence that local adapter extraction shipped there.

Do not manufacture `framer`/`figma` globals, proxy host success or mock these APIs. Without a real authorized host capture, `host-framer`/`host-figma` stay explicitly unexercised. The harness can import actual evidence using `--host-evidence /absolute/path/hosts.json`, an array of `{ id, status, reason, hostVersion, startedAt, commit, steps, remoteAssets, artifacts: [{ role, path }] }`. Require at least `host-log` and `host-image` roles pointing at real files; artifact bytes are copied and hashed. Status can be `passed`, `failed`, or `unsupported` with its actual cause. Preserve the local-vs-hosted distinction in `reason` and `remoteAssets`.

## F04 unchanged-candidate comparison

After the orchestrator builds the unchanged extraction candidate once, retain the pre fixture inputs and run:

```sh
node tests/svelte/baseline/run.mjs \
  --out /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-post \
  --phase post \
  --reference /home/bbferko/.cache/shadergradient-a0q/evidence/baseline-pre-v3/evidence-index.json
```

Repeat each captured alternate peer tuple with its same `--adapter`/`--react-root`/`--vue-root` flags and matching pre index. Run existing consumer routes again separately with the same actual server commands and candidate artifacts.

Post comparison requires byte-identical scenario, harness, server, fixture and schema hashes plus the same policy. Changing assertions or fixture code invalidates the old reference rather than silently relaxing it. The post index records the original pre-index hash. Static uniforms, geometry, material settings, transforms, camera/environment and relevant public export/camera payload semantics also compare exactly after object-key canonicalization.

Successful static pre captures compare only when browser/Playwright/launch arguments, Three revision, GL backend/device and resolved dependency tuple match. The fixed tolerance is per-channel delta **8**, allowing at most **0.5%** of pixels to exceed it (including alpha). Capture dimensions are fixed at 480×320, DPR 1. Paused grain is spatially deterministic in the existing halftone shader and participates in static comparison. Pre PNG hashes are checked before comparison. Exceeding tolerance fails; there is no update-snapshots mode. A mismatched engine is explicitly non-comparable, never cross-engine byte equality.

Animated time, gestures and live HDR retain their real assertions/logs instead of asserting identical sampled frames. A successful pre case that now fails is flagged as a regression. A failed/unexercised pre case has no successful visual reference and remains visible as such; post failure does not retroactively green it. A known failed scenario makes the process exit nonzero even if the failure is preserved. Review the evidence rows rather than weakening assertions for a green aggregate exit.

Artifacts are intentionally retained externally for this sprint's F04 comparison and review; delete only the explicitly owned run directories after the orchestrator releases those references. Do not delete shared caches/services or overwrite pre images to save space. Trace/cache retention and final archival are orchestrator-owned.

Primary API references used for the harness: [Vite JavaScript createServer API](https://vite.dev/guide/api-javascript.html#createserver), [Playwright browser launch](https://playwright.dev/docs/api/class-browsertype#browser-type-launch). Existing runtime versions remain those resolved from this repository's consumers; no Three/React/Vue upgrade is introduced by this fixture.

### Observed core-extraction result

The first extraction candidate's post index is
`/home/bbferko/.cache/shadergradient-a0q/evidence/baseline-post-core/evidence-index.json`.
Integration selected exactly the immutable IDs of the 76 successful pre-v3
feature cases with `--only`: all passed, with zero regressions or infrastructure
errors under the unchanged harness, engine/backend and comparison policy.
The 46 unexercised rows in this post index comprise the 22 deliberately
unrerun preexisting failures and the 24 separate command/consumer/host rows;
none is counted as a passing comparison. The original failure evidence
remains in the pre-v3 index.

Separate post-extraction gates passed the existing packed Vue/Nuxt suite
(`pnpm test:e2e`, one preparation: 39 passed, 41 skipped), normal React and
hosted Framer builds, Vue typecheck/build, UI build and Nuxt
typecheck/production build. An actual Next development surface rendered
plane, sphere and waterPlane after extraction with no page errors; compact
`next-postcore-*.webp` captures are retained beside the indexes. The earlier
Next production lint failure and real-editor Framer/Figma limitations above
were not hidden or reclassified. This is F04 regression evidence, not a
final native-package or full-sprint acceptance claim.
