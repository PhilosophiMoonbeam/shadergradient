# Standalone Examples

These folders are consumer starters, not workspace development apps. The root
workspace globs deliberately exclude `apps/examples/*`. Each starter owns its
dependencies and configuration. The Vue/Nuxt starters have their own
`pnpm-workspace.yaml`: run `pnpm install` inside their folders so their local
build approvals are applied. The React starters,
which do not have a local workspace file, use `pnpm install --ignore-workspace`
while inside this repository.

| Starter                                                | Framework             | ShaderGradient dependency                             |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------- |
| [example-nextjs](./example-nextjs/README.md)           | Next.js / React       | Published React package                               |
| [example-vite-react](./example-vite-react/README.md)   | Vite / React          | Published React package                               |
| [example-vite-vue](./example-vite-vue/README.md)       | Vite / Vue            | Local release tarball until publication               |
| [example-nuxtjs](./example-nuxtjs/README.md)           | Nuxt / Vue            | Local release tarball until publication               |
| [example-vite-svelte](./example-vite-svelte/README.md) | Plain Svelte 5 / Vite | Local core + native Svelte tarballs until publication |
| [example-sveltekit](./example-sveltekit/README.md)     | SvelteKit 3.1 / SSR   | Local core + native Svelte tarballs until publication |

The Vue package is not on npm yet. The new starters document how to build and
pack it into each example directory. Generated tarballs and installed dependencies
are ignored by Git; the source and standalone lockfiles are tracked. A clean
checkout needs the documented pack step before installation. Copy the tarball too
when moving a starter outside the repository before publication.

Once the Vue package is published, replace the local tarball dependencies with an
actual published version and regenerate each starter's lockfile. These examples
must not depend on `workspace:*` packages or shared monorepo ESLint configuration.

For active library development, use the six workspace studios below. They
deliberately consume local public SDK builds. The independent starters above
consume packaged snapshots and need repacking and reinstallation after library
changes; this studio workflow does not change their dependencies or qualification.

## Linked workspace studios (not these starters)

From the repository root, use the supported Node/pnpm versions below and prepare
the public SDK outputs:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/react build
pnpm --filter @shadergradient/vue build
pnpm --filter @shadergradient/svelte build
```

Run each desired server in a separate terminal:

| Workspace studio | Root command | URL |
| --- | --- | --- |
| React Color Studio | `pnpm --filter example-react-dev dev --host 127.0.0.1 --port 3009 --strictPort` | `http://127.0.0.1:3009/` |
| Native Composition Studio | `pnpm --filter example-svelte-dev dev --port 3110 --strictPort` | `http://127.0.0.1:3110/` |
| SvelteKit Page & Light | `pnpm --filter example-sveltekit-dev dev --host 127.0.0.1 --port 3111 --strictPort` | `http://127.0.0.1:3111/` |
| Vue Palette Studio | `pnpm --filter example-vue-dev dev --host 127.0.0.1 --strictPort` | `http://127.0.0.1:3005/` |
| Nuxt Scene Journal | `pnpm --filter example-nuxtjs-dev dev --host 127.0.0.1` | `http://127.0.0.1:3006/` |
| Next Glass Studio | `pnpm --filter example-nextjs-dev dev --hostname 127.0.0.1` | `http://127.0.0.1:3004/` |

Next also serves Canvas Study at `/customize-simple` and Time Study at `/loop`.
The React workspace is the React 18.3.1 / Fiber 8.18.0 / Three 0.169.0 public
SDK lane, not the older standalone React 19/registry example. A workspace
build does not establish independent packed installation or npm availability.

