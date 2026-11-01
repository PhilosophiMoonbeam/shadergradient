# React Color Studio

A linked workspace demo of the public `@shadergradient/react` package, not an independent packed starter. This is the React 18 lane, not the obsolete registry/React 19 example.

## Run

From the repository root, using the repository-supported Node and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/react build
pnpm --filter example-react-dev dev --host 127.0.0.1 --port 3009 --strictPort
```

Open `http://127.0.0.1:3009/`. The managed browser integration server instead uses port 3109 for the `react-studio` and `react-studio-mobile` projects. The app also supports:

```sh
pnpm --filter example-react-dev typecheck
pnpm --filter example-react-dev build
```

The app imports `apps/demo-studio.css` directly. Its dependencies are pinned to React/ReactDOM 18.3.1, Fiber 8.18.0, Three and Three types 0.169.0, TypeScript 5.7.3 and Vite 8.2.1. JSX uses explicit React imports and Vite’s built-in transform; no React plugin or SDK source alias is needed. React, ReactDOM, Fiber and Three are deduplicated in the Vite configuration.

## Explore

- Choose any of the ten complete Core presets. Selection and Reset apply the entire preset, including camera, geometry, lighting/HDR, grain and motion. Reset deliberately restarts shader time.
- Combine four shader families with three geometries. Shape changes reframe the camera. Palette, speed, deformation, reflection, grain and camera/light edits are real public SDK props and are labeled as remixes.
- Glass is a separately labeled recommended study, not an exact Core preset. It uses the SDK’s unmodified physical material, City HDR and opaque Fiber geometry behind it. Sphere is a closed volume; plane and water plane are open sheets. Switching to glass intentionally applies pale tints and recommended framing/light/surface settings.
- Camera & light contains keyboard-accessible alternatives to dragging and scrolling. HDR selection is disabled under ambient lighting; ambient brightness is disabled under HDR because that SDK setting does not affect environment light.
- Reduced motion is read before the canvas mounts. It starts paused when requested; Resume is an explicit override. Once ready, pause switches the existing Fiber root to demand rendering while edits, resizing and camera gestures can still invalidate it. No second animation loop is created.
- Pause snapshots the actual SDK material’s shader-time uniform through the existing Fiber scene and supplies it back using the public `uTime` prop. Paused palette, reflection, lighting, shader/shape and camera edits retain that phase even when the scalar SDK material is reconstructed. The app does not synthesize time or update React state per frame. Resume intentionally starts a new SDK motion cycle at time zero, matching the SDK’s restarted local animation clock; it does not claim to continue the held phase. Preset selection and Reset remain explicit seeks.

Readiness observes the real SDK mesh, rendered frames, a live WebGL context and (when required) the actual scene environment. Scene/HDR exceptions, shader compiler errors and context loss show a persistent semantic error with Reload rather than a substitute preview. HDR mode needs network access to the SDK’s public environment assets. Declarative backdrop objects are Fiber-owned and disposed on unmount; renderer listeners, debug hooks, loading timers and motion-preference listeners have matching cleanup.
