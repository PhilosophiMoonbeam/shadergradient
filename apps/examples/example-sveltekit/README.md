# Independent SvelteKit starter

A normal SSR SvelteKit **3.1.0** application consuming the real native
`ShaderGradientCanvas` and `ShaderGradient` public exports. The starter is private.
The new core/native **0.1.0 packages are not assumed to be published**: their
manifest entries deliberately name local packed artifacts, not registry releases.
No Kit APIs are required by the native library.

## Requirements and package boundary

- Node **>=22.17.0** and pnpm **10.12.4**.
- Svelte **5.57.3**, Threlte **8.6.1**, Three **0.186.1**.
- Vite **8.2.1**, vite-plugin-svelte **7.3.0**, TypeScript **6.0.3**,
  adapter-node **6.0.0**, and the other exact starter-local development dependencies
  in `package.json`. No root-hoisted toolchain is needed.
- Both `shadergradient-core-0.1.0.tgz` and
  `shadergradient-svelte-0.1.0.tgz` must be beside `package.json` when installing.

The local `pnpm-workspace.yaml` establishes an independent one-package workspace,
permits the `esbuild` install script, and overrides **every** transitive
`@shadergradient/core` reference with the local core tarball. This matters because
packing native translates its `workspace:^` dependency to a normal version range;
without the override pnpm could try an unpublished registry version. The tarballs
are copied package contents, never workspace links or checkout aliases.
`.npmrc` enforces the Node engine and peer compatibility.

## Pack, copy, and independently install

These commands are for the repository integration owner or a developer with an
already installed ShaderGradient source checkout. Building and packing the
packages is an upstream artifact-production step, not a runtime dependency of the
copied application. Do not run a publishing/release command.

From the repository root, in a POSIX shell:

```sh
# Use the installed repository toolchain to produce current real package output.
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte build

REPO="$PWD"
ARTIFACTS="$(mktemp -d /var/tmp/shadergradient-kit-artifacts.XXXXXX)"
STARTER="$(mktemp -d /var/tmp/shadergradient-kit-starter.XXXXXX)"
EXAMPLE="$REPO/apps/examples/example-sveltekit"

pnpm --dir "$REPO/packages/shadergradient-core" pack --pack-destination "$ARTIFACTS"
pnpm --dir "$REPO/packages/shadergradient-svelte" pack --pack-destination "$ARTIFACTS"

# Copy source/config explicitly: do not copy a checkout's node_modules or $app.
cp -R "$EXAMPLE/package.json" "$EXAMPLE/pnpm-workspace.yaml" \
  "$EXAMPLE/.npmrc" "$EXAMPLE/.gitignore" "$EXAMPLE/vite.config.js" \
  "$EXAMPLE/tsconfig.json" "$EXAMPLE/src" "$EXAMPLE/README.md" "$STARTER/"
cp "$ARTIFACTS/shadergradient-core-0.1.0.tgz" \
  "$ARTIFACTS/shadergradient-svelte-0.1.0.tgz" "$STARTER/"
if [ -f "$EXAMPLE/pnpm-lock.yaml" ]; then
  cp "$EXAMPLE/pnpm-lock.yaml" "$STARTER/"
fi

cd "$STARTER"
# Required for new/repacked artifacts: record their actual integrity and graph.
# No hand-authored lockfile and no invented tarball checksums.
pnpm install --lockfile-only --no-frozen-lockfile
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm preview --host 127.0.0.1 --port 3113
```

Keep the generated `pnpm-lock.yaml` with this exact artifact pair for repeatable
installs; the integration owner also generates the starter-local checked-in lock.
If distributing an unchanged already-qualified lock plus its identical tarballs,
use `pnpm install --frozen-lockfile` directly. Repacking either tarball requires
regenerating the lock from those actual bytes before the next frozen install.
Tarballs, installed dependencies, generated `$app` types, caches and build output
are not source files and must not be committed.

Choose `/var/tmp` (not another directory under the checkout or a home directory
that inherits a shared `node_modules`) for the independent qualification copy.
Do not set `NODE_PATH`, add private aliases, enable root hoisting, or replace the
file dependencies with workspace links. Once copied and installed, this starter
needs no checkout files. Remove the temporary copy/artifacts when finished.

