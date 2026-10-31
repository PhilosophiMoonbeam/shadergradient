# Shared pure core contract

Selected F01 handoff to F04, not a claim that a core package or migration has shipped. F04 owns `packages/shadergradient-core` and the required moved-symbol callers in React, Vue and UI; native runtime uses only the public inventory below. [SVELTE-NATIVE-CONTRACT.md](./SVELTE-NATIVE-CONTRACT.md) owns native rendering/settings/time/source semantics. Neither contract changes existing adapters' public behavior.

## Boundary and packaging

Public package is `@shadergradient/core`. It ships built ordinary JavaScript and declarations; canonical GLSL is bundled as JS strings. A consumer needs no GLSL loader, framework compiler, DOM/WebGL globals or Three installation to import it in Node ESM. No React/Vue/Svelte/DOM dependency, scheduler, observer, material/renderer factory, engine abstraction, asset request, global mutable source state, runtime Three dependency or new Three peer floor. Structural shader/uniform types avoid importing r186 types into React's existing `>=0.150.0` peer contract. Static preset/descriptor data is not a request-shared state store; adapters never mutate shared shader descriptors or presets as rendering state.

F04 may organize private build/source files conventionally, but the public entry is `packages/shadergradient-core/src/index.ts`, with exact named exports below. The canonical GLSL and Halftone effect move, rather than copy into a new divergent asset tree. No legacy private-path re-exports or shims remain. Existing React root exports of presets/presetsArray/initialActivePreset remain real public exports (from core if previously exported), not a requirement to keep removed source paths.

## Complete public inventory

| Kind     | Exact name and type/signature                                                                 | Canonical origin / consumers                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type     | `ShaderName = 'defaults' \| 'positionMix' \| 'cosmic' \| 'glass'`                             | Existing Vue shader union; native mesh and core lookup.                                                                                                                                                                                                      |
| Type     | `GradientType = 'plane' \| 'sphere' \| 'waterPlane'`                                          | Existing geometry union; all adapters.                                                                                                                                                                                                                       |
| Type     | `EnvironmentPreset = 'city' \| 'dawn' \| 'lobby'`                                             | HDR manifest and preset lighting values.                                                                                                                                                                                                                     |
| Type     | `LightType = '3d' \| 'env'`                                                                   | Neutral preset lighting values.                                                                                                                                                                                                                              |
| Type     | `Toggle = 'on' \| 'off'`                                                                      | Neutral animate/grain data.                                                                                                                                                                                                                                  |
| Type     | `PresetName` = ten-key union in the preset table below                                        | Preset map indexing; native mirrors the same structural union.                                                                                                                                                                                               |
| Type     | `ShaderSource { readonly vertex: string; readonly fragment: string }`                         | Each complete family/geometry shader pair.                                                                                                                                                                                                                   |
| Type     | `ShaderFamily = Readonly<Record<GradientType, ShaderSource>>`                                 | Three canonical geometry variants.                                                                                                                                                                                                                           |
| Type     | `ShaderCollection = Readonly<Record<ShaderName, ShaderFamily>>`                               | Four canonical families.                                                                                                                                                                                                                                     |
| Data     | `shaders: ShaderCollection`                                                                   | Canonical `src/shaders/index.ts` and family/geometry modules; React/Vue/native import `{ shaders }` rather than framework-private namespace imports. **One lookup API**: `shaders[shader][type]`. No getShader alias or per-family alternative root exports. |
| Function | `compatibleShader(source: string): string`                                                    | Moves existing Vue material-local adaptation unchanged; Vue/native material factories call it. React keeps its existing shader compilation/chunk behavior.                                                                                                   |
| Type     | `PresetProps`, `GradientPreset`, `PresetCollection` defined below                             | Structural, neutral data typing, not a renderer prop promise.                                                                                                                                                                                                |
| Data     | `presets: PresetCollection`                                                                   | All ten canonical presets from React `src/presets.ts`, preserving every value/key/tool metadata.                                                                                                                                                             |
| Data     | `presetsArray: GradientPreset[]`                                                              | Existing `Object.values(presets)` insertion order. Preserve array semantics, no reordered entries.                                                                                                                                                           |
| Data     | `initialActivePreset: number` (=0)                                                            | Existing preset selection index.                                                                                                                                                                                                                             |
| Data     | `defaultPlanesZoom: number` (=1)                                                              | React `consts.ts:41`.                                                                                                                                                                                                                                        |
| Data     | `defaultSphereDistance: number` (=14)                                                         | `consts.ts:42`.                                                                                                                                                                                                                                              |
| Data     | `zoomOutPlanes: { zoom: number; distance: number }` (1,14)                                    | `consts.ts:43`; camera consumers.                                                                                                                                                                                                                            |
| Data     | `zoomOutSphere: { zoom: number; distance: number }` (5,14)                                    | `consts.ts:44`; camera consumers.                                                                                                                                                                                                                            |
| Data     | `defaultEnvBasePath: string`                                                                  | Exact existing `https://ruucm.github.io/shadergradient/ui@0.0.0/assets/hdr/`; adapters remain self-hostable.                                                                                                                                                 |
| Type     | `EnvironmentManifest = Readonly<Record<EnvironmentPreset, string>>`                           | Neutral filenames, not loaded textures.                                                                                                                                                                                                                      |
| Data     | `environmentManifest: EnvironmentManifest`                                                    | Exactly `{ city:'city.hdr', dawn:'dawn.hdr', lobby:'lobby.hdr' }`; native selected loader uses this. No URL resolver/load/cache API.                                                                                                                         |
| Type     | `ShaderUniform<T> { value: T }`, `HalftoneUniforms`, `HalftoneShaderDefinition` defined below | No runtime/type-only Three requirement.                                                                                                                                                                                                                      |
| Data     | `HalftoneShader: HalftoneShaderDefinition`                                                    | Entire unchanged canonical `ShaderGradient/PostProcessing/lib/pp/HalftoneShader.js` descriptor and shader strings; all moved-symbol consumers use this export.                                                                                               |

