# Native Svelte contract

Selected contract for F01 (`shadergradient-a0q.1`), not evidence of implemented or tested runtime support. `packages/shadergradient-svelte/src/lib/types.ts` is the complete type-only shape authority; the function signatures below are implementation obligations, **not runtime declarations to export before implementation**. All native paths below are relative to that directory. F04's neutral asset boundary is frozen in [SVELTE-CORE-CONTRACT.md](./SVELTE-CORE-CONTRACT.md).

## Versions, imports and export ownership

Use Svelte runes and `createContext`, therefore the selected Svelte floor is **5.40.0** (`>=5.40 <6` is a candidate peer range, conditional on F03 evidence). Threlte 8.6.1 and Three 0.186.1 are the current implementation targets; no lower Three or Threlte range is proven here. Kit consumers have their separate toolchain floor. F03 must test the 5.40 context implementation rather than assume current documentation's newer three-result context tuple exists at that floor: only use the original getter/setter pair. No Kit runtime imports, React renderer, Threlte extras or WebGPU dependency.

F05 initially exports only the landed pure preset values and public types listed below. F13 is sole subsequent `index.ts` owner and exports landed `Canvas.svelte` as `ShaderGradientCanvas`, `ShaderGradient.svelte` as `ShaderGradient`, preserving the initial value/type surface. F19 subsequently adds `ShaderGradientSource`, `ShaderGradientView`, and `createGradientSource` from `source.svelte.js`. Internal helpers remain direct internal imports with fully specified `.js`/`.svelte` paths. No speculative exports, alternate contexts, compatibility shims or placeholder components.

Public type whitelist: `ShaderName`, `GradientType`, `PresetName`, `EnvironmentPreset`, `Toggle`, `MeshSettings`, `TimeSettings`, `CameraSettings`, `LightingSettings`, `EffectsSettings`, `ResolvedExternalSettings`, `ResolvedGradientSettings`, `QuerySettings`, `GradientSettingsInput`, `ExternalSettingsInput`, `CameraUpdate`, `GradientError`, `GradientCallbacks`, `ManagedGradientProps`, `ExternalGradientProps`, `ShaderGradientProps`, `CanvasFallbackState`, `WrapperAttributes`, `ShaderGradientCanvasProps`, `SourceState`, `SourceDemand`, `ProducerToken`, `CompletedFrame`, `FrameLease`, `SourceViewLease`, `SourceProducer`, `GradientSourceHandle`, `GradientSourceOptions`, `ShaderGradientSourceProps`, `ShaderGradientViewProps`. Other types are internal even though exported from `types.ts` to their implementing modules. F05 also exposes exactly `presets` and `presetsArray` as genuine convenience reexports from public `@shadergradient/core`, retaining their full data/types rather than copying or projecting them. Shader strings, adaptation, Halftone and camera/HDR constants stay core-only, not another native asset API.

## Public primitives

| Primitive / owner                   | Exact props or function type                                                  | Composition and defaults                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Canvas.svelte` / F07               | `ShaderGradientCanvasProps`                                                   | DOM `div`, typed `children?: Snippet`, `fallback?: Snippet<[CanvasFallbackState]>`; snippets run under the actual Threlte Canvas only after mount. HTML attributes including class/style/listeners apply to wrapper. |
| `ShaderGradient.svelte` / F13       | `ShaderGradientProps`                                                         | Omitted mode means managed. Managed owns one camera/environment/grain/axes/control pipeline per actual scene. External requires `mode='external'`, owns only mesh/material/time. No DOM wrapper or children prop.    |
| `source.svelte.ts` / F14            | `createGradientSource(options?: GradientSourceOptions): GradientSourceHandle` | Per-call, SSR-safe closure; label is diagnostic only, never identity. Caller owns terminal `dispose()`.                                                                                                              |
| `ShaderGradientSource.svelte` / F15 | `ShaderGradientSourceProps`                                                   | Required explicit `source`; optional `gradient: ManagedGradientProps`, `canvas` configuration, native scene `children`, typed source-state fallback. It owns one hidden producer Canvas, not the handle.             |
| `ShaderGradientView.svelte` / F16   | `ShaderGradientViewProps`                                                     | Required explicit `source`, wrapper attrs and typed source-state fallback; owns a 2D canvas only. No camera/control/grain props or independent interaction.                                                          |

`ExternalGradientProps` forbids every `CameraSettings`, `LightingSettings`, `EffectsSettings` key and `onCameraUpdate` with optional `never`. Query overrides in external mode likewise cannot affect these fields. Multiple external gradients may coexist with one managed gradient; two managed gradients in one scene fail deterministically. External mesh reflection still affects its own material; it may observe a host environment but never installs or disposes one. Native accepts no React spring/hover/export/Figma/Framer/store props.

Camera callbacks contain integer-degree `cAzimuthAngle` and `cPolarAngle`, and either two-decimal `cDistance` for plane/waterPlane or two-decimal `cameraZoom` for sphere. Omit the extra field if nonfinite; prefer finite control zoom, otherwise finite camera zoom. Use `Number(value.toFixed(2))`, not string payloads. Emit at control `rest`, not every frame. Callback replacement is reactive. Initial camera placement snaps; subsequent prop changes transition only when enabled and motion is permitted. User control is immediate (`smoothTime=0` during interaction); restore configured smoothing after rest. Plane zoom is 1, sphere distance 14; zoomOut uses plane `{zoom:1,distance:14}` and sphere `{zoom:5,distance:14}`. Controls use maxDistance 1000 and restThreshold .01. In the actual camera-controls 2.9 API, supported `dollySpeed` is 5 for plane/waterPlane DOLLY and 10 for sphere ZOOM; there is no `zoomSpeed` property. Left/one-touch rotate, middle/wheel sphere zoom or plane dolly, right/two/three-touch actions disabled. No pan or gizmo UI promise.

The third `CameraUpdate` union branch (both distance/zoom optional `never`) is intentional: a settled callback still reports finite rounded angles when neither relevant distance nor zoom is finite. It does not permit both distance and zoom together, and external gradients cannot accept this callback.

`Camera.svelte` owns the public Threlte `useCamera()` make-default registration/manual-mode boundary around the helper's injected setter; F13 mounts this component, rather than relying on an unregistered raw camera assignment. The helper still consumes the same injected signatures and captures the previous camera before assignment. Registration/manual cleanup removes only the owned camera and preserves a newer registered host camera. Threlte 8.6.1 deliberately untracks store `.current` reads: use `fromStore` subscriptions for camera ownership and size/DPR synchronization, not a captured or supposedly reactive `.current` alone.

### Canvas lifecycle and accessibility

Defaults: `pixelDensity=1`, `fov=45`, `envBasePath=core.defaultEnvBasePath`, `respectReducedMotion=true`, `active=true`, `pointerEvents='none'`, `lazyLoad=true`, `threshold=0`, `rootMargin='0px'`, `preserveDrawingBuffer=false`, `powerPreference='default'`. DPR must be finite positive (invalid falls back to 1), FOV finite in `(0,180)` (invalid falls back to 45), threshold finite in `[0,1]` (invalid falls back to 0). Wrapper requires consumer-provided nonzero width and height; it does not invent viewport dimensions. Default `aria-hidden=true`; explicit consumer values override it. Explicit wrapper style wins over default pointer-events, and explicit `pointerEvents` wins over the default. Meaningful images/interactive controls need consumer accessibility labeling and pointer override.

Server and first hydration markup have the same wrapper/fallback and no canvas. Before client mount fallback is `deferred`; after eligible mount until the first **completed renderer frame**, `loading`; WebGL unavailability is `unsupported`; construction/context errors are `error`. No fallback snippet means empty wrapper content, not fabricated success. A renderer instance/HDR request alone is not ready. Canvas readiness means completed renderer output; gradient HDR readiness is a separate environment state and Source readiness requires actual publication. The wrapper remains while a mounted renderer is warming up; fallback can overlay it without changing the SSR boundary.

Lazy offscreen exit unmounts scene and renderer, clears live refs and returns to deferred. Reentry creates a new renderer/scene and resets gradient elapsed to current `uTime`. Missing IntersectionObserver means eager mount, not failure. Reduced-motion defaults false before client observation and follows `(prefers-reduced-motion: reduce)` only if respected. It stops temporal work but not input/explicit redraws. `active=false` similarly gates time/controls interpolation, never explicit redraws. `pixelDensity`, FOV, CSS resize and environment base-path changes synchronize in place; only preserveDrawingBuffer or powerPreference changes recreate the renderer.

Context loss on the captured owned canvas calls `preventDefault`, stops scene work, clears live ready state, reports `context-lost` and shows error fallback. Retain the canvas/listener to receive restoration, then recreate the scene/renderer once on the actual restoration event; no timer/retry loop. Restoration is a fresh time origin. Bind/remove listeners by actual ref, never selectors, MutationObserver or IDs. All errors have the `GradientError` shape; callback delivery does not turn errors into success. Missing Threlte context and duplicate managed ownership report/throw actionable errors naming `<Canvas>` and external mode/scene constraints respectively. Duplicate producer throws code `duplicate-producer` without touching the incumbent.

### Type-consumer examples for F22 review

These use only type imports and accept real snippets/handles from their caller; they are not runtime component declarations.

```ts
import type { Snippet } from 'svelte'
import type {
  CanvasFallbackState,
  SourceState,
  GradientSourceHandle,
  ShaderGradientCanvasProps,
  ManagedGradientProps,
  ExternalGradientProps,
  ShaderGradientSourceProps,
  ShaderGradientViewProps,
} from '@shadergradient/svelte'