## Development and production

```sh
pnpm dev       # http://127.0.0.1:3113
pnpm check     # Kit sync, then strict svelte-check
pnpm build     # client + SSR build and adapter-node output
pnpm preview   # preview the production build, not a deployment server

# Production adapter-node server after pnpm build:
HOST=127.0.0.1 PORT=3113 pnpm start
```

`start` runs `node build`; keep `build/`, `package.json` and the installed production
dependencies together. Adapter-node does not automatically read `.env` in
production. Configure your production host/reverse proxy according to the
[adapter-node documentation](https://svelte.dev/docs/kit/adapter-node).

Kit 3 configuration is inline in `vite.config.js` via
`sveltekit({ adapter: adapter() })`, with the Threlte SSR compilation setting.
There is deliberately no legacy `svelte.config.js`. `tsconfig.json` extends
`$app/tsconfig`; `svelte-kit sync` generates this app's own `node_modules/$app`.
Never copy generated types or a `.svelte-kit` directory from another app.

## What the example does

- The server renders useful headings, request settings, links, controls and a
  dimensioned static color fallback. Normal SSR remains enabled; no server canvas
  or browser scene is needed. The native Canvas supplies its client mount boundary.
- The live wrapper has explicit nonzero dimensions (420px high, bounded for the
  viewport, minimum 260px), a labelled artwork role and an SSR-stable fallback
  snippet covering deferred/loading/unsupported/error states.
- The labelled preset selector uses all ten public presets. Canvas-specific FOV
  and DPR are applied to Canvas; the preset's visual/time fields go to Gradient
  (legacy tool metadata is ignored by the native settings resolver).
- The keyboard-accessible pause button changes `animate` without remounting the
  scene. Canvas keeps its default reduced-motion support; enabled animation is
  not a promise to override the user's OS preference.
- Typed `onError` callbacks surface actual native failures in an alert, retaining
  readable content and the static fallback when rendering cannot proceed. An
  explicit recreate button gives the failed scene a fresh Canvas lifetime.
  Environment errors can retain ambient-lit output and are not labelled success.
  The alert preserves the last reported error across preset edits: a different
  preset can reuse the same failed HDR parameters without retrying. Only explicit
  recreation clears that historical report and begins a fresh scene attempt.
- `/away` has no scene. Ordinary Kit links exercise route teardown and a fresh
  Canvas on return. Pause/preset interaction state is component-local, not persisted.

The default Halo uses ambient lighting, so its initial scene needs no HDR fetch.
Presets that select environment lighting use the native remote HDR manifest only
in the browser. A production self-host can pass `envBasePath` to Canvas; HDR files
are not duplicated into this starter.

## Request isolation and qualification scenarios

Open or request these **concurrently**:

- `http://127.0.0.1:3113/?preset=halo&request=alpha`
- `http://127.0.0.1:3113/?preset=mint&request=beta`

`+page.server.ts` reads each request's URL and returns that request's preset,
title and label. It does not mutate the imported preset data, a module store,
server-global settings or a handle registry. Both SSR text and `data-request-label`
/ `data-request-preset` attributes distinguish the responses. The component uses
its own reactive selection and pause state. Unknown presets use Halo; request
labels are trimmed to 80 characters and rendered as escaped text.

The integration gate should use the **production adapter-node server** in the
copied-out directory to inspect both responses before JavaScript (useful fallback,
zero `<canvas>`, no SSR HDR fetch), then hydrate and inspect real WebGL pixels,
absence of hydration/page errors, keyboard preset/pause controls, and
away/back context teardown/remount. It should inspect installed package resolution
to establish there are no checkout paths. Source/View export qualification belongs
to the final package-consumer gate, not to a substitute implementation here.
These are acceptance procedures, not claims that this source has already passed
them.

References: [SSR state isolation](https://svelte.dev/docs/kit/state-management),
[generated Kit types](https://svelte.dev/docs/kit/types),
[native Svelte packaging](https://svelte.dev/docs/kit/packaging).