These are intended _types_, not ambient declarations of nonexistent runtime values. F04 implements actual data/functions/build exports, then F05/F08/F10/F11/F12 import them. F13/F19 do not invent another asset API. Existing React-only public type names (`GradientT`, `MeshT`, `typeT`, `animateT`, `EnvironmentPresetT`, etc.) may stay local with unchanged signatures; internal callers can consume structural core types without renaming the React public surface.

### Complete structural preset definitions

```ts
export interface PresetProps {
  type: GradientType
  shader: ShaderName
  animate: Toggle
  uTime: number
  uSpeed: number
  uStrength: number
  uDensity: number
  uFrequency: number
  uAmplitude: number
  range: 'enabled' | 'disabled'
  rangeStart: number
  rangeEnd: number
  positionX: number
  positionY: number
  positionZ: number
  rotationX: number
  rotationY: number
  rotationZ: number
  color1: string
  color2: string
  color3: string
  reflection: number
  wireframe: boolean
  brightness: number
  cAzimuthAngle: number
  cPolarAngle: number
  cDistance: number
  cameraZoom: number
  lightType: LightType
  envPreset: EnvironmentPreset
  grain: Toggle
  pixelDensity: number
  fov: number
  // Retained legacy tool metadata, never native feature promises.
  frameRate: number
  destination: string
  format: string
  axesHelper: string
  embedMode: string
  gizmoHelper?: string
  bgColor1?: string
  bgColor2?: string
  // Preserve optional temporal data if supplied by a data consumer.
  loop?: Toggle
  loopDuration?: number
}
export interface GradientPreset {
  title: string
  color: string
  props: PresetProps
}
export type PresetCollection = Record<PresetName, GradientPreset>
```

Preserve original public data mutability/type assignability where existing callers require it; `readonly` lookup types do not imply adding `Object.freeze` side effects. Do not erase legacy keys to make native typing easier. Native settings normalizer projects only its declared keys and supplies native-only defaults; it is not a rewritten preset store. `gizmoHelper` is optional because not every existing preset declares it. There is no new renderer behavior associated with frameRate/destination/format/axesHelper/embedMode/gizmoHelper; moving their static preset values does not move Figma/Framer APIs.

### Halftone structural definitions