function compositionTypes(
  children: Snippet,
  fallback: Snippet<[CanvasFallbackState]>,
  sourceFallback: Snippet<[SourceState]>,
  source: GradientSourceHandle
) {
  const managed: ManagedGradientProps = {
    shader: 'glass',
    type: 'sphere',
    cAzimuthAngle: 180,
    onCameraUpdate(update) {
      const angle: number = update.cAzimuthAngle
      const zoom: number | undefined = update.cameraZoom
      console.log(angle, zoom)
    },
  }
  const external: ExternalGradientProps = {
    mode: 'external',
    shader: 'cosmic',
    color1: '#ff5005',
    animate: 'off',
  }
  const canvas: ShaderGradientCanvasProps = {
    children,
    fallback,
    class: 'gradient',
  }
  const producer: ShaderGradientSourceProps = { source, gradient: managed }
  const lateView: ShaderGradientViewProps = { source, fallback: sourceFallback }
  // @ts-expect-error external gradients cannot install managed grain
  const invalid: ExternalGradientProps = { mode: 'external', grain: 'on' }
  return { managed, external, canvas, producer, lateView, invalid }
}
```

After F14 lands, create each request/tree's source inside that request/component's instance setup: `const a = createGradientSource(); const b = createGradientSource()`. Pass `a` to one producer and views that may mount later; pass `b` to a different producer/tree. There is no module-scoped singleton, string lookup or implicit cross-tree rendezvous. Calling `a.dispose()` must not affect b. F22 owns actual compile/type fixtures, not these documentation examples.

Executable settings/time regressions are `node --test tests/svelte/contracts/settings.test.mjs tests/svelte/contracts/time.test.mjs`; their internal helper imports are unit-only, not public subpath promises. Public declarations are exercised separately by `node tests/svelte/types/run.mjs --consumer-root apps/example-svelte-dev --expect-svelte 5.57.3 --case all`. The runner copies four positive consumers and 37 isolated negative cases into the actual consuming package, resolves generated declarations through public exports, and checks diagnostic kinds and expression locations rather than wording. Pass a genuinely installed consumer root and its Svelte version for lower-bound or tarball verification; the SDK's own package is not a consumer. Metadata resolution uses the public `svelte` export condition, matching the Svelte-aware compiler. A passing type matrix does not establish browser, SSR, resource or performance qualification.

## Pure settings and time (F06)

`settings.ts` exports exactly:

```ts
resolveGradientSettings(input?: GradientSettingsInput): ResolvedGradientSettings
resolveExternalSettings(input?: ExternalSettingsInput): ResolvedExternalSettings
```

Both are pure, allocate only on settings changes and import only core data/types. Managed precedence is native-complete halo defaults < defined explicit props < recognized valid query entries only if `control==='query'`. External uses the same defaults projected to mesh/time keys and never recognizes managed query keys. Explicit `undefined` is absence; false/zero are retained. Runtime explicit nonfinite numeric or invalid enum/color values retain defaults, using the same value rules as query; this is not a general validation/retry framework. `control` defaults props, URL defaults empty. No `preset` selector prop: users spread `presets[name].props`, with native projection dropping tool-only fields.

Halo visual values are canonical: plane/defaults, animate on, uTime 0, uSpeed .4, uStrength 4, uDensity 1.3, uFrequency 5.5, uAmplitude 1; colors `#ff5005/#dbba95/#d0bce1`; reflection .1; wireframe false; position `(-1.4,0,0)`, rotation degrees `(0,10,50)`; camera `(azimuth180,polar90,distance3.6,zoom1)`; brightness1.2, lightType3d, envPresetcity, grainon. Complete native-only defaults: range disabled/start0/end40, loop off/duration5, smoothTime .05, enableTransition true, zoomOut false, grainBlending1, toggleAxis false. Do not inherit export-tool fields from halo.

