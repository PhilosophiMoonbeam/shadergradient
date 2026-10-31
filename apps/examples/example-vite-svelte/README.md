# ShaderGradient Svelte + Vite starter

An independent plain Svelte 5 app named `example-vite-svelte`. It consumes the
public native `ShaderGradientCanvas` and `ShaderGradient` exports, not workspace
source. This starter does not need SvelteKit, React, repository aliases, a root
configuration, hoisted dependencies, or files outside this directory at runtime.

**The core and native Svelte packages used here are unpublished.** The declared
`0.1.0` versions are the versions of the actual locally packed artifacts, not a
claim that either version is available from npm. Both tarballs are required.

## Toolchain

Use Node **22.17.0 or newer** and **pnpm 10.12.4** (also pinned in
`packageManager`). The app pins Svelte `5.57.3`, Threlte `8.6.1`, Three `0.186.1`,
Vite `8.2.1`, vite-plugin-svelte `7.3.0`, TypeScript `6.0.3`, svelte-check `4.7.7`,
Three declarations `0.186.0`, and Node declarations `24.10.1` locally.

## 1. Build and pack the real packages

Before publication, a maintainer with this repository must prepare the artifacts.
Run from the **repository root**, using its installed build dependencies:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte build
pnpm --dir packages/shadergradient-core pack --pack-destination "$PWD/apps/examples/example-vite-svelte"
pnpm --dir packages/shadergradient-svelte pack --pack-destination "$PWD/apps/examples/example-vite-svelte"
```

The output filenames must be exactly:

```text
shadergradient-core-0.1.0.tgz
shadergradient-svelte-0.1.0.tgz
```

The starter declares both as `file:./…` dependencies. Its own
`pnpm-workspace.yaml` also overrides **every** `@shadergradient/core` resolution
to the local core tarball. This includes the native package's public transitive
core dependency after `pnpm pack` converts its workspace range. Merely adding a
direct core dependency without that override would still allow a registry lookup
for an unavailable core release.

Do not create empty tarballs, substitute repository source paths, or replace the
file dependencies with unpublished npm versions.

## 2. Generate or refresh the starter-local lock

After preparing those exact artifacts, a maintainer generates the real lockfile
from this starter's own manifest and local workspace policy:

```sh
pnpm --dir apps/examples/example-vite-svelte install --lockfile-only --no-frozen-lockfile
```

Keep the resulting **starter-local `pnpm-lock.yaml`** with the source. Never copy
the monorepo lockfile or hand-author tarball integrity fields. Refresh this lock
when repacking a changed package, even if its version and filename stay the same;
the integrity must describe the new bytes. The tarballs themselves, `node_modules`,
Vite caches and generated `dist` are ignored and must not be committed.

## 3. Copy and install outside the checkout

From the repository root, copy only the starter source/configuration, local lock,
and the two real tarballs into a new independent directory:

```sh
starter="$PWD/apps/examples/example-vite-svelte"
standalone="$(mktemp -d /var/tmp/shadergradient-vite-svelte.XXXXXX)"
cp "$starter/package.json" "$starter/pnpm-workspace.yaml" "$starter/pnpm-lock.yaml" "$standalone/"
cp "$starter/index.html" "$starter/tsconfig.json" "$starter/vite.config.ts" "$starter/svelte.config.js" "$standalone/"
cp "$starter/README.md" "$starter/.gitignore" "$standalone/"
cp "$starter/shadergradient-core-0.1.0.tgz" "$starter/shadergradient-svelte-0.1.0.tgz" "$standalone/"
cp -R "$starter/src" "$standalone/src"
cd "$standalone"
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm preview --host 127.0.0.1 --port 3112
```

Open <http://127.0.0.1:3112>. The preview command serves the actual production
build. For development, stop preview and run `pnpm dev` (default port `3012`).
Ordinary framework/toolchain dependencies still come from their public registry;
only the two unpublished ShaderGradient packages come from local tarballs.

Keep `pnpm-workspace.yaml` when copying. It is the local workspace/approval
boundary, disables workspace linking and root peer resolution, and approves only
`esbuild` dependency build scripts. Do not use `--ignore-workspace`, copy a parent
`node_modules`, enable all dependency scripts, or rely on root build approvals.

These commands are the installation and qualification procedure, not an assertion
that a new artifact has already passed it. Browser/WebGL rendering must be checked
separately from typechecking and bundling. For a portability proof, run in the
copied directory with the repository unavailable and inspect module resolution;
there must be no links or imports back into the checkout.

## The example

- The preview has explicit width and a responsive **20–38rem height**. A package
  Canvas needs a nonzero parent size; it does not invent viewport dimensions.
- The labelled native select applies all ten public presets without replacing the
  Canvas. The pause/resume button sets `animate` to `off`/`on`; changing presets
  while paused still redraws. Pause does not remount or reset the scene.
- System reduced motion is respected. “Animation enabled” expresses the requested
  state, not a promise that a motion-reduced browser is advancing time.
- Presets retain their canonical lighting, including HDR environment selection.
  The initial Halo preset uses ambient `3d` lighting and needs no HDR download.
  Canvas FOV is passed separately from the preset metadata.
- Selecting an HDR preset uses the package's default remote assets. For self-hosted
  HDR, pass a public `envBasePath` to Canvas and provide the actual HDR files at the
  package's documented manifest paths; never use a path into this repository.
  HDR presets require network access or those self-hosted assets. Asset failures
  are reported by the native `onError` callback, not silently replaced with ambient
  lighting. No preset depends on checkout assets or external fonts.
- Fallback text distinguishes deferred, first-frame loading, unsupported WebGL and
  renderer errors. It is not a static gradient advertised as successful rendering.
  The last reported error is labelled as historical, not as current readiness.
- Public presets retain legacy export-tool metadata; those extra fields do not
  create native feature promises. No private native helpers or fixture API are
  imported. Source/View composition is not required by this Canvas/Gradient starter.

When an authorized release actually publishes core and the native adapter, replace
both local dependencies with real published versions, remove the local core
override, and regenerate this starter's lock. Publication is not performed by these
instructions.
