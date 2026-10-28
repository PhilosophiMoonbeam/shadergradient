# Workflows

Top Threlte workflows with exact docs + local example targets.

Freshness: pinned to `ebb4f7e28ee4db71d19109656cba80fb10eabe2c`.

## Universal checklist

1. Confirm package lane.
2. Read one Learn/Reference entry page first.
3. Pull one exact snippet from docs/examples.
4. Apply gotcha scan from `gotchas.md`.
5. Validate fix in minimal repro/example.
6. If still failing, pick next gotcha and repeat step 5.
7. If recency matters, add commit-pin warning.

## 1) Bootstrap first scene

- Docs:
  - `apps/docs/src/content/learn/getting-started/introduction.mdx`
  - `apps/docs/src/content/learn/getting-started/installation.mdx`
  - `apps/docs/src/content/learn/getting-started/your-first-scene.mdx`
- Local examples:
  - `skills/threlte/examples/first-scene/step-1/`
  - `skills/threlte/examples/first-scene/step-7/`

## 2) Fix context/hook placement issues

- Docs:
  - `apps/docs/src/content/learn/basics/app-structure.mdx`
  - `apps/docs/src/content/reference/core/canvas.mdx`
  - `apps/docs/src/content/reference/core/use-threlte.mdx`
- Local examples:
  - `skills/threlte/examples/core/three-arcade-game/`

## 3) Tune render loop and scheduling

- Docs:
  - `apps/docs/src/content/learn/basics/render-modes.mdx`
  - `apps/docs/src/content/learn/basics/scheduling-tasks.mdx`
  - `apps/docs/src/content/reference/core/use-task.mdx`
  - `apps/docs/src/content/reference/core/use-stage.mdx`
- Local examples:
  - `skills/threlte/examples/core/three-arcade-game/`

## 4) Build asset/model loading pipeline

- Docs:
  - `apps/docs/src/content/learn/basics/loading-assets.mdx`
  - `apps/docs/src/content/reference/core/use-loader.mdx`
  - `apps/docs/src/content/reference/extras/use-gltf.mdx`
- Local examples:
  - `skills/threlte/examples/extras/use-gltf/`
  - `skills/threlte/examples/extras/use-progress/`

## 5) Enable controls and pointer interactivity

- Docs:
  - `apps/docs/src/content/reference/extras/orbit-controls.mdx`
  - `apps/docs/src/content/reference/extras/interactivity.mdx`
  - `apps/docs/src/content/reference/extras/interaction.mdx`
- Local examples:
  - `skills/threlte/examples/extras/orbit-controls/`
  - `skills/threlte/examples/extras/interactivity/`

## 6) Add Suspense-based loading UX

- Docs:
  - `apps/docs/src/content/reference/extras/suspense.mdx`
  - `apps/docs/src/content/reference/extras/onSuspend.mdx`
  - `apps/docs/src/content/reference/extras/onReveal.mdx`
- Local examples:
  - `skills/threlte/examples/extras/suspense/`

## 7) Start physics with Rapier

- Docs:
  - `apps/docs/src/content/reference/rapier/getting-started.mdx`
  - `apps/docs/src/content/reference/rapier/world.mdx`
  - `apps/docs/src/content/reference/rapier/rigid-body.mdx`
  - `apps/docs/src/content/reference/rapier/auto-colliders.mdx`
- Local examples:
  - `skills/threlte/examples/rapier/rigid-body/`
  - `skills/threlte/examples/rapier/auto-colliders/`
  - `skills/threlte/examples/rapier/framerate/`

## 8) Start animation tooling (Theatre/Studio)

- Docs:
  - `apps/docs/src/content/reference/theatre/getting-started.mdx`
  - `apps/docs/src/content/reference/theatre/studio.mdx`
  - `apps/docs/src/content/reference/studio/getting-started.mdx`
  - `apps/docs/src/content/reference/studio/deploying-to-production.mdx`
- Local examples:
  - `skills/threlte/examples/theatre/sheet-object/`
  - `skills/threlte/examples/studio/getting-started/`

## 9) Build XR baseline

- Docs:
  - `apps/docs/src/content/reference/xr/getting-started.mdx`
  - `apps/docs/src/content/reference/xr/pointer-controls.mdx`
  - `apps/docs/src/content/reference/xr/teleport-controls.mdx`
- Local examples:
  - `skills/threlte/examples/xr/vr-button/`
  - `skills/threlte/examples/xr/pointer-controls/`
  - `skills/threlte/examples/xr/teleport-controls/`

## 10) Build 3D UI layout with Flex

- Docs:
  - `apps/docs/src/content/reference/flex/getting-started.mdx`
  - `apps/docs/src/content/reference/flex/flex.mdx`
  - `apps/docs/src/content/reference/flex/box.mdx`
  - `apps/docs/src/content/reference/flex/create-class-parser.mdx`
- Local examples:
  - `skills/threlte/examples/flex/intro/`
  - `skills/threlte/examples/flex/examples/`
  - `skills/threlte/examples/flex/create-class-parser/`
