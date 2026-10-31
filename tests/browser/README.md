# Browser and packed-consumer qualification

## Canonical owned run

From the repository root on Linux, use pnpm **10.12.4** and Node
**^22.19.0 || ^24.11.0 || >=26.0.0** (observed qualification: Node **24.15.0**,
Playwright **1.63.0**). Install system prerequisites for bubblewrap, Xvfb,
xauth, x11-xserver-utils and Mesa software GL; the host must permit the actual
bubblewrap user-namespace isolation. See the [workflow](../../.github/workflows/playwright.yml)
for its Ubuntu provisioning steps. Do not replace failed isolation with a
checkout-visible consumer or disable the native manifest guard.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
xvfb-run -a -s '-screen 0 2560x2160x24 -nolisten tcp' pnpm test:e2e
```

`test:e2e` owns **one** preparation, contracts/types gates, actual core/native
packing, independent installation and F26 runtime/SSR verification, followed by
serial browser waves and cleanup. Do not run `prepare:e2e && test:e2e`: that
prepares twice. `prepare:e2e` alone is a preparation operation, not a browser
matrix pass. The controller owns servers, one worker, zero retries and the
five-hour matrix deadline. Do not run concurrent controllers against the same
checkout/ports.

Each owned server has a bounded 120-second startup-readiness window. A refused
connection or a reset before any HTTP response remains not-ready within that
window. A reset after response headers, a truncated body or an application HTTP
error still fails; cancellation and an exited child always abort. This does not
retry browser tests or restart the application.

The native package-consumer preparation installs outside the workspace and
checks both lower and current plain-Svelte/Kit consumers: four real installed
consumers, type gates, compiled plain SSR, Kit HTTP SSR/request isolation, and
runtime behavior. Current native/plain Svelte is 5.57.3 and the plain lower
boundary is 5.40; Kit 3.1 has a 5.57.1 floor. Threlte 8.6.1 and Three 0.186.1
are exact qualified peers. A raw Node core import is not native compiled SSR.
See [native contributor guidance](../../CONTRIBUTING-SVELTE.md) and the
[starter installation guide](../../apps/examples/README.md).

## Scope and supported selection

The unfiltered `pnpm test:e2e` is the required final matrix; a focused pass never
substitutes for it. Scope commands use the same owned preparation/controller:

```sh
xvfb-run -a -s '-screen 0 2560x2160x24 -nolisten tcp' pnpm test:e2e:native
xvfb-run -a -s '-screen 0 2560x2160x24 -nolisten tcp' pnpm test:e2e:legacy
xvfb-run -a -s '-screen 0 2560x2160x24 -nolisten tcp' pnpm test:e2e:native -- --project=native-packed-kit-firefox
xvfb-run -a -s '-screen 0 2560x2160x24 -nolisten tcp' pnpm test:e2e:legacy -- --project=nuxt-dev-mobile
```

Playwright arguments follow `--`. Project/file selection, `--grep`/`-g`,
`--grep-invert`/`-G`, `--test-list` and `--test-list-invert` are resolved against
the full configuration. `--max-failures` and `--tsconfig` are accepted.
The supervisor owns output/reporters: `--reporter`, `--add-reporter` and
`--output` do not replace its canonical reports. It rejects overrides including
`--workers`, retries, timeouts, traces, repeat/shard/fully-parallel modes,
`--last-failed`, `--only-changed`, alternate configs/browsers, list/help/UI/debug
modes and `--pass-with-no-tests`; do not bypass that policy with direct native
`playwright test` calls.

Controller options before the separator are `--keep-artifacts`,
`--artifact-root PATH`, `--manifest PATH` and `--reuse-manifest PATH`.
Reuse requires the unchanged disk-backed prepared identity and matching actual
package/consumer bytes; it is not permission to reuse stale qualification.
Default runs create `/var/tmp/shadergradient-e2e-<id>/prepared-native-consumers.json`.
Keep artifacts only when deliberately retaining a prepared consumer for diagnosis;
normal integrated cleanup releases owned consumers and processes.

The default configuration has **34 projects**, not five total targets:

- Ten legacy Chromium projects: `vue-library`, `vue-dev`, `nuxt-dev`,
  `vue-standalone`, `nuxt-standalone`, each with a `-mobile` counterpart.
  `vue-library` is integration through the Vue app and intentionally shares its
  host with `vue-dev`, not an isolated component test.
- Twenty-four native projects: `native-{plain,kit,packed-plain,packed-kit}-{chromium,firefox,webkit}`
  desktop projects plus their touch counterparts. Chromium/WebKit append
  `-touch`; Firefox appends `-touch-viewport`. Desktop runs features, lifecycle
  and mirrors; touch projects run the feature spec.
- `plain` is the workspace development consumer, `kit` the workspace production
  consumer; `packed-plain` and `packed-kit` are the independently installed
  current production consumers. Lower-bound consumers also run in F26 before
  these project waves, not as extra project names.

Managed ports are **3105–3108** for legacy consumers, **3110** native plain,
**3111** native Kit, **3112–3113** packed current plain/Kit and **3114** private
lifecycle/HMR support. They must be free. Servers are not normal dev sessions and
are started/stopped by wave ownership. The only external-server escape is legacy:
start its four apps separately on 3005–3008, then explicitly run
`E2E_USE_DEV_SERVERS=1 E2E_SCOPE=legacy pnpm exec playwright test`.
It does not cover native preparation or the canonical integrated matrix.

## Performance fixture session

Performance collection is a separate session, not a second preparation chained
to `test:e2e`. Reuse a genuinely unchanged retained manifest, or prepare once:

```sh
PERF_SESSION="$(mktemp -d /var/tmp/shadergradient-profile.XXXXXX)"
node tests/svelte/package-consumers.mjs --prepare-only \
  --artifact-root "$PERF_SESSION/consumers" \
  --manifest "$PERF_SESSION/consumers/prepared-native-consumers.json"