See [the six-studio contributor workflow](../../CONTRIBUTING-SVELTE.md#six-workspace-studios)
for each app's build/check commands and observation checklist: all ten complete
Core presets and full settings, native completed-frame Source/View mirrors
versus independent Canvas/host ownership, meaningful Kit/Nuxt SSR fallback and
navigation, and Next's actual camera/resolution and shader-time studies.
Glass needs opaque Three scene content and real HDR/environment light, not a
CSS backdrop. Inspect reduced motion, paused edits, loading/error/context-loss
states, keyboard controls and mobile layouts rather than treating a canvas
element as proof of rendered output.

`apps/demo-studio.css` shares presentation only among workspace demos; it is not
an SDK export and is not required by these independent starters. App-only styling
needs no SDK Changeset; the prior SDK glass Changeset retains its own scope.
These reproduction instructions make no full release, F31, cross-engine or
performance qualification claim. Keep existing failure evidence and run the
single-preparation full browser gate described in the contributor guide.

## Native Svelte starters

The native adapter is additive: these starters use `@shadergradient/svelte`, not
a React bridge. For linked SDK development use `apps/example-svelte-dev` and
`apps/example-sveltekit-dev`; independent starters instead exercise packaged
snapshots. See the [native package guide](../../packages/shadergradient-svelte/README.md)
for Canvas/Gradient and Source/View ownership, and the
[Svelte contributor guide](../../CONTRIBUTING-SVELTE.md) for the full qualification
matrix and development workflow.

Use pnpm **10.12.4** and the repository-supported Node range
**^22.19.0 || ^24.11.0 || >=26.0.0** (qualification used Node **24.15.0**).
The current starters pin Svelte **5.57.3**, Threlte **8.6.1** and Three
**0.186.1**. Their local `pnpm-workspace.yaml` is intentional: preserve it,
and Kit's `.npmrc`, when copying. Run installation inside each starter; do not
use the React starters' `--ignore-workspace` procedure for native Svelte.

### Prepare the actual core/native pair

Both **0.1.0 packages are local and unpublished**. From an installed repository
checkout, build and pack both into an outside-workspace artifact directory:

```sh
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/svelte build
REPO="$PWD"
ARTIFACTS="$(mktemp -d /var/tmp/shadergradient-native-artifacts.XXXXXX)"
pnpm --dir "$REPO/packages/shadergradient-core" pack --pack-destination "$ARTIFACTS"
pnpm --dir "$REPO/packages/shadergradient-svelte" pack --pack-destination "$ARTIFACTS"
```

The real outputs are `shadergradient-core-0.1.0.tgz` and
`shadergradient-svelte-0.1.0.tgz`. Both starter manifests use these local files.
Their local workspace policy overrides **every** `@shadergradient/core`
resolution to `file:./shadergradient-core-0.1.0.tgz`, including native's packed
`^0.1.0` dependency. A direct core dependency alone does not prevent a registry
lookup. Do not substitute source aliases, workspace links, fake tarballs or an
unavailable npm release.

### Copy, install and build independently

Continue in the same shell. This copies only source/configuration and the real
pair; it does not copy `node_modules`, caches or generated output:

```sh
PLAIN="$(mktemp -d /var/tmp/shadergradient-plain.XXXXXX)"
KIT="$(mktemp -d /var/tmp/shadergradient-kit.XXXXXX)"
EXAMPLE="$REPO/apps/examples/example-vite-svelte"
cp -f "$EXAMPLE/package.json" "$EXAMPLE/pnpm-workspace.yaml" \
  "$EXAMPLE/index.html" "$EXAMPLE/tsconfig.json" "$EXAMPLE/vite.config.ts" \
  "$EXAMPLE/svelte.config.js" "$PLAIN/"
cp -Rf "$EXAMPLE/src" "$PLAIN/src"
EXAMPLE="$REPO/apps/examples/example-sveltekit"
cp -f "$EXAMPLE/package.json" "$EXAMPLE/pnpm-workspace.yaml" "$EXAMPLE/.npmrc" \
  "$EXAMPLE/vite.config.js" "$EXAMPLE/tsconfig.json" "$KIT/"
cp -Rf "$EXAMPLE/src" "$KIT/src"
cp -f "$ARTIFACTS/shadergradient-core-0.1.0.tgz" \
  "$ARTIFACTS/shadergradient-svelte-0.1.0.tgz" "$PLAIN/"
cp -f "$ARTIFACTS/shadergradient-core-0.1.0.tgz" \
  "$ARTIFACTS/shadergradient-svelte-0.1.0.tgz" "$KIT/"
pnpm --dir "$PLAIN" install --lockfile-only --no-frozen-lockfile
pnpm --dir "$PLAIN" install --frozen-lockfile
pnpm --dir "$PLAIN" check
pnpm --dir "$PLAIN" build
pnpm --dir "$KIT" install --lockfile-only --no-frozen-lockfile
pnpm --dir "$KIT" install --frozen-lockfile
pnpm --dir "$KIT" check
pnpm --dir "$KIT" build
```

Keep each generated local lock with its exact tarball pair. An unchanged copy
with an already-qualified local lock and identical tarballs can install directly
with `--frozen-lockfile`. After any package-content change (including its README),
repack both and use a fresh independent copy as above. With pnpm 10.12.4, replacing
a same-named local tarball and running non-frozen lock generation alone left the
previous package installed; “Already up to date” is not artifact-freshness proof.
If reusing an **owned disposable** copy, preserve its old lock/tarball evidence,
then remove only that copy's `node_modules` and local lock before regenerating
and installing the new pair. Never clear shared stores or another user's files.
Moving a starter before publication requires carrying both tarballs, not merely
its source and lockfile.

Run the production previews separately:

```sh
pnpm --dir "$PLAIN" preview --host 127.0.0.1 --port 3112
```

```sh
pnpm --dir "$KIT" preview --host 127.0.0.1 --port 3113
```

For actual Kit HTTP SSR, stop its preview and run the compiled adapter-node
server:

```sh
HOST=127.0.0.1 PORT=3113 pnpm --dir "$KIT" start
```

Inspect `http://127.0.0.1:3113/?preset=halo&request=alpha` and
`http://127.0.0.1:3113/?preset=mint&request=beta` before JavaScript: useful
request-specific content and fallback should render without a server canvas.
Then inspect hydration and actual WebGL pixels in the browser. A successful
bundle is not pixel or SSR qualification. The
[package-consumer gate](../../tests/svelte/package-consumers.mjs) separately
compiles installed plain-Svelte SSR and checks Kit HTTP SSR/request isolation;
raw Node importing core is not compiled native SSR. The
[browser guide](../../tests/browser/README.md) describes the owned runtime matrix.
Both apps need nonzero Canvas parent height; the checked-in starters provide it.

Only **after both packages actually publish**, replace both file dependencies
with real published versions, remove the local core override and regenerate the
starter-local locks. These instructions neither publish packages nor establish
npm availability.
