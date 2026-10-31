# Core contributor and build notes

## Boundary and build

`@shadergradient/core` version `0.1.0` is the framework-neutral public asset
package specified by [the frozen core contract](../../docs/SVELTE-CORE-CONTRACT.md).
Its only public entry is `src/index.ts`; `package.json` resolves that entry to
built `dist/index.js` and `dist/index.d.ts`. No raw-source subpaths, alternate
shader lookup, material factory, runtime dependency, or peer dependency is
exported. The private base shader assembly is not a fifth public family.

From the workspace root, the integrator runs:

```sh
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/core typecheck
pnpm --filter @shadergradient/core pack --pack-destination <absolute-temporary-artifact-directory>
```

Build core before standalone adapter releases: the Framer bundle resolves and
bundles these public compiled exports, not core source. Turbo orders dependency
builds only when invoked through Turbo; the Pages deployment workflow explicitly
builds core before its standalone Framer and UI release steps. A local Framer
build can use `pnpm --filter @shadergradient/react build:framer --out-dir
<absolute-temporary-output-directory>` to leave the normal React distribution
untouched. A successful build is not proof of behavior inside the Framer editor.

The package-scoped build tools follow the existing adapter convention:
`tsup ^8.2.4` (major 8), `typescript 5.7.3`, `tsup.config.ts`, and an ESM-only
build with declarations. The explicit ES2021 target supports the unchanged
`String.replaceAll` adaptation implementation. The neutral TypeScript library
is ES2021 only, with no DOM or ambient framework/Three types. The tsup text
loader embeds `.glsl` bytes as ordinary JS strings during bundling; consumers
need no GLSL loader or framework compiler. Build API reference:
https://github.com/egoist/tsup/blob/v8.5.1/docs/README.md#custom-loader
(Context7 `/egoist/tsup/v8.5.1` loader documentation consulted during extraction).

Shader assembly uses named leaf imports and module-level plain descriptor
objects, not module namespace imports or `export * as` geometry barrels.
This lets consumer bundlers remove the unused `shaders` map and its GLSL
payload when importing only data such as `presets` and `presetsArray`.
The public lookup remains `shaders[shader][geometry].vertex` / `.fragment`
for all four families and three geometries; GLSL leaf strings are unchanged.
Do not replace these objects with eager namespace helper initialization or
add purity annotations to hide initialization effects. Integration must prove
removal against actual emitted consumer assets and compare all twelve public
shader pairs with the preserved pre-repair package; source inspection or a
bundle-size threshold alone is not acceptance evidence.

`files` includes the built distribution, package-local MIT license, full
third-party notices and these build/provenance notes. The root repository
license was not created or changed. Attribution sources are recorded in
`THIRD-PARTY-NOTICES`; third-party notices remain applicable to their code.

Integration has exercised the build/typecheck and an independently installed
packed public ESM import in plain Node, with no resolvable Three/framework
packages and browser/fetch access guarded against use. All twelve shader
pairs, ten full presets and the Halftone descriptor matched the preserved
pre-extraction runtime values. These are core-boundary checks, not native
Svelte acceptance or a claim that existing adapter failures were fixed.
Beads issue `shadergradient-a0q.4` records the artifact and regression evidence.

## Canonical source-to-destination provenance

All paths below are repository-relative. The 44 shader files were moved with
file-move operations, not rewritten or left behind as compatibility shims:
26 GLSL files (24 public-family leaves plus two private base strings), and
18 TS assembly modules. The geometry modules retain their original named
string exports. The private family and root assemblies now use named imports
and plain descriptor objects, preserving the contract's single typed `shaders`
lookup without retaining alternate namespace exports.
Original shader comments, includes, whitespace, complete source strings and
variant selection are preserved. There is no shader logic or Three chunk
adaptation change in these moves or the descriptor-assembly repair.