```

For the source-attributed workspace setup actually characterized, start these
two owned servers in separate terminals after core/native builds:

```sh
pnpm --filter example-svelte-dev exec vite --force --host 127.0.0.1 --port 3110 --strictPort
```

```sh
pnpm --filter example-vue-dev exec vite --force --host 127.0.0.1 --port 3117 --strictPort
```

Set `NATIVE_URL=http://127.0.0.1:3110`,
`VUE_URL=http://127.0.0.1:3117/coverage.html` and `MANIFEST` to that actual
manifest, then follow the contributor guide's 100-cycle command with a new
disk-backed evidence directory. The profiler correlates served native source
bytes with the prepared package; this does not claim that its workspace page is
a packed production page. Stop only these owned servers afterward. A passing
collection still requires allocation/source and heap-retainer adjudication.

## Engine, touch and backend limits

Firefox projects run **headed** under an actual Xvfb display of at least
**2560×2160×24**, sufficient for the 820×1180 CSS touch viewport at DSF 1.5.
The supervisor probes and records actual engine/WebGL2 capabilities; supported
rendered cases must produce WebGL2 pixels, not become capability skips.
Current observations show Firefox WebGL2 works both headless and headed on Mesa
llvmpipe in the owned container. Older headless-unavailable assertions are not a
current limitation; the suite still intentionally qualifies headed Firefox.

Touch viewports are **emulation, not physical mobile-device proof**. Firefox uses
`hasTouch=true`, `isMobile=false`. Chromium's trusted touch movement uses CDP;
Firefox/WebKit do not expose the equivalent public trusted `touchMove` path.
Only those protocol-specific cases are inapplicable there: actual taps, mouse
and keyboard scenarios still execute. This is not a blanket touch-feature waiver.

Ordinary Chromium launch options are `{}`. The observed default backend was
**SwiftShader**, including the completed F27 100-cycle characterization:
1,796 checks, six allocation profiles and two heap snapshots. Allocation/heap
flags were source-adjudicated, not advertised as universal zero allocation.
Overall JS heap grew from about 16 to 18 MB; disposal counters and tracked
instance plateaus do not establish absence of GPU/driver leaks.

