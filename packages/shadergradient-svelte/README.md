# Native Svelte ShaderGradient

`@shadergradient/svelte` is a native Svelte 5 and Threlte SDK, not a React wrapper. Public imports are `ShaderGradientCanvas`, `ShaderGradient`, `ShaderGradientSource`, `ShaderGradientView`, `createGradientSource`, `presets` and `presetsArray`; public types come from the same package entry point.

## Availability and setup

**Available now: local, unpublished `0.1.0` packages.** Neither `@shadergradient/core@0.1.0` nor `@shadergradient/svelte@0.1.0` is a promised registry release. Follow [the contributor guide](../../CONTRIBUTING-SVELTE.md) to build and pack both packages, then install the actual paired tarballs in an isolated consumer. The native tarball depends on core `^0.1.0`: manual installs need the core tarball and a core `file:` override, not an attempted registry fetch. Do not substitute workspace source aliases for the packed public API.

| Dependency         | Declared / qualified scope                                               |
| ------------------ | ------------------------------------------------------------------------ | --- | -------- | --- | ---------------------------------------------- |
| Svelte             | `>=5.40.0 <=5.57.3`; plain consumer minimum `5.40.0`, current `5.57.3`   |
| `@threlte/core`    | Exactly `8.6.1`                                                          |
| `three`            | Exactly `0.186.1`                                                        |
| SvelteKit consumer | Svelte minimum `5.57.1`, current `5.57.3` in the qualified Kit toolchain |
| Repository Node    | `^22.19.0                                                                |     | ^24.11.0 |     | >=26.0.0`; actual qualification used `24.15.0` |

The SDK includes `camera-controls@2.9.0`; it does not require React, R3F or TresJS. These bounds describe this SDK/toolchain, not a demand to upgrade unrelated legacy React/Vue apps. See [plain and Kit examples](../../apps/examples/README.md) for complete local preparation and consumer commands. A plain Svelte app uses its Svelte Vite compiler; SvelteKit uses its normal compiled SSR pipeline. Keep SSR enabled: do not add `ssr = false` or browser-only import workarounds. Raw Node can import the built framework-neutral core, but cannot parse the native package's uncompiled `.svelte` files; that is not compiled SvelteKit SSR failure.

**Only after actual paired 0.1.x registry publication**, an installation could instead use `npm install @shadergradient/core@^0.1.0 @shadergradient/svelte@^0.1.0 @threlte/core@8.6.1 three@0.186.1 svelte@5.57.3`. Check the demonstrated release plan for exact published versions; this range does not promise that 0.1.0 itself will publish. This is conditional future guidance, not an available-now command.

## Managed gradient

This complete component works as a plain app component or a Kit route component. Settings are direct Gradient props, not a `settings` object. The wrapper has a nonzero height. Its semantic fallback is explicitly exposed because Canvas is decorative (`aria-hidden`) by default.

```svelte
<script lang="ts">
  import {
    ShaderGradientCanvas,
    ShaderGradient,
    type CameraUpdate,
    type GradientError,
  } from '@shadergradient/svelte'

  let camera = $state<CameraUpdate | undefined>()
  let error = $state<string | undefined>()
  function reportError(value: GradientError) {
    error = value.message
  }
  function reportCamera(value: CameraUpdate) {
    camera = value
  }
</script>

<section aria-label="Animated gradient preview">
  <ShaderGradientCanvas
    style="height: 320px; position: relative; background: #202038;"
    aria-hidden={false}
    pointerEvents="auto"
    respectReducedMotion={true}
    onError={reportError}
  >
    <ShaderGradient
      type="plane"
      shader="defaults"
      color1="#52ff89"
      color2="#dbba95"
      color3="#d0bce1"
      lightType="3d"
      grain="off"
      cDistance={3.6}
      cPolarAngle={90}
      onCameraUpdate={reportCamera}
      onError={reportError}
    />
    {#snippet fallback(state)}
      <p role="status">Gradient preview {state.status}. The colors are mint, sand and lavender.</p>
    {/snippet}
  </ShaderGradientCanvas>
  <p>Mint, sand and lavender decorative background.</p>
  {#if camera}
    <p>Camera: {camera.cAzimuthAngle}° / {camera.cPolarAngle}°</p>
  {/if}
  {#if error}<p role="status">Preview unavailable: {error}</p>{/if}
</section>
```

Managed mode is the default. It owns its gradient mesh/material/time, camera/controls, lighting/environment, grain and axes helpers, and releases its own resources on teardown. Only one managed Gradient may own a scene; a second reports `duplicate-managed`. Additional host scene content is allowed. Do not assume it will leave host camera/environment/render hooks untouched while managed ownership is active; use external mode when the host must remain the owner.