| Original source                                                                                  | Canonical destination                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `packages/shadergradient/src/shaders/index.ts`                                                   | `packages/shadergradient-core/src/shaders/index.ts`                             |
| `packages/shadergradient/src/shaders/base/index.ts`                                              | `packages/shadergradient-core/src/shaders/base/index.ts`                        |
| `packages/shadergradient/src/shaders/base/vertex.glsl`                                           | `packages/shadergradient-core/src/shaders/base/vertex.glsl`                     |
| `packages/shadergradient/src/shaders/base/fragment.glsl`                                         | `packages/shadergradient-core/src/shaders/base/fragment.glsl`                   |
| `packages/shadergradient/src/shaders/defaults/index.ts`                                          | `packages/shadergradient-core/src/shaders/defaults/index.ts`                    |
| `packages/shadergradient/src/shaders/defaults/plane/index.ts`                                    | `packages/shadergradient-core/src/shaders/defaults/plane/index.ts`              |
| `packages/shadergradient/src/shaders/defaults/plane/vertex.glsl`                                 | `packages/shadergradient-core/src/shaders/defaults/plane/vertex.glsl`           |
| `packages/shadergradient/src/shaders/defaults/plane/fragment.glsl`                               | `packages/shadergradient-core/src/shaders/defaults/plane/fragment.glsl`         |
| `packages/shadergradient/src/shaders/defaults/sphere/index.ts`                                   | `packages/shadergradient-core/src/shaders/defaults/sphere/index.ts`             |
| `packages/shadergradient/src/shaders/defaults/sphere/vertex.glsl`                                | `packages/shadergradient-core/src/shaders/defaults/sphere/vertex.glsl`          |
| `packages/shadergradient/src/shaders/defaults/sphere/fragment.glsl`                              | `packages/shadergradient-core/src/shaders/defaults/sphere/fragment.glsl`        |
| `packages/shadergradient/src/shaders/defaults/waterPlane/index.ts`                               | `packages/shadergradient-core/src/shaders/defaults/waterPlane/index.ts`         |
| `packages/shadergradient/src/shaders/defaults/waterPlane/vertex.glsl`                            | `packages/shadergradient-core/src/shaders/defaults/waterPlane/vertex.glsl`      |
| `packages/shadergradient/src/shaders/defaults/waterPlane/fragment.glsl`                          | `packages/shadergradient-core/src/shaders/defaults/waterPlane/fragment.glsl`    |
| `packages/shadergradient/src/shaders/positionMix/index.ts`                                       | `packages/shadergradient-core/src/shaders/positionMix/index.ts`                 |
| `packages/shadergradient/src/shaders/positionMix/plane/index.ts`                                 | `packages/shadergradient-core/src/shaders/positionMix/plane/index.ts`           |
| `packages/shadergradient/src/shaders/positionMix/plane/vertex.glsl`                              | `packages/shadergradient-core/src/shaders/positionMix/plane/vertex.glsl`        |
| `packages/shadergradient/src/shaders/positionMix/plane/fragment.glsl`                            | `packages/shadergradient-core/src/shaders/positionMix/plane/fragment.glsl`      |
| `packages/shadergradient/src/shaders/positionMix/sphere/index.ts`                                | `packages/shadergradient-core/src/shaders/positionMix/sphere/index.ts`          |
| `packages/shadergradient/src/shaders/positionMix/sphere/vertex.glsl`                             | `packages/shadergradient-core/src/shaders/positionMix/sphere/vertex.glsl`       |
| `packages/shadergradient/src/shaders/positionMix/sphere/fragment.glsl`                           | `packages/shadergradient-core/src/shaders/positionMix/sphere/fragment.glsl`     |
| `packages/shadergradient/src/shaders/positionMix/waterPlane/index.ts`                            | `packages/shadergradient-core/src/shaders/positionMix/waterPlane/index.ts`      |
| `packages/shadergradient/src/shaders/positionMix/waterPlane/vertex.glsl`                         | `packages/shadergradient-core/src/shaders/positionMix/waterPlane/vertex.glsl`   |
| `packages/shadergradient/src/shaders/positionMix/waterPlane/fragment.glsl`                       | `packages/shadergradient-core/src/shaders/positionMix/waterPlane/fragment.glsl` |
| `packages/shadergradient/src/shaders/cosmic/index.ts`                                            | `packages/shadergradient-core/src/shaders/cosmic/index.ts`                      |
| `packages/shadergradient/src/shaders/cosmic/plane/index.ts`                                      | `packages/shadergradient-core/src/shaders/cosmic/plane/index.ts`                |
| `packages/shadergradient/src/shaders/cosmic/plane/vertex.glsl`                                   | `packages/shadergradient-core/src/shaders/cosmic/plane/vertex.glsl`             |
| `packages/shadergradient/src/shaders/cosmic/plane/fragment.glsl`                                 | `packages/shadergradient-core/src/shaders/cosmic/plane/fragment.glsl`           |
| `packages/shadergradient/src/shaders/cosmic/sphere/index.ts`                                     | `packages/shadergradient-core/src/shaders/cosmic/sphere/index.ts`               |
| `packages/shadergradient/src/shaders/cosmic/sphere/vertex.glsl`                                  | `packages/shadergradient-core/src/shaders/cosmic/sphere/vertex.glsl`            |
| `packages/shadergradient/src/shaders/cosmic/sphere/fragment.glsl`                                | `packages/shadergradient-core/src/shaders/cosmic/sphere/fragment.glsl`          |
| `packages/shadergradient/src/shaders/cosmic/waterPlane/index.ts`                                 | `packages/shadergradient-core/src/shaders/cosmic/waterPlane/index.ts`           |
| `packages/shadergradient/src/shaders/cosmic/waterPlane/vertex.glsl`                              | `packages/shadergradient-core/src/shaders/cosmic/waterPlane/vertex.glsl`        |
| `packages/shadergradient/src/shaders/cosmic/waterPlane/fragment.glsl`                            | `packages/shadergradient-core/src/shaders/cosmic/waterPlane/fragment.glsl`      |
| `packages/shadergradient/src/shaders/glass/index.ts`                                             | `packages/shadergradient-core/src/shaders/glass/index.ts`                       |
| `packages/shadergradient/src/shaders/glass/plane/index.ts`                                       | `packages/shadergradient-core/src/shaders/glass/plane/index.ts`                 |
| `packages/shadergradient/src/shaders/glass/plane/vertex.glsl`                                    | `packages/shadergradient-core/src/shaders/glass/plane/vertex.glsl`              |
| `packages/shadergradient/src/shaders/glass/plane/fragment.glsl`                                  | `packages/shadergradient-core/src/shaders/glass/plane/fragment.glsl`            |
| `packages/shadergradient/src/shaders/glass/sphere/index.ts`                                      | `packages/shadergradient-core/src/shaders/glass/sphere/index.ts`                |
| `packages/shadergradient/src/shaders/glass/sphere/vertex.glsl`                                   | `packages/shadergradient-core/src/shaders/glass/sphere/vertex.glsl`             |
| `packages/shadergradient/src/shaders/glass/sphere/fragment.glsl`                                 | `packages/shadergradient-core/src/shaders/glass/sphere/fragment.glsl`           |
| `packages/shadergradient/src/shaders/glass/waterPlane/index.ts`                                  | `packages/shadergradient-core/src/shaders/glass/waterPlane/index.ts`            |
| `packages/shadergradient/src/shaders/glass/waterPlane/vertex.glsl`                               | `packages/shadergradient-core/src/shaders/glass/waterPlane/vertex.glsl`         |
| `packages/shadergradient/src/shaders/glass/waterPlane/fragment.glsl`                             | `packages/shadergradient-core/src/shaders/glass/waterPlane/fragment.glsl`       |
| `packages/shadergradient/src/presets.ts`                                                         | `packages/shadergradient-core/src/presets.ts`                                   |
| `packages/shadergradient/src/ShaderGradient/PostProcessing/lib/pp/HalftoneShader.js`             | `packages/shadergradient-core/src/HalftoneShader.ts`                            |
| Shared camera/HDR fields from `packages/shadergradient/src/consts.ts`                            | `packages/shadergradient-core/src/constants.ts`                                 |
| `compatibleShader` in `packages/shadergradient-vue/src/material.ts` (pre-extraction lines 61–72) | `packages/shadergradient-core/src/compatibleShader.ts`                          |