| Key class          | Recognized keys / rule                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finite numbers     | uTime/uSpeed/uStrength/uDensity/uFrequency/uAmplitude, positionX/Y/Z, rotationX/Y/Z, reflection, rangeStart/rangeEnd/loopDuration; managed additionally cAzimuthAngle/cPolarAngle/cDistance/cameraZoom/smoothTime/brightness/grainBlending. Trim, require nonempty, `Number(value)` finite; do not clamp zero/negative values or impose new ranges.   |
| Exact booleans     | wireframe; managed additionally enableTransition/zoomOut/toggleAxis. Only strings `true` and `false` in query.                                                                                                                                                                                                                                        |
| Enums              | type: plane/sphere/waterPlane; shader: defaults/positionMix/cosmic/glass; animate/loop: on/off; range: enabled/disabled; managed lightType: 3d/env; envPreset: city/dawn/lobby; grain: on/off. Case-sensitive.                                                                                                                                        |
| Colors             | color1/color2/color3: trim and accept only `#RGB`, `#RRGGBB`, decimal `rgb(r,g,b)` with each integer 0–255, or `hsl(h,s%,l%)` with finite h and s/l 0–100. Hue is any finite degree value. No alpha, CSS variable, browser parser, color names or color-space extension. This deliberate deterministic native subset preserves all canonical presets. |
| Not query settings | mode, callbacks, control, urlString, all Canvas/Source/View configuration, all tool-only preset keys.                                                                                                                                                                                                                                                 |

URL handling: input may be raw query with optional leading `?`, or URL/path containing `?`; strip fragment beginning at the first `#` **before** locating query, then take text after the first `?` if present. A URL/path without `?` yields no settings (identify path/URL by `/` or `://`); bare `key=value&...` is accepted. `URLSearchParams` decoding rules apply (`+` is space), so encode color hash as `%23`; literal hash starts a fragment. Repeated keys use the **first** decoded entry even if empty/invalid; no later-entry rescue, arrays or indexed-array syntax. Unknown/absent/empty/invalid keys retain the previous layer. This is deliberately not React wholesale-query compatibility.

`time.ts` exports exactly:

```ts
advanceElapsed(elapsed: number, delta: number, advancing: boolean): number
resolveTime(elapsed: number, settings: Readonly<TimeSettings>): number
```

Caller initializes elapsed to resolved uTime and owns seeks/state. `advanceElapsed` adds only a finite strictly-positive delta while advancing; otherwise returns unchanged elapsed. No speed multiplication: uSpeed remains shader input. Explicit finite uTime changes seek immediately, including negative values; changing loop/range remaps the existing elapsed without resetting it. `resolveTime` first uses loop on with finite positive duration D: `((elapsed % D)+D)%D`. Otherwise enabled range with finite `end>start`, width W: `start + ((elapsed % W)+W)%W`. This deliberately matches Vue's **offset-origin** range semantics: start10/end20 maps elapsed0 to10, elapsed10 to10, elapsed-1 to19, rather than subtracting start before modulo. Equal/reversed/nonfinite interval means no range wrap; invalid loop falls through to valid range; valid loop takes precedence. No sorting, clamping or silent swap. Negative seeks wrap positively; raw elapsed remains unwrapped so changing intervals is deterministic. Freeze/resume never samples wall time or catches up paused time. `uLoop=1` only for a valid enabled loop; invalid loop uses `uLoop=0`, safe uniform duration5.

An unchanged declarative `uTime` value is not a new seek event. Elapsed time is not written back into props or reactive UI state. Unrelated visual updates and material replacement retain elapsed time; a newly mounted animation helper starts from the current resolved `uTime`, including after Canvas teardown/reentry.

## Exact internal module handoffs, F06–F16

All listed functions are named exports unless a `.svelte` component is named. Imported types are from `types.js`. `Read<T>` means a live getter read in setup effects and scheduler callbacks, never a captured initial prop. All returned disposers are idempotent. Helpers receiving lifecycle/scene leases do **not** import F13 context or own the host renderer.

`Camera.svelte`, `Lights.svelte`, `Grain.svelte`, and `Axes.svelte` expose an internal instance `dispose(): void` capability, invoking the same complete, idempotent cleanup used by their own destruction. F13 captures these capabilities and disposes grain, axes, environment and camera before relinquishing its managed lease. This is not a second resource owner, a public package export, or a new props protocol. Actual failed-boundary execution of the original effect-cleanup implementation released its lease while its ambient light remained attached. Explicit disposal avoids depending on sibling destruction order. A failed partial initial branch without captured capabilities releases its reservation in a microtask after remaining child destruction, before another frame. Public and injected helper props remain unchanged.

