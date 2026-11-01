# Glass Studio · Next.js

An interactive material study using the public `@shadergradient/react` package.
One SDK Canvas renders a procedural glass subject, city HDR reflections and real
opaque scene content. It does not substitute a separate demo-only glass material.

## Run locally

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadergradient/core build
pnpm --filter @shadergradient/react build
pnpm --filter example-nextjs-dev exec next dev --hostname 127.0.0.1 --port 3004
```

Open <http://localhost:3004/>. The example uses React 18, Fiber 8.18.0 and Three
r169. Its Fiber instance must match the SDK's instance: mixing 8.12 hooks with
an 8.18 Canvas creates separate contexts and fails initialization. The workspace
lock and declaration-peer bindings preserve this lane alongside native/Vue r186;
no global renderer upgrade or private SDK source alias is required.

## What to inspect

- **Sphere:** a closed, gently deformed volume. Look for curved grid lines,
  displacement of the colored scene objects and reflected environment highlights.
- **Plane / Water:** open sheets, not solid lenses or closed water volumes.
  Their folds and waves change the straight scene detail behind them.
- **Tint / Roughness / Deformation:** change the actual SDK material/uniforms.
  Roughness maps to the public `reflection` prop as `1 - roughness`.
- **Backdrop:** lines reveal bending; checker tiles reveal surface distortion.
  These are opaque Three meshes in the same renderer, not CSS illustrations.
- **Show glass:** hides only the subject's Three group, keeping camera, lighting,
  material and paused time intact for an unobstructed comparison.
- **Reset view:** resets only the camera. **Reset all** restores the complete
  initial study, including deformation time. Motion starts paused when the
  browser requests reduced motion; explicit resume remains available.

Physical transmission samples the renderer's opaque scene buffer. It cannot
refract a CSS background, underlying DOM, or arbitrary transparent content.
HDR lighting supplies the reflection cues; polished glass against an empty scene
may otherwise be difficult to see. These are real-time Three physical-material
approximations, not an offline ray-traced optical simulation.

The scoped studio palette remains readable under light and dark preferences.
Controls have DOM labels, focus indicators and keyboard-operable ranges; narrow
layouts keep the viewport and controls within the document width.

## Failure and validation

The studio reports real scene/HDR initialization failures, shader compilation
failures and WebGL context loss. It does not label a replacement material as
successful glass. Reload after fixing network or graphics availability. Remote
HDR assets require connectivity and CORS; see the repository HDR manifest/local
asset guidance for application hosting.

Integration checks include actual rendered sphere/sheet comparisons, stable
material and camera state, keyboard range changes, mobile themes, HDR failure
and late completion, and actual context loss/reload. A typecheck or linked shader
alone is not visual acceptance. The app is currently a development preview;
known pre-existing production Next lint failures are not suppressed. Full final
release qualification remains a separate unchanged-candidate gate.

The existing `/customize-simple` and `/loop` examples remain available.