The presets move changes only the structural type imports/annotations. It
retains every title, color, key, numeric value, optional tool field, case and
insertion order: halo, pensive, mint, interstella, nightyNight,
violaOrientalis, universe, sunset, mandarin, cottonCandy. `presets` remains a
mutable `PresetCollection`, `presetsArray` is the mutable `GradientPreset[]`
produced by `Object.values(presets)`, and `initialActivePreset` remains zero.
There is no `as const`, freeze, data projection, or runtime cloning of presets.
Structural enums and optional metadata match the frozen contract; React's
existing public local prop/type names and Vue's public preset cast stay in
their adapters. Parent integration owns compile-time assignability acceptance.

The Halftone move changes only file extension and its structural type
import/annotation; the original descriptor, all uniform defaults, shader
strings and comments stay intact. `tDiffuse` is structurally `unknown` and
defaults to null, not a Three texture dependency. Passes retain ownership of
cloned uniforms. The luminance helper, replacement strings and four-include
regular expression in `compatibleShader` are unchanged from Vue; React does
not begin calling this adapter function.

Camera defaults remain 1/14; zoom-out objects remain `{zoom:1,distance:14}`
and `{zoom:5,distance:14}`. The unchanged HDR base URL is
`https://ruucm.github.io/shadergradient/ui@0.0.0/assets/hdr/`. The neutral
manifest preserves city/dawn/lobby filenames, previously selected in the
React environment loader and Vue environment path logic. The sibling
migration owner removes the shared definitions from the old `consts.ts`;
React's Canvas/Figma/Framer/UI constants remain local.