Component-owned manual effect roots register disposal through a dependency-free `$effect.pre` teardown during initialization. Do not rely solely on `onDestroy` to install it: in supported Svelte 5.57.3, `onDestroy` delegates to a deferred `onMount` effect, which may never execute before an initial sibling failure. A manual [`$effect.root`](https://svelte.dev/docs/svelte/$effect#$effect.root) does not auto-cleanup with that failed subtree. The initial-failure regression observes camera restoration and zero ambient/axes before the lease becomes inactive; animation work uses the same synchronous cleanup registration.

| Owner / exact filename            | Signature / consumer                                                                                                                                                                                                                                                                          | Lifetime and cleanup                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F06 `settings.ts`, `time.ts`      | Four pure signatures above → F09/F13/F22                                                                                                                                                                                                                                                      | Caller owns numeric elapsed; no cleanup.                                                                                                                                                                                                                                                                                                                                         |
| F07 `canvas-context.svelte.ts`    | `createCanvasContext(input: CanvasContextInput): CanvasLifecycleContext`; `provideCanvasContext(context: CanvasLifecycleContext): CanvasLifecycleContext`; `getCanvasContext(): CanvasLifecycleContext \| undefined`; `useCanvasLifecycle(): CanvasLifecycleContext`; internal `releaseCanvasRenderer(context: CanvasLifecycleContext, renderer: WebGLRenderer): void` → Canvas/CanvasScene/F13 | create/provide before Threlte has no browser/renderer access. Optional get handles only missing package context. use requires real Threlte, binds an unbound provided context once, or creates/provides a local host-owned fallback. First-binding component cleanup releases its hooks; owned renderer disposal also identity-releases its binding when initial child failure skipped framework cleanup. No second context module or new public package export. |
| F07 `Canvas.svelte`               | `ShaderGradientCanvasProps` → F13/F15/consumers | Canvas alone owns its renderer's idempotent disposal gate. Normal Threlte subtree teardown invokes that gate; Canvas finishes any still-owned release after Svelte teardown when failed initialization prevented Threlte's deferred hook registration. Wrapper owns context-loss listeners and one `forceContextLoss` release of its captured owned context. Never dispose a borrowed host renderer or execute the underlying owned disposal twice. |
| F07 `CanvasScene.svelte`          | `CanvasSceneProps` → Canvas/F15                                                                                                                                                                                                                                                               | `useCanvasLifecycle()` under Threlte; runs children there; `onReady(lifecycle)` after binding, not a completed-frame claim. A nested bridge may reuse the already bound context for Source capture; it must not add another scheduler.                                                                                                                                           |
| F08 `geometry.ts`                 | `createGeometry(type: GradientType): BufferGeometry` → Mesh                                                                                                                                                                                                                                   | Mesh disposes replaced geometry and final geometry once.                                                                                                                                                                                                                                                                                                                         |
| F08 `material.ts`                 | `createMaterial(settings: ResolvedExternalSettings): MaterialHandle` → Mesh                                                                                                                                                                                                                   | Returned handle owns physical material/uniforms/color scratch. `update(settings):void` mutates stable slots; `dispose():void` releases that material only. Variant is `(shader,type)` and cache key includes both. No core material factory.                                                                                                                                     |
| F08 `Mesh.svelte`                 | `MeshProps` → F13                                                                                                                                                                                                                                                                             | Stable mesh; `onReady(handle)` once attached, `onReady(undefined)` before disposal. Mesh handle getters follow current material/uniforms/uTime across variant replacement. Mesh explicitly disposes geometry/material and disables Threlte automatic disposal for these same objects. No own animation task.                                                                     |
| F09 `animation.svelte.ts`         | `createAnimation(input: AnimationInput): AnimationHandle` → F13                                                                                                                                                                                                                               | Registers lifecycle animation work; getter changes sync uTime seek/loop state even paused. Advancing iff animate on, enabled getter (default true), lifecycle active and not reducedMotion. Material replacement gets current resolved time immediately. `seek(finiteTime)` updates elapsed and uniform, invalidates without restarting time. Dispose removes work/effects only. |
| F10 `camera.svelte.ts`            | `createCamera(input: CameraInput): CameraHandle` → Camera                                                                                                                                                                                                                                     | Creates owned PerspectiveCamera/controls, assigns using injected get/set, registers controls work, syncs lifecycle FOV/size; restore previous camera only if active assignment still owned. Dispose controls/listeners/work once; PerspectiveCamera has no GPU dispose method.                                                                                                   |
| F10 `Camera.svelte`               | `CameraProps` (= CameraInput) → F13                                                                                                                                                                                                                                                           | Initializes createCamera during component init; its teardown calls handle.dispose. No separate camera lifecycle convention.                                                                                                                                                                                                                                                      |
| F11 `environment.svelte.ts`       | `createEnvironment(input: EnvironmentInput): EnvironmentHandle` → Lights                                                                                                                                                                                                                      | Own ambient + selected HDR generations. onState live getter reports disabled/loading/ready/error; onError reports current failures only. Dispose releases owned texture/light assignment/effects.                                                                                                                                                                                |
| F11 `Lights.svelte`               | `LightsProps` (= EnvironmentInput) → F13                                                                                                                                                                                                                                                      | Owns helper cleanup; helper attaches ambient to lease.scene, component does not duplicate `<T>` ownership.                                                                                                                                                                                                                                                                       |
| F12 `grain.svelte.ts`             | `createGrain(input: GrainInput): GrainHandle` → Grain                                                                                                                                                                                                                                         | Own EffectComposer/RenderPass/ShaderPass and replacement lease. Reactive grain off unregisters replacement and disposes pipeline; on creates it. No private clock.                                                                                                                                                                                                               |
| F12 `Grain.svelte`                | `GrainProps` (= GrainInput) → F13                                                                                                                                                                                                                                                             | Calls helper, one teardown owner.                                                                                                                                                                                                                                                                                                                                                |
| F12 `Axes.svelte`                 | `AxesProps` → F13                                                                                                                                                                                                                                                                             | Owns AxesHelper(5), attaches to lease.scene, toggles visibility in place; explicitly removes and calls helper.dispose once. `AxesHandle` describes owned resource, not an additional exported factory requirement.                                                                                                                                                               |
| F13 `scene-context.svelte.ts`     | `useSceneContext(scene: Scene): SceneContext` → ShaderGradient                                                                                                                                                                                                                                | Uses Canvas-scoped Threlte user context namespace `@shadergradient/svelte/scene-ownership` to hold a WeakMap keyed by **actual Scene**. Namespace installation uses existing:'skip'. `acquireManaged(owner:symbol):ManagedSceneLease` throws on another active owner, release conditionally clears only its own claim.                                                           |
| F13 `ShaderGradient.svelte`       | `ShaderGradientProps` → F15/public                                                                                                                                                                                                                                                            | Gets lifecycle via F07 useCanvasLifecycle, scene via useThrelte, scene lease via F13 registry, settings via F06; mounts mesh, animation and managed-only helpers. Acquires lease before any managed helper; unmounts them before release. Never disposes renderer.                                                                                                               |
| F14 `source.svelte.ts`            | `createGradientSource(options?: GradientSourceOptions): GradientSourceHandle` → F15/F16/F19                                                                                                                                                                                                   | Exact full handle interface in types.ts and transitions below. No Canvas/runtime component import.                                                                                                                                                                                                                                                                               |
| F15 `ShaderGradientSource.svelte` | `ShaderGradientSourceProps` → F19                                                                                                                                                                                                                                                             | Connects producer callbacks to real Canvas and post-render bridge, nested CanvasScene capture; producer clears readiness before Canvas disposal.                                                                                                                                                                                                                                 |
| F16 `ShaderGradientView.svelte`   | `ShaderGradientViewProps` → F19                                                                                                                                                                                                                                                               | State subscription, frame subscription, visibility lease, resize frame lease, observers and 2D pixels have one View teardown path; does not dispose handle.                                                                                                                                                                                                                      |

F07 also implements lifecycle `environmentState: EnvironmentState`, `setEnvironmentState(owner: symbol, state: EnvironmentState | undefined): void`, and `subscribeEnvironment(listener: (state: EnvironmentState) => void): Dispose`. Initial state is disabled; subscription immediately delivers it. The first setter owner claims this small status channel; another live owner is rejected, and undefined releases only the matching owner then restores disabled. This is internal status propagation, not another scene registry or a public gradient prop. F13 forwards F11's live `onState` to this method with its managed lease.owner, initializes loading synchronously for an env gradient before the first render, and releases the channel after helper cleanup. F15 subscribes through captured CanvasLifecycleContext; F11 needs no F07 runtime import. No per-frame notifications.

### Lifecycle bridge and one render

`CanvasLifecycleContext` supplies live settings/motion/active/canvas/renderer/size getters, `rendererOwnership`, `invalidate`, `registerWork`, `replaceRender`, `subscribeAfterRender`, and `reportError` exactly as typed. Configuration object identity remains stable; Three objects are ordinary variables or `$state.raw`, never deep proxies. `registerWork(phase, {active,tick})` registers a callback, returns removal, and must observe changing active getters. It is safe after setup in a reactive effect; **registration must not call useTask from an effect**. F07 creates fixed scheduler tasks during below-Canvas initialization and dispatches registrations from them. Returned removal releases only that registration.

Explicit invalidation requested during or after final-frame publication must survive Threlte's current-frame reset and produce a later completed frame. F07 coalesces that case through one stable, binding-scoped microtask callback with context/halt/teardown guards; ordinary main-stage temporal invalidations stay synchronous. This is not another RAF loop. Context-loss guards never stop a borrowed host's default render task; only owned Canvas tasks/renderers may be halted by that ownership path.

Order in one Threlte scheduler:

1. Main-stage controls dispatch, only while active controls/interpolation exist.
2. Main-stage animation dispatch after controls, only while temporal animation exists.
3. Render stage: exactly one normal `autoRenderTask`, **or** owned replacement callback with current scheduler delta.
4. Post-render task in that same render stage, explicitly after both render tasks, synchronously notifies completed-frame subscribers only on actual successful render.

All bridge tasks set `autoInvalidate:false`; temporal dispatch explicitly invalidates only if active work changed output. Stopped/idle tasks do not invalidate; fixed render-stage tasks alone do not cause demand frames. `invalidate()` schedules explicit settings/input/seek/resize/HDR work regardless of pause. Host renderMode='manual' needs bridge `advance()` for an explicit request; it must not rewrite the host renderMode. Continuous host rendering remains the host's decision. Each render creates no arrays/colors/vectors/frame objects/UI updates: keep one ephemeral CompletedFrame record, increment sequence, update dimensions, synchronously dispatch. UI readiness changes only on state transition.

`replaceRender(owner,replacement)` records/restores the previous `autoRender` state conditionally, rejects another replacement, and suppresses default rendering only while its lease is active. The bridge's precreated replacement task executes callback exactly once. F12 never separately registers a second render task. Removal restores the captured autoRender only if this bridge still owns the disabled state; never overwrite a newer host change. Native owned Canvas config uses LinearSRGBColorSpace/NoToneMapping and on-demand rendering. External mode never changes host renderer output settings. Managed under external Canvas may temporarily install camera/environment/grain only via their owned leases, without acquiring renderer disposal rights.

Fallback when package Canvas context is absent is per-calling subtree: default envBasePath, requested DPR from actual renderer, FOV from host perspective camera or45, reducedMotion=false, respectReducedMotion=false, active=true, rendererOwnership='host'. Never install a global mutable fallback, media listener or renderer defaults. Missing **Threlte** context is not the optional-package-context case and must raise actionable missing-context. Scene-wide managed exclusion still works between sibling gradients because the registry is Threlte Canvas-scoped, not a Svelte context installed only under the first sibling. A module-level immutable namespace string/context key is allowed; a global mutable WeakMap/Map/handle registry is not.

### Material, environment and grain boundaries

Geometry: plane `PlaneGeometry(10,10,1,192)`, sphere `IcosahedronGeometry(1,64)`, waterPlane `PlaneGeometry(10,10,192,192)`. Every family defaults/positionMix/cosmic/glass supports every geometry: twelve required real combinations. Geometry changes replace geometry; `(shader,type)` changes replace material; uniform/color/transform/reflection/wireframe changes do not. Uniform containers/slots are stable for a material's lifetime. Mesh getters follow replacements, so animation must not retain an obsolete `uTime` slot. Initial slots include loop/uTime and every glass slot named in GradientUniforms. Colors are converted with LinearSRGBColorSpace into reused Color/vector objects; scalar/vector uniform aliases agree. All source shaders come from public core. No global ShaderChunk mutation.

`createMaterial` initializes uTime once from resolved settings. Later `MaterialHandle.update` must not overwrite elapsed uTime merely because a color/transform/noise setting changed; F09 alone applies explicit uTime seeks after integration. New material variants receive current animation time through the live MeshHandle getter before the next render. Material/uniform replacement signals are reactive raw references so this synchronization also runs while animation is paused.

On the demonstrated r186 revision, native glass adapts canonical reflection/refraction sampling to Three's PMREM CubeUV environment representation, including environment rotation and consistent world/view-space directions. The adaptation is material-local; core GLSL and existing adapters remain unchanged. All twelve native variants and all three HDR selections on each glass geometry have completed real linked-program/pixel checks. These helper checks do not replace final public-consumer, Source/View or preset qualification.

Non-glass material uses DoubleSide/metalness .2/roughness `1-reflection`; glass uses DoubleSide/metalness0/transparent/opacity.3/transmission.9/thickness.5/clearcoat1/clearcoatRoughness0/ior1.5/roughness.1. Preserve canonical glass defaults from Vue material.ts: intensity.5, transparency.1, refraction1.5, chromaticAberration.1, fresnelPower2, reflectivity.9, waveAmplitude.02, waveFrequency5, distortion.1, flowSpeed.1, flowDirection(1,.5), liquidEffect.5, foamIntensity.3; loadingTime1. No new glass-specific public controls.

Environment: only selected core manifest file, base path normalized by trimming trailing slashes then adding `/`; do not resolve against browser location in core/settings. Relative paths remain relative. On 3d, ambient is brightness×π and state disabled. On env loading/error ambient .4; only installed current HDR yields ready and ambient0. Use r186 `three/addons/loaders/HDRLoader.js`, EquirectangularReflectionMapping. Generation switch immediately invalidates old callback ownership; dispose late results once, never install them or call obsolete callbacks. Restore previous scene.environment only while it still equals the owned assigned texture. No retries/cache/PMREM abstraction unless actual loader semantics require owned resources; no disposing a borrowed host environment.

Grain: official revision-matched EffectComposer/RenderPass/ShaderPass with core HalftoneShader; cloned per-instance uniform data, never mutate shared core descriptor. Pass current scheduler delta, never an independent clock or random time changes while paused. `FrameSize.width/height` and Halftone width/height uniforms use **CSS pixels**, composer.setSize uses CSS pixels, composer.setPixelRatio uses actual DPR; its targets are therefore drawing-buffer pixels. Blending mutates pass uniform. Composer owns its targets; render pass and shader pass each have one explicit disposer. No separately disposing targets already owned by composer. Axes is a helper, not vendored React gizmo.

## Source state, generation and copying

The `GradientSourceHandle` methods in types.ts are the **one** protocol. Producer owns returned token; tokens are checked by object identity plus current generation, not caller-provided numeric generation alone. State snapshots are immutable/reactive and contain no canvas. `subscribe` immediately delivers current state and returns idempotent unsubscribe. `subscribeFrames` never immediately replays a stored drawing buffer; only future completed-frame dispatch. Frame record and canvas are borrowed for the duration of that synchronous callback only. No buffer is retained as handle state, and callers never copy from a previously published canvas later.

| Operation                             | Transition / exact outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create                                | absent generation0, zero views/requests; no browser access.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| attachProducer                        | If live producer, throw duplicate-producer; if disposed throw source-disposed. Otherwise increment generation, retain producer callbacks, loading, return new token; immediately notify onDemandChange(current demand). Pending pre-producer requests are retained and invalidate once when attachment can serve them.                                                                                                                                                                                        |
| setProducerState(token,loading/error) | Current token only; clear ready first, notify state. Returns false for stale/disposed without notification; true for current. Loading clears stale pixels via state subscription. Error includes supplied typed error.                                                                                                                                                                                                                                                                                        |
| resetProducer(token)                  | Current token: increment generation, loading, new token, same exclusive producer reservation/callbacks and demand. Return undefined for stale/disposed. Old post-render callbacks cannot publish. Used before source renderer release/recreation.                                                                                                                                                                                                                                                             |
| publishFrame(token,frame)             | Require current token, live producer, nonzero actual buffer dimensions; stale/invalid returns false. First completed valid frame marks ready then synchronously dispatches frame listeners. Recheck ownership before each callback: a reentrant detach/reset must stop old-generation delivery. Fulfill requests pending at publication start; a request created during dispatch requires a later frame. Successful accepted publication returns true. No per-frame state snapshot churn while already ready. |
| detachProducer(token)                 | Current token only: increment generation, clear producer callbacks/readiness, absent, notify; stale call no-op. Retain live views and their unfulfilled request leases so a later producer can serve them. No canvas reference survives.                                                                                                                                                                                                                                                                      |
| attachView(visible)                   | Counts one live view and, if true, one visible view. Returns idempotent release and live setVisible. Becoming visible invalidates attached producer once, including paused producer; becoming hidden/removal updates demand synchronously. Released lease cannot become visible again.                                                                                                                                                                                                                        |
| requestFrame                          | One pending demand count, invalidate attached producer once, return idempotent release. Works before producer. Success fulfills only pre-dispatch pending leases, then decrements demand; cancel removes unfulfilled demand. Does not itself create RAF, resolve a fake frame or advance elapsed.                                                                                                                                                                                                             |
| dispose                               | Increment generation, terminal disposed; clear producer, requests and frame listeners, notify state listeners once, then clear them. Invalidate/release tokens become harmless. subscribe on terminal handle synchronously receives disposed and returns no-op; attachView/requestFrame throw source-disposed. Other handles unaffected.                                                                                                                                                                      |

Demand callbacks receive `{visibleViews,pendingFrames}` on actual count changes and once on attach; reentrant changes are applied synchronously without resurrecting released callbacks. Frame subscribers and state subscribers are independent of view count: mere subscription does not request perpetual production. Every View must attach one visibility lease, release it and both subscriptions on rebind/unmount. Views can precede Source. Each request belongs to its handle and is never transferred during rebind. Caller-owned source disposal and Source producer detach are distinct.

### Producer allocation/reset policy

Source reserves its producer token while mounted, including zero demand, so a duplicate cannot steal its handle. **No visible views and no pending frame leases means release the hidden GPU Canvas immediately**, while retaining only the exclusive producer reservation and small subscriptions. Before release call resetProducer and clear publication subscription; source becomes loading with a new generation. Initial zero-demand source never mounts WebGL. New demand mounts a fresh Canvas (lazyLoad forcibly false, active iff visibleViews>0), starts elapsed at current resolved uTime and publishes only after its new completed render. One-shot pending requests permit mount/draw while active=false; they do not resume time. When their completed frame leaves zero demand, release again. Canvas creation-option remount and context loss likewise rotate token before old callbacks can publish. Source unmount/rebind detaches the current token **before** renderer teardown. Never dispose the caller's handle.

Source default CSS render dimensions width=1024/height=1024, finite positive inputs rounded to at least1; invalid uses1024. Producer wrapper is visually hidden, decorative and noninteractive with real nonzero layout (offscreen absolute placement, not display:none or intersection-driven production). Source/View requested pixelDensity defaults1, finite positive clamped to `[.25,2]`; maxDimension defaults2048, finite positive integer clamped `[1,4096]`. Source independently scales effective DPR down when needed to keep each buffer edge at most maxDimension (possibly below .25 due to the edge cap); it does not change aspect ratio. View uses the same cap with observed wrapper CSS dimensions. Requested width/height do not cause gratuitous renderer recreation. Source `canvas` cannot override source-owned active/pixelDensity/layout/children/fallback; any supplied lazyLoad is ignored/forced false, and preserveDrawingBuffer remains false by default.

Integer raster quantization clamps every positive-source drawing-buffer edge to at least1, including `1024×512,maxDimension=1` and extreme wide/tall layouts. CSS dimensions, camera aspect and effective DPR are unchanged. Owned Canvas corrects the default framebuffer/viewport and reports its actual backing dimensions; owned grain targets normalize integer pixel sizes before allocation, retaining official composer DPR/CSS sizing and ownership. This does not alter consumer-owned host renderers. Actual r186 evidence reproduced a `1×0` DOM canvas and incomplete `1×.5` grain target before correction, then complete `1×1` raw/grain output for all twelve variants, including HDR glass.

On Source setup, callbacks route current Canvas/gradient errors through source.setProducerState(error) and current Source onError; user nested callbacks still receive the error once. Source forwards camera callbacks and gradient settings reactively; children are extra native scene content under the same producer Canvas. A nested CanvasScene `onReady` gives lifecycle for subscribeAfterRender/invalidate and subscribeEnvironment, not DOM discovery. Source publishes only when lifecycle.environmentState is disabled or ready; loading keeps source loading and suppresses publication, error sets the same environment GradientError on the source and suppresses publication. A current loading/disabled/ready transition clears only a prior environment error, sets source loading, and requests a fresh completed render before publication. Merely editing color does not clear a still-failed HDR. Changing lightType/envPreset/basePath triggers F11's real state transition; fresh renderer generation initializes from current settings. Renderer/context errors clear only on a new Canvas generation/restoration, not HDR completion. On environment loading, clear old readiness/pixels immediately even if a previous HDR was ready. No retry, false ready fallback copy, new public Gradient prop or per-frame Svelte state. F15 removes environment and frame subscriptions before resetting/detaching its producer.

### View layout and late frames

A View owns wrapper + canvas and a CSS-dimension observer. It clears 2D pixels whenever source state ceases ready, on rebind and on source teardown. `fallback(state)` is shown whenever not ready, and during a rebind/resize until a fresh valid frame has actually been copied (state still uses current handle snapshot; no fabricated source status). Hidden views do not copy. Visibility is wrapper intersection, with defaults threshold0/rootMargin0px; missing IntersectionObserver means visible. Zero CSS size means no drawable view and no visible demand until nonzero.

If ResizeObserver is unavailable, measure once after client mount and use an owned window `resize` listener; remove that listener on teardown. This fallback detects window resizes, not arbitrary element-only layout changes without a window resize. It does not poll or add a RAF loop. The edge cap above is the only backing-resolution cap; no separate area rule is introduced.

On visible mount/reentry, handle replacement or CSS/DPR resize, cancel old unfulfilled lease, request one fresh source frame and wait for synchronous subscribeFrames delivery. Do not copy an old canvas immediately on readiness/resize, use an independent RAF, or assume preserveDrawingBuffer is necessary. In callback validate current bound handle, current token generation against source.state.generation, ready status and visible/nonzero size; then draw synchronously. Centered cover crop uses `scale=max(viewBufferW/sourceW,viewBufferH/sourceH)`, source rectangle `(sourceW-viewBufferW/scale)/2,(sourceH-viewBufferH/scale)/2,viewBufferW/scale,viewBufferH/scale`; draw into whole bounded View buffer. Use actual source frame width/height, not CSS size. Copy error clears pixels, reports copy error to current View callback, never claims successful ready display. No asynchronous canvas retention, global source IDs, RAF ticker or independent copied-view camera interaction.

## Consumer acceptance scenarios and ownership review

F04 consumes only core inventory and migrates old adapters without changing their query/time/renderer semantics. F05 publishes no runtime stubs. F06 returns full settings for defaults/false/zero/query edge cases and raw numeric time math. F07 proves stable SSR/hydration/client/fallback/context-loss and in-place size/DPR/FOV. F08 renders all twelve variants and ten preset mesh projections. F09 proves frozen delta resume/seek/negative modulo/material replacement. F10 proves degree/precision/gesture/rest and host camera restoration. F11 proves selected HDR/self-host/error/stale texture cleanup. F12 proves grain replacement + one completion notification and axes cleanup. F13 proves two sibling managed owners reject even under an external Threlte Canvas, multiple external meshes coexist, and forbidden external props fail type checking. F14–F16 prove views-before-producer, no-demand release, paused resize, late rebind, duplicate rejection, synchronous copies and generation-safe teardown for two request-isolated handles. F19 integrates only real exports; F22 owns type/contract fixtures; F23–F27 own browser/resource evidence, not declarations here.

Every resource has exactly one cleanup owner: Canvas/Threlte renderer; Canvas listener/context release; bridge scheduler registrations; Mesh geometry/material; camera controls/listeners; environment texture/ambient; composer targets and individual passes; axes helper; Source producer/frame subscription; View canvas/subscriptions/observers/request/visibility leases; caller source handle. Managed lease release follows helper teardown. Host camera/environment/renderer and other owners' resources are borrowed, never disposed. No claimed checks were run by F01; parent reviews/types/checks the integrated implementation later.

## Development-consumer fixture boundary (F17/F18 → F23–F27)

This is an **app-local test contract**, not a production package export or instrumentation requirement. F17 and F18 each declare the same structural `window.gradientFixture` interface below in their own app-local module; SSR never touches window. Install on client mount and delete only the still-owned instance on teardown/HMR. F23–F27 feature/lifecycle/performance tests use this exact common surface. F19 owns the later optional `mirrors` extension for mirror tests; do not fabricate mirror operations in F17/F18.

```ts
// Types below are app-local. Imports are type-only native public types.
interface FixtureCanvasConfig {
  pixelDensity?: number
  fov?: number
  envBasePath?: string
  respectReducedMotion?: boolean
  lazyLoad?: boolean
  threshold?: number
  rootMargin?: string
  preserveDrawingBuffer?: boolean
  powerPreference?: WebGLPowerPreference
  pointerEvents?: 'none' | 'auto'
}
interface FixtureExternalConfig {
  enabled: boolean
  gradients: ExternalSettingsInput[]
}
interface FixtureMeshObservation {
  uuid: string
  geometryUuid: string
  materialUuid: string
  geometryType: string
  materialType: string
  shader: ShaderName
  type: GradientType
  position: [number, number, number]
  rotationRadians: [number, number, number]
  wireframe: boolean
  roughness: number
  time: number
  loop: number
  loopDuration: number
  colors: [
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ]
  // Monotonic app-local identity assigned to the actual uniform container.
  uniformsIdentity: number
}
interface FixtureErrorObservation {
  code: string
  message: string
}
interface FixtureObservation {
  revision: number
  mounted: boolean
  visible: boolean
  reducedMotion: boolean
  fallback: CanvasFallbackState['status'] | null
  canvas: null | {
    // App-local identity of the actual WebGL canvas and renderer.
    identity: number
    rendererIdentity: number
    cssWidth: number
    cssHeight: number
    bufferWidth: number
    bufferHeight: number
    dpr: number
    contextLost: boolean
  }
  scene: null | {
    uuid: string
    cameraUuid: string
    environmentUuid: string | null
    camera: {
      fov: number | null
      zoom: number
      position: [number, number, number]
    }
    meshes: FixtureMeshObservation[]
    axesVisible: boolean
  }
  externalHost: null | {
    sceneUuid: string
    cameraUuid: string
    environmentUuid: string | null
    // These identities are read from actual host objects before gradients mount.
    initialCameraUuid: string
    initialEnvironmentUuid: string | null
    rendererIdentity: number
    initialRendererIdentity: number
    gradientMeshCount: number
  }
  cameraUpdates: CameraUpdate[]
  errors: FixtureErrorObservation[]
  counters: {
    completedFrames: number
    rendererCalls: number
    copyCalls: number | null
    geometryDisposals: number
    materialDisposals: number
    textureDisposals: number
    passDisposals: number | null
    targetDisposals: number | null
    rendererDisposals: number
    contextLosses: number
  }
}
interface GradientFixture {
  readonly version: 1
  update(patch: GradientSettingsInput): Promise<FixtureObservation>
  configureCanvas(patch: FixtureCanvasConfig): Promise<FixtureObservation>
  snapshot(): FixtureObservation
  lifecycle: {
    setMounted(mounted: boolean): Promise<FixtureObservation>
    setVisible(visible: boolean): Promise<FixtureObservation>
    // Explicit redraw, never an animation restart or a wall-time seek.
    requestFrame(): Promise<FixtureObservation>
  }
  externalHost: {
    configure(config: FixtureExternalConfig): Promise<FixtureObservation>
    // Removes native gradient children while keeping the host Canvas alive.
    clear(): Promise<FixtureObservation>
  }
  // F19 replaces this reserved unknown with its exact local mirror interface.
  mirrors?: unknown
}
declare global {
  interface Window {
    gradientFixture?: GradientFixture
  }
}
```

`update` merges defined settings into the app's current managed props (control/urlString included); use explicit halo props to reset to a preset, not a hidden reset convention. External configure replaces its external input list, with each gradient rendered as mode external in a separate consumer-owned Threlte Canvas. That host has its own real camera/environment and a simple non-native host mesh, so removing gradients can demonstrate host output survival. Host initial identities are captured at actual host creation, not recomputed from current values. External config does not use managed-only props. `clear` leaves host renderer/camera/environment live and sets native gradient count to zero. Disabling external host intentionally tears down that host and returns externalHost null.

`snapshot()` is synchronous and non-rendering; it reads current **actual** DOM/Threlte scene/material/uniform/renderer data via app-local child probes under each real Threlte Canvas. Requested settings are not observations. The app may keep object references in ordinary variables, assign WeakMap identity numbers, observe completed render stages with public Threlte hooks, and listen to real resource dispose events or wrap actual instance dispose/render/drawImage methods with cleanup. Consumer fixtures use public package imports only: no native private-source imports, aliases or production debug API. A post-render probe must observe actual render calls and run after final composition, not count idle scheduler ticks as completed frames. Such probes remain entirely in dev apps, never production package code. Enumerate gradient meshes by actual probe refs/name, not every host mesh. Arrays/serialized snapshots allocate only when the harness requests them, never in production frame paths. No canned counters, fake UUIDs, inferred readiness, global Three mutation or production debug props. Start observed event counts at zero when instrumentation attaches; unavailable copy/pass/target probes are null, never invented zero. F27 must instrument/measure a null metric before claiming it. `copyCalls` remains null until a real F19 mirror probe exists.

Every mutating operation increments revision once and awaits Svelte synchronization plus the next **actual completed** affected render. Install its completion subscription before invalidation; do not resolve from `tick()` alone, a created renderer, RAF arrival or arbitrary sleep. Resolve mounted=false/hidden lazy teardown and external clear only after the app's effects/owned cleanup have run; no render is expected for a deliberately removed Canvas. When lazy hidden, update/configure may resolve after synchronized deferred state instead of force-mounting it. A paused visible update still explicitly invalidates and waits for completed output. A current known environment error/unsupported/context-lost state returns the observed error/fallback after synchronization rather than waiting forever for a successful render; snapshots retain the error. In an otherwise eligible scene, missing completion rejects with an actionable fixture timeout (10 seconds), never a fabricated success. External operations wait for the external host render, ordinary operations wait for the native Canvas render. Consumers must await the promise before inspecting snapshots/images.

Visibility operation changes real wrapper placement so IntersectionObserver observes viewport entry/exit; `visible` reads the last actual intersection/nonzero-size result. Motion tests use browser media emulation and observe actual lifecycle reducedMotion; there is no fake fixture motion flag. Context-loss tests use the actual WebGL lose-context extension in the harness, not a synthesized error. Route/navigation and touch/mouse interactions remain real browser operations. Install probes before creating measured resources and clean all listeners/wrappers with the app subtree so 100-cycle tests count real teardown paths. No fixture claim here constitutes observed F23–F27 evidence.

## Source and API evidence

Canonical behavior inspected: React `ShaderGradient.tsx:11–42` merges halo then replaces with query; Vue `ShaderGradient.ts:67–88` uses typed merge, `:152–187` delta/time, `:190–279` camera, `:281–356` environment/composer; React `Controls/CameraControl.tsx:24–100` supplies chosen precision/bindings; canonical `presets.ts:4–49` supplies halo. Vue `material.ts:16–113` supplies material-local adaptation/uniforms. Vue global source registry and renderer teardown are explicitly **not** design precedents.

Primary APIs consulted: [Svelte context](https://svelte.dev/docs/svelte/context) (createContext introduced5.40), [Threlte useTask](https://threlte.xyz/docs/reference/core/use-task/) (autoInvalidate/running/render replacement), [useThrelte](https://threlte.xyz/docs/reference/core/use-threlte/) (renderStage/autoRenderTask/shouldRender), [Canvas-scoped user context](https://threlte.xyz/docs/reference/core/use-threlte-user-context/) (existing skip), [disposal](https://threlte.xyz/docs/learn/basics/disposing-objects/). Context7 Threlte lookup supplemented these primary pages. These establish API choices, not completed native compatibility or rendering tests.