`E2E_CHROMIUM_VULKAN=1` is the explicit hardware opt-in, adding only
`--enable-gpu --use-angle=vulkan`; it is not the default or a silent fallback.
The AMD/RADV opt-in stress run failed with native Chromium **SIGFPE**. Its
failure evidence remains a backend-scoped limit, not a flaky-test waiver, an
all-hardware pass or an established SDK defect. No SDK cause was established.
Firefox's Mesa renderer and WebKit's privacy-masked GPU label likewise do not
prove physical hardware coverage.

## What the evidence establishes

Coverage includes actual rendered/nonblank pixels, animation and paused redraw,
reduced motion, keyboard controls, fallback states, browser errors, HDR success
and network/CORS/invalid-payload faults, and teardown/remount. Native lifecycle
coverage includes route exit, context/resource teardown, resize/visibility,
request isolation, Source/View mirroring and HMR through the owned support host.
The support `/ssr` route is a workspace public-import probe; installed compiled
SSR evidence belongs to the separate F26 runtime report. HMR coverage is not a
production deployment claim. HDR assets are not bundled into core: self-host the
actual files described in the [native guide](../../packages/shadergradient-svelte/README.md).
Errors/fallbacks must remain distinguishable from rendered readiness.

Legacy checks retain their Vue lifecycle-warning and Nuxt SSR scope. Nuxt-only,
Kit-only, development-only and protocol-specific cases record applicability,
not successful execution of an irrelevant path. Read case status, attachment
reason, engine probes, runtime report and planned/executed/unexecuted counts
together: an applicable case that never ran is not a pass. No required native
path is waived by a suite-level WebGL capability skip.

The current pre-final local image-equivalent qualification recorded 34 projects,
1,808 rows: **1,684 passes**, **124 adjudicated applicability skips**, zero
unexpected/flaky/unexecuted rows. The skip review distinguished 41 inherited
legacy cases, 75 consumer-inapplicable cases and eight protocol-limited cases;
it waived no required paths. These observations are not a fresh final release
matrix, actual hosted GitHub Actions execution, hosted Framer/Figma editor
coverage or real-device proof. The full unchanged final candidate must still run
unfiltered; do not replace it with a selected success.

## Reports, bounds and retention

The controller writes `e2e-results/<id>/report.json` with preparation identity,
package hashes, runtime report location, backend probes, selected plan, wave
status, cleanup and retained-evidence verification. Process logs are capped at
**16 MiB each**; active browser output is bounded at **3 GiB**. The whole owned
CI tree has a **12 GiB** operational cap; that is not an invitation to prune
shared stores, browser caches, active runs or unique proof.

Canonical per-wave ZIPs remain in `e2e-results/<id>/blobs/`. Final official merged
reports are `test-results/results.json` and `playwright-report/` (HTML). Failure
screenshots/traces and other attachments retain their actual bytes and referenced
paths. Successful-wave raw duplication may retire only after official merge and
SHA-256/attachment verification; canonical ZIP/HTML/JSON evidence is retained
losslessly, not replaced by a summary. Cancellation or failure preserves available
evidence and records missing/unexecuted waves rather than synthesizing results.

Native JSON reports, logs, PNGs and compiled Kit HTTP SSR HTML documents are
retained before disposable consumer roots are removed. Runtime evidence keeps its
relative layout under `e2e-results/<id>/native-runtime/`; raw reports retain their
original observation paths. If evidence preservation fails, the command fails
and keeps the original owned artifact namespace. `report.retainedArtifacts`
records its location and suggested expiry; successful process cleanup still
releases the integration lease. Investigate retained originals before retiring
them rather than treating an incomplete copy as permission to delete evidence.

Local report retention is bounded to three verified owned runs and 14 days.
Startup refuses excess or expired inactive evidence instead of deleting it:
verify a lossless archive before explicitly retiring owned originals. Active or
unknown owners, historical evidence and shared caches are never automatically
pruned.

The [configured workflow](../../.github/workflows/playwright.yml) targets Ubuntu 24.04,
Node 24, all three browser engines, and the single Xvfb-wrapped `test:e2e`
command. Its `always()` upload includes `test-results/`, `playwright-report/`
and `e2e-results/` for **14 days**. It does not publish or deploy packages.
This describes repository configuration and local image-equivalent evidence,
not an assertion that hosted GitHub Actions has run successfully.