**Intentionally not moved:**
`packages/shadergradient/src/shaders/shaderMaterial.ts` stays React-local,
unchanged, and is not exposed by core. Material factories, global shader
chunk handling, renderer/composer behavior, clocks and queries remain in
their existing adapters. The unrelated vendored postprocessing CopyShader
is not part of this asset move.

## Reference evidence and caller map

The parent attempted language-server status and representative preset
references and reported no configured/found language server. No LSP
reference coverage is claimed. Worker `trail callers presets . --no-refresh
--json` and `trail callers HalftoneShader . --no-refresh --json` both returned
`no symbol ... in the graph`; the sibling also attempted `presets` and
`compatibleShader` references and received no symbol, including after a
trail auto-refresh. These are limitations of the available reference graph,
not evidence that there are no callers.

Fallback evidence is exhaustive module/import/asset/literal search (with
all paginated matches consumed), canonical shader-assembly imports, and the
migration owner's concrete caller inventory. Searches covered React/Vue/UI
sources plus repository module/GLSL/dynamic-import literals, excluding
ignored build/install/cache artifacts. Canonical `.glsl` imports are the two
static imports in each leaf/base module; `#pragma ... require(glsl-noise/...)`
occurrences are original comments, not runtime imports. No dynamic shader
or GLSL import was found in the owned runtime sources. Unrelated skill
examples referring to their own `./presets` are not ShaderGradient callers.