`onCameraUpdate` is a Gradient callback, not a Canvas or Source `onReady` callback. `CameraUpdate` reports integer-degree azimuth/polar, plus two-decimal `cDistance` for non-spheres or `cameraZoom` for spheres. Camera input angles and mesh rotations are degrees. The callback can feed your own UI; avoid unnecessary feedback that rewrites the same props. `onError(GradientError)` reports typed error codes such as `unsupported-webgl`, `renderer`, `environment` and `context-lost`.

## Physical glass

`shader="glass"` uses Three's physical transmission and environment-reflection
implementation, with procedural geometry and normalized linear tint colors. It
is not low-opacity alpha blending or a chromatic outline. `reflection` controls
polish through `roughness = 1 - reflection`; start near `0.92` for clear glass.
Use modest deformation, such as `uStrength={0.18}`, to inspect the optical cues.

Place **opaque Three objects behind the glass in the same scene** and provide an
HDR environment, for example `lightType="env" envPreset="city"` in managed mode.
CSS backgrounds, DOM elements and other transparent meshes do not supply the
opaque-scene transmission buffer. Without scene detail or suitable lighting,
clear glass can be hard to see. In external mode the host supplies the scene
content and environment; the Gradient still does not take ownership of them.

The sphere is a closed shape; plane and waterPlane are open glass sheets, not
solid lenses or closed water volumes. All three retain live tint, roughness and
time controls without rebuilding their material for each control change.
Different Three revisions, renderer output settings and environments need not
produce pixel-identical results. See the
[Next Glass Studio](../../apps/example-nextjs-dev/README.md) for an interactive
opaque-backdrop comparison using the corresponding public React SDK.

## Host-owned Threlte composition

Use `mode="external"` inside an existing Threlte Canvas when its camera, renderer, lights, environment, effects and render hooks belong to the host. External mode creates only the gradient mesh/material and its time updates. It accepts mesh/time settings and query input, but camera, lighting, grain/axes and `onCameraUpdate` are rejected by its public type. It does not dispose host-owned objects on removal.

```svelte
<script lang="ts">
  import { Canvas, T } from '@threlte/core'
  import { ShaderGradient, type GradientError } from '@shadergradient/svelte'

  let error = $state<string | undefined>()
  function reportError(value: GradientError) {
    error = value.message
  }
</script>

<section aria-label="Host-owned gradient scene">
  <div style="height: 320px; background: #202038;" aria-hidden="true">
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />
      <T.AmbientLight intensity={2} />
      <T.DirectionalLight position={[2, 3, 4]} intensity={3} />
      <ShaderGradient
        mode="external"
        type="sphere"
        shader="cosmic"
        animate="off"
        uTime={1}
        color1="#52ff89"
        color2="#dbba95"
        color3="#d0bce1"
        onError={reportError}
      />
    </Canvas>
  </div>
  <p>A mint, sand and lavender sphere. This description remains available without graphics.</p>
  {#if error}<p role="status">Preview unavailable: {error}</p>{/if}
</section>
```

The ordinary Threlte Canvas remains host-owned, including WebGL failure handling, reduced-motion policy and SSR markup. In the compiled SSR example it emits a canvas element as HTML; that is not server-side WebGL construction. The adjacent description remains meaningful without graphics. The SDK's managed Canvas fallback/lazy/context lifecycle is not automatically installed on an arbitrary host Canvas. No custom React bridge is needed.

## One Source, multiple Views

A Source owns one GPU producer; Views copy its completed frame into individual 2D canvases using centered cover cropping. Views can have different aspect ratios but are not independent cameras, scenes or interactive controls and do not forward pointer interaction to the producer. One handle admits one producer; duplicate producers report `duplicate-producer`.

Create a handle in the component instance, never in a shared module or server singleton. `onDestroy` also runs for SSR component teardown, keeping ownership per component/request. Source and View release their own leases but **never dispose the caller's handle**. The caller's `dispose()` is terminal: create a fresh handle for a new lifetime.

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    ShaderGradientSource,
    ShaderGradientView,
    createGradientSource,
    type GradientError,
  } from '@shadergradient/svelte'

  const source = createGradientSource({ label: 'paired-previews' })
  let error = $state<string | undefined>()
  function reportError(value: GradientError) {
    error = value.message
  }
  onDestroy(() => source.dispose())
</script>