```ts
export interface ShaderUniform<T> {
  value: T
}
export interface HalftoneUniforms {
  tDiffuse: ShaderUniform<unknown>
  shape: ShaderUniform<number>
  radius: ShaderUniform<number>
  rotateR: ShaderUniform<number>
  rotateG: ShaderUniform<number>
  rotateB: ShaderUniform<number>
  scatter: ShaderUniform<number>
  width: ShaderUniform<number>
  height: ShaderUniform<number>
  blending: ShaderUniform<number>
  blendingMode: ShaderUniform<number>
  greyscale: ShaderUniform<boolean>
  disable: ShaderUniform<boolean>
}
export interface HalftoneShaderDefinition {
  uniforms: HalftoneUniforms
  vertexShader: string
  fragmentShader: string
}
```

`tDiffuse` defaults null and becomes an adapter-owned texture through its cloned pass uniforms; core never imports Texture. Defaults remain shape1/radius2, rotateR π/12, rotateG2π/12, rotateB3π/12, scatter1, width20/height20, blending1/blendingMode1, greyscalefalse/disablefalse. Core descriptor is not a material instance, and every pass clones its uniform state. No effect or shader rewrite, time-driven grain change, composer migration or React grainBlending behavior fix belongs in F04.

## Canonical shader and preset coverage

| Family      | plane                     | sphere                    | waterPlane                |
| ----------- | ------------------------- | ------------------------- | ------------------------- |
| defaults    | canonical vertex/fragment | canonical vertex/fragment | canonical vertex/fragment |
| positionMix | canonical vertex/fragment | canonical vertex/fragment | canonical vertex/fragment |
| cosmic      | canonical vertex/fragment | canonical vertex/fragment | canonical vertex/fragment |
| glass       | canonical vertex/fragment | canonical vertex/fragment | canonical vertex/fragment |

Every leaf keeps both original complete strings, including shared include content assembled by the current modules. F04 compiles GLSL to JS without changing shader text/variant selection. Auxiliary base/common GLSL remains private shared assembly, not a fifth public family. Native geometry topology is frozen in the native contract, not added as Three constructors to core. Twelve source declarations are not evidence of twelve successful renders.

| PresetName / preserved order | Canonical geometry | Shader   | Colors                      |
| ---------------------------- | ------------------ | -------- | --------------------------- |
| halo                         | plane              | defaults | #ff5005 / #dbba95 / #d0bce1 |
| pensive                      | sphere             | defaults | #809bd6 / #910aff / #af38ff |
| mint                         | waterPlane         | defaults | #94ffd1 / #6bf5ff / #ffffff |
| interstella                  | sphere             | defaults | #73bfc4 / #ff810a / #8da0ce |
| nightyNight                  | waterPlane         | defaults | #606080 / #8d7dca / #212121 |
| violaOrientalis              | sphere             | defaults | #ffffff / #ffbb00 / #0700ff |
| universe                     | waterPlane         | defaults | #5606ff / #fe8989 / #000000 |
| sunset                       | sphere             | defaults | #ff7a33 / #33a0ff / #ffc53d |
| mandarin                     | waterPlane         | defaults | #ff6a1a / #c73c00 / #FD4912 |
| cottonCandy                  | waterPlane         | defaults | #ebedff / #f3f2f8 / #dbf8ff |

The color table is an identity aid, not permission to extract only colors. Preserve full numeric/time/noise/camera/light/transform values and display titles exactly, including case. There is no claim that every preset uses all shader families. Shader feature coverage must explicitly choose other families rather than treating ten defaults-family presets as full coverage.

## Material-local adaptation and old-adapter preservation

`compatibleShader` moves the existing Vue function verbatim: if source contains `linearToRelativeLuminance(`, prepend the existing `shaderGradientLuminance` dot-product helper and replace those calls; strip exactly the legacy includes `uv2_pars_vertex`, `uv2_vertex`, `uv2_pars_fragment`, `encodings_fragment`. Do not mutate global Three.ShaderChunk, add revision checks, sanitize arbitrary GLSL or introduce new shader transformations. React retains its old compilation/global chunk shim; extraction changes its asset imports only. Vue/native material factories remain adapter-local and do not move into core.

