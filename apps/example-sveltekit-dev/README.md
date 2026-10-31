# Native SvelteKit workspace consumer

This app consumes the public workspace `@shadergradient/svelte` and `@shadergradient/core` packages. It uses SvelteKit 3.1.0, Svelte 5.57.3, Threlte 8.6.1 and Three 0.186.1. Node **22.17 or newer** is required; the scoped toolchain does not change legacy consumers.

From the repository root, after installing workspace dependencies and building core/native packages:

```sh
pnpm --filter example-sveltekit-dev dev
pnpm --filter example-sveltekit-dev check
pnpm --filter example-sveltekit-dev build
pnpm --filter example-sveltekit-dev preview --host 127.0.0.1 --port 3111
HOST=127.0.0.1 PORT=3111 ORIGIN=http://127.0.0.1:3111 pnpm --filter example-sveltekit-dev serve
```

`serve`/`start` run the actual adapter-node production output. `preview` is Vite's local production preview, not the deployment server. Kit configuration is inline in `vite.config.ts`; `svelte-kit sync` generates this app's own `node_modules/$app` for the `$app/tsconfig` base.

## SSR and navigation

The main route server-renders its article, navigation, accessible controls and stable dimensioned native fallbacks. Native Canvas supplies the browser mount boundary; neither page SSR nor surrounding content is disabled. The host-owned Threlte Canvas separately mounts only after the page's `onMount` because bare Threlte emits a server canvas. No scene or HDR fetch is started by the load function.

`/?request=coral&color1=%23ff7044` and `/?request=ocean&color1=%232280cc` demonstrate distinguishable request data. The request label and initial color are rendered in HTML, and each route instance owns its settings and observer. The full request query is passed to native typed query handling. Controls switch back to explicit-prop mode; presets spread the public native preset props. `/away` removes the whole consumer tree, including its fixture, and links back to recreate it.

The independent scene has its own color and mount controls. The external-host controls create two external gradients under a consumer-owned Threlte Canvas with its own camera, environment texture and white cube; clear removes only native gradients, while disable destroys that host. HDR uses the native default remote manifest unless `configureCanvas({ envBasePath })` supplies a self-hosted base. The asset-failure button intentionally exercises a nonexistent same-origin HDR directory and displays actual typed callback errors.

## Browser fixture v1

`window.gradientFixture` is app-local, installed only after client mount, and removed only if still owned on teardown/HMR. Its exact `update`, `configureCanvas`, `snapshot`, `lifecycle` and `externalHost` shapes are declared in `src/lib/fixture-types.ts`. Source/View and the optional mirrors extension are intentionally reserved for their integration owner.

The child probe uses public `useThrelte`, `useStage` and `useTask` only. A separate scheduler stage runs after the entire native render stage. It counts a completed frame only when the wrapped actual renderer has successfully rendered to the screen, including the final composer pass. It does not count idle scheduler ticks. Observations serialize actual scene objects, public material uniforms, geometry/material variants, canvas dimensions and resource identities only when a snapshot is requested. No native private context or production debug prop is used.

Mutations subscribe before updating, synchronize Svelte and explicitly invalidate the affected renderer. They require a new actual completed frame with final wrapper/CSS/renderer/buffer dimensions and requested DPR/FOV, rather than resolving on an intermediate old-size frame. Deferred hidden/unmounted scenes and real errors return synchronized observations without manufacturing output. Eligible missing completions reject after 10 seconds. Visibility moves the real wrapper offscreen and awaits actual intersection/teardown. Motion is observed from browser media preference; it is never simulated by a fixture boolean. Ordinary snapshots do not invalidate, so native passive invalidations can be measured independently.

### Measurement limits

- Geometry/material/texture disposal counts are **observed dispose events** on actual resources attached to the instrumented native or external-host scene. Unattached late HDR candidates and framework-internal temporary resources are not covered. The independent unprobed scene is not included.
- Renderer calls count real calls, including composer internal passes. Completed frames count screen-output-bearing scheduler completions, not every renderer call.
- Renderer disposal wraps the actual instance through framework teardown. This relies on inspected Threlte 8.6.1 behavior, which dynamically calls `renderer.dispose()` at cleanup; it is not a general certification for other revisions or failed renderer construction before the probe exists.
- Context-loss counts are actual `webglcontextlost` events observed while the probe listener is attached. A zero count after teardown does **not** certify release: detached-canvas events may arrive after listener cleanup. Tests should separately check actual contexts and host survival.
- Composer pass/target disposal and mirror-copy metrics are unavailable here and explicitly **null**, not invented zeros. They require separately scoped instrumentation before performance claims.
- These counters are not GPU-memory accounting or evidence that a scenario has been executed. Browser/SSR/build qualification is owned by the integration runner.