For the F31 descriptor-assembly repair, the reported lack of a configured
language server still limits reference evidence; no LSP coverage is claimed.
An exact repository TS/JS/Svelte import-path and dynamic shader/GLSL import
search found the four family barrels referenced only by the root shader
assembly, and their geometry barrels referenced only by those families.
Example-page shader paths are explanatory text, not imports. React Mesh,
Vue material and native Svelte material consume the public `shaders` lookup,
so no adapter callsite changes are needed. Geometry `vertex` / `fragment`
exports remain used by the named family imports; obsolete private geometry
namespace reexports are removed rather than kept as aliases.

All migrated callers below use the public `@shadergradient/core` entry.
The adapter migration owner supplied this map, also corroborated by static
core-import searches during extraction:

| Consumer                                                               | Old source / shared symbols                    | New public integration                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| React `src/index.ts`                                                   | local presets module                           | real root reexports of `presets`, `presetsArray`, `initialActivePreset`        |
| React `src/ShaderGradient/ShaderGradient.tsx`                          | `../presets`                                   | `presets`                                                                      |
| React `src/ShaderGradient/Controls/useCameraAnimation.ts`              | `@/consts` shared camera fields                | `zoomOutPlanes`, `zoomOutSphere`, `defaultPlanesZoom`, `defaultSphereDistance` |
| React `src/ShaderGradient/Lights/Environment/EnvironmentMap.tsx`       | `@/consts` shared HDR field                    | `defaultEnvBasePath`                                                           |
| React `src/ShaderGradient/Mesh/Mesh.tsx`                               | namespace `@/shaders`                          | `shaders`, unchanged `shaders[shader][type]` lookup                            |
| React `src/ShaderGradient/PostProcessing/lib/pp/HalftonePass.ts`       | local `./HalftoneShader`                       | `HalftoneShader`                                                               |
| Vue `src/material.ts`                                                  | React-private shader path and local adaptation | `shaders`, `compatibleShader`; local adaptation definition removed             |
| Vue `src/ShaderGradient.ts`                                            | React-private Halftone/consts paths            | `HalftoneShader`, `defaultEnvBasePath`                                         |
| Vue `src/ShaderGradientCanvas.ts`                                      | React-private consts path                      | `defaultEnvBasePath`                                                           |
| Vue `src/props.ts`                                                     | React-private presets path                     | `presets`                                                                      |
| Vue `src/presets.ts`                                                   | React-private presets path                     | `presets as sharedPresets`; existing public Vue cast retained                  |
| UI `src/components/Shared/ShaderGradientStateless/store/presetURLs.ts` | React root presets                             | `presets`                                                                      |
| UI `src/components/Shared/ShaderGradientStateless/store/store.ts`      | duplicate local initial index                  | `initialActivePreset`; adapter-local `DEFAUlT_PRESET` retained                 |

The sibling owns package-local adapter dependency/build/type/cache changes,
removes obsolete React-private Vue aliases, and retains existing peer floors.
The parent exclusively owns root manifest/lock/shared preparation integration.
Static search also identified an obsolete removed-tree shader comment in
React `Lights.tsx`, handed to the sibling for removal of the stale path.

### Consumer preparation

The compatibility fixture builder now imports built public
`@shadergradient/core`; its old React shader/preset paths and private alias
were removed. Renewed lower/current Svelte and current SvelteKit cells
exercised all twelve shader pairs, SSR, hydration and remount. This is a
compatibility fixture, not certification of the final native package.

`tests/browser/prepare.mjs` builds core before Vue, packs both actual workspace
packages, and stages the core tarball as `shadergradient-core.tgz` in each
existing standalone Vue/Nuxt consumer. Their workspace-file override resolves
Vue's core dependency to that local artifact. Freshness checks compare both
installed public JS/declarations to the builds; core is a transitive Vue
dependency, not assumed to be hoisted at the consumer root.

Run `pnpm test:e2e` for this existing-consumer gate: that command already owns
preparation, so do not prepend a second preparation phase. Historical baseline
evidence and frozen harness hashes/scenarios are provenance and are not
rewritten to accommodate extraction failures.