Keep locally in React: `canvasProps` and `CanvasGlOverrides` (R3F-shaped Canvas configuration); `links`; aboutAngles/aboutPositions/aboutRotations/aboutMobilePositions; mainLoading; STRIPE\_\* URLs and Figma/Framer/export/spring/hover definitions; hooks/stores/controls/renderer/composer implementation and `shaderMaterial` factory/color helpers unless an actual moved pure-asset dependency requires a narrowly justified internal split. Moving the shader data does not move an adapter-specific factory. Preserve React/Vue public package names, APIs, peer floors, query/time rules and renderer behavior; Vue's existing renderer-disposal behavior is baseline, not changed opportunistically here.

## Consumer-by-consumer handoff and migration evidence

| Consumer / owner                                              | Required import/integration                                                                                                    | Disposal                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| React shader/material modules / F04                           | `{ shaders }` lookup (or private core assembly imports only inside core itself); existing runtime factories remain React-owned | Existing adapters unchanged.                |
| Vue `material.ts` / F04                                       | `{ shaders, compatibleShader }`; remove old local adaptation definition                                                        | Vue owns material/uniforms.                 |
| Vue `ShaderGradient.ts` / F04                                 | `{ HalftoneShader, defaultEnvBasePath }`                                                                                       | Vue owns composer/HDR.                      |
| Vue `ShaderGradientCanvas.ts`, `props.ts`, `presets.ts` / F04 | public core default environment/preset exports                                                                                 | No core cleanup.                            |
| React preset/constant users and UI / F04                      | all references of moved presets/initial index/camera/HDR constants/Halftone/shaders use public core entry                      | No removed private-path aliases.            |
| F05 native package                                            | actual core workspace dependency and built public exports                                                                      | No renderer dependency in core.             |
| F06 settings                                                  | `presets` (project halo to native settings); no framework imports                                                              | Pure values.                                |
| F08 material                                                  | `shaders`, `compatibleShader`, optionally core structural types                                                                | Native owns material/geometry.              |
| F10 camera                                                    | `defaultPlanesZoom`, `defaultSphereDistance`, `zoomOutPlanes`, `zoomOutSphere`                                                 | Native camera helper owns controls.         |
| F11 environment                                               | `defaultEnvBasePath`, `environmentManifest`                                                                                    | Native owns selected HDR texture.           |
| F12 grain                                                     | `HalftoneShader`                                                                                                               | Native owns cloned uniforms/passes/targets. |
| F13/F15/F16                                                   | native handoffs; no extra core renderer/source facility                                                                        | See native resource table.                  |

Before extraction, F04 attempts language-server references for each moved TS/JS symbol and module references; if no server is configured, record that actual tool result and use `trail callers` plus exhaustive import/module/GLSL literal searches as fallback. Ranked trail queries alone are not exhaustive references. Record the source→destination and caller map within core's contributor/build notes (F04 explicitly owns that required note), including UI and dynamic/GLSL imports; no claims of LSP coverage without an observed result.

Remove old moved definitions and React-private Vue aliases, update package-local dependencies/build/noExternal/cache declarations and bundling configuration, and keep unchanged adapter exports available through real root exports. Root manifest/lock/shared cache changes go to parent integration owner; no concurrent shared-file edits. Avoid retaining a deprecated source module merely to evade caller migration.

## Acceptance and evidence boundary

Parent/F04 acceptance must import **packed built core** in ordinary Node ESM with no framework/Three/browser runtime and inspect tarball for JS/declarations/license/canonical shader data. Compare the preserved F02 successful React/Vue/Framer/Nuxt baseline before/after asset migration without weakening pre-existing failures. F03 bounds native Three compatibility from observed matrix results, not core peers. F22 checks native prop/type contracts; F23 exercises actual shader/preset output. None of those checks was run by F01, and no package publication/commit/push is authorized.

Canonical sources inspected through trail graph: React `src/presets.ts:4–460`; `src/consts.ts:1–81`; `src/shaders/index.ts:1–6` and each family `index.ts:1–3`; canonical HalftoneShader uniforms at `:8–23`; Vue `src/material.ts:16–113`. Static extraction is distinct from native runtime parity and current type assignability remains a parent integration gate.