<section aria-label="Two views of the same gradient">
  <ShaderGradientSource
    {source}
    width={1024}
    height={1024}
    pixelDensity={1}
    gradient={{ type: 'plane', shader: 'defaults', lightType: '3d', grain: 'off' }}
    canvas={{ respectReducedMotion: true }}
    onError={reportError}
  />
  <ShaderGradientView
    {source}
    style="height: 240px; background: #202038;"
    aria-hidden={false}
    onError={reportError}
  >
    {#snippet fallback(state)}
      <p role="status">Wide gradient preview {state.status}; a decorative multicolor background.</p>
    {/snippet}
  </ShaderGradientView>
  <ShaderGradientView
    {source}
    style="height: 320px; width: 200px; background: #202038;"
    aria-hidden={false}
    onError={reportError}
  >
    {#snippet fallback(state)}
      <p role="status">Tall gradient preview {state.status}; the same background, cropped vertically.</p>
    {/snippet}
  </ShaderGradientView>
  <p>Both previews mirror one decorative gradient, with centered cover cropping.</p>
  {#if error}<p role="status">Preview unavailable: {error}</p>{/if}
</section>
```

Source always includes its built-in managed Gradient from `gradient={...}`. Its `children` snippet adds scene content; it does not replace that Gradient. Adding another default managed Gradient causes duplicate ownership. Source's producer wrapper is always hidden, inert and `aria-hidden`; a Source `fallback(state)` is inside that hidden wrapper and is **not** a visible fallback or announcement. Put meaningful fallback text on Views (overriding their default `aria-hidden`) or in adjacent visible UI as above. View's actual canvas stays decorative. No visible producer is required.

Source defaults are width/height `1024`, pixel density `1`, maximum dimension `2048`. View defaults are pixel density `1`, maximum dimension `2048`, threshold `0`, root margin `0px`. Positive Source sizes are rounded to at least one CSS pixel; density is clamped to `0.25..2`. These bounds constrain backing buffers, not CSS layout: give Views an explicit nonzero height. Source disables its Canvas lazy gate, uses visible-view demand for temporal activity and disables producer pointer events. Views use visibility observation to contribute demand; a hidden one-shot request is separate from continuous animation.

## Explicit handle API

`createGradientSource({ label? })` returns `GradientSourceHandle`; the label is diagnostic, never a global lookup key. `state` is a reactive lifecycle snapshot (`absent`, `loading`, `ready`, `error`, `disposed`) with a generation, not per-frame state. `demand` exposes `visibleViews` and `pendingFrames`.

- `subscribe(listener)` and `subscribeFrames(listener)` return unsubscribe functions. Release them when their owner ends.
- Frame callbacks receive `CompletedFrame` and `ProducerToken`. The frame object and its canvas are **borrowed synchronously only**: copy needed pixels during the callback, never retain either for asynchronous use.
- `requestFrame()` returns a `FrameLease`; call `release()` to cancel an unfulfilled one-shot request. It is idempotent after completion/release. This is not a private animation ticker and does not create a missing producer.
- `attachView(visible)` returns a `SourceViewLease` with `setVisible` and `release`. Normal consumers use View, which owns that lease for them.
- The public producer protocol comprises `attachProducer`, `resetProducer`, `setProducerState`, `publishFrame` and `detachProducer`. Tokens scope writes to the current generation; normal consumers let Source own this protocol. It is not a second renderer or an independent View interaction API.
- `dispose()` is the caller's terminal teardown operation. A disposed handle cannot be revived by remounting Source. Producer removal without handle disposal is a different operation; the surviving handle can accept a later producer generation.

## Settings, queries, time and presets

Native precedence is **Halo defaults < valid defined direct props < valid first query entries**, with query overrides enabled only by `control="query"`. Pass `urlString` explicitly; there is no implicit browser-location dependency. Full URLs and bare query strings are accepted. Encode color hashes as `%23`; a literal `#` begins a fragment. Unknown, empty or invalid entries do not erase the previous layer, and duplicate keys use the first entry. Query booleans are `true`/`false`, while toggles use `on`/`off`. This native validated layering is not a promise to duplicate React's query parsing/prop precedence; do not transplant assumptions from the React API.

Mesh settings include `type`, `shader`, `color1..3`, `uSpeed`, `uStrength`, `uDensity`, `uFrequency`, `uAmplitude`, `reflection`, `wireframe`, `positionX/Y/Z` and degree `rotationX/Y/Z`. Time settings are `animate`, `uTime`, `loop`, `loopDuration`, `range`, `rangeStart` and `rangeEnd`. `uTime` is the explicit time input; animation advances time when enabled, with optional range/loop behavior. `animate="off"` permits a static sample without promising that prop changes never redraw.

All twelve combinations of four shaders (`defaults`, `positionMix`, `cosmic`, `glass`) and three geometries (`plane`, `sphere`, `waterPlane`) are supported. `presets` and `presetsArray` expose `halo`, `pensive`, `mint`, `interstella`, `nightyNight`, `violaOrientalis`, `universe`, `sunset`, `mandarin` and `cottonCandy`. Preset records expose `.props`; spread those props into Gradient rather than passing a nonexistent `preset` or `settings` prop. Native resolution projects supported keys, not every historical React tooling field.

Managed camera settings include `cAzimuthAngle`, `cPolarAngle`, `cDistance`, `cameraZoom`, `smoothTime`, `enableTransition` and `zoomOut`. Lighting uses `lightType="3d"` or `"env"`, `brightness` and `envPreset`. Grain uses `grain` and `grainBlending`; `toggleAxis` adds a diagnostic axes helper. External mode intentionally excludes these managed settings.

## Lighting and self-hosted HDR

The core package contains an environment **manifest, not HDR binaries**. The checked-in HDR sources are `packages/ui/assets/hdr/city.hdr`, `dawn.hdr` and `lobby.hdr`. Copy the required files to your app's `public/hdr` (plain Vite) or `static/hdr` (Kit), retaining filenames, and set Canvas `envBasePath="/hdr/"` (or Source `canvas={{ envBasePath: '/hdr/' }}`). Use `lightType="env"` and `envPreset="city"`, `"dawn"` or `"lobby"` on Gradient / Source's `gradient` object. The Three r186 HDRLoader loads these URLs; a remote host must allow CORS. Do not import invented private core HDR paths. An environment load failure is reported as `environment`; handle it with meaningful fallback/error UI rather than silently assuming an HDR is present. The runnable examples above use `3d` lighting and need no HDR download.

## Accessibility, scheduling and recovery limits

Canvas and View wrappers default to decorative `aria-hidden`; fallback text under them is also hidden unless you override wrapper attributes. Always retain adjacent meaningful content when the graphic conveys information. Canvas `fallback(state)` receives `deferred`, `loading`, `unsupported` or `error`; View / Source fallback receives the Source lifecycle states. There is no `onReady` callback. A fallback should have visible text or artwork, not just an empty colored box. Do not promise keyboard OrbitControls behavior; supply your own accessible controls if users must manipulate a camera.

Canvas defaults to `respectReducedMotion={true}`, `active={true}`, `lazyLoad={true}`, `pixelDensity={1}`, `fov={45}` and `pointerEvents="none"`. Reduced motion stops temporal advancement, not all rendering: props, camera, resize or HDR completion can still cause one-shot redraws. `active` gates temporal work similarly. Lazy visibility uses `threshold` and `rootMargin`; without IntersectionObserver the Canvas becomes visible normally. SSR renders wrapper/fallback UI without allocating a WebGL renderer; hydration starts browser work. In a host Threlte Canvas, implement host motion/visibility policy yourself.

The managed Canvas requires WebGL2. Context loss stops work and reports `context-lost`; recovery waits for a real `webglcontextrestored` event before constructing a new renderer/scene generation. There is no guarantee that the driver will restore it. A deliberate component remount is an application retry boundary for unrecoverable renderer failures, not automatic endless retry. Reuse only a still-live handle or create a fresh one after terminal disposal. DPR/FOV/size updates are not renderer recreation boundaries; creation-time `preserveDrawingBuffer` and `powerPreference` are. Neither option guarantees recovery or cross-device rendering behavior.

## Verified support and exclusions

Current evidence includes paired packed plain-Svelte and SvelteKit consumers, compiled SSR/type gates and a 34-project browser matrix: 1,808 rows, 1,684 passes and 124 adjudicated applicability skips, with no unexpected, flaky, unknown or unexecuted rows. Chromium, Firefox and WebKit were exercised locally; current Firefox WebGL2 works headless and headed on container Mesa llvmpipe, with the suite using headed Xvfb. Touch evidence is emulated, not physical-device testing; Firefox uses `hasTouch=true` / `isMobile=false`, and trusted touch-move limitations in Firefox/WebKit are not a blanket waiver of tap/mouse/keyboard scenarios.

Default-launch SwiftShader stress completed 100 cycles and 1,796 checks. Opt-in AMD/RADV stress instead failed with native Chromium SIGFPE; that hardware limit remains explicit and no SDK cause was established. JS heap growth (about 16 to 18 MB overall), scoped allocation flags and disposal counters are not universal zero-allocation or GPU-leak proof. Local image-equivalent CI is not evidence of actual hosted GitHub Actions execution. Framer/Figma bundle builds are not hosted-editor qualification. See [browser evidence and limitations](../../tests/browser/README.md) for scope and reproduction details.

This SDK does not expose React stores/UI controls, Framer/Figma editor integration, React spring options/tooling callbacks, custom React bridges, WebGPU rendering or independent interactive View cameras. It does not rewrite or replace the React/Vue packages. For development and packed consumer setup see [CONTRIBUTING-SVELTE](../../CONTRIBUTING-SVELTE.md), and for runnable app entry points see [examples](../../apps/examples/README.md).
