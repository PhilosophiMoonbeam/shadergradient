# Package Cheatsheet

Pick package lane fast.

Freshness: pinned to `ebb4f7e28ee4db71d19109656cba80fb10eabe2c`.

| Package            | Use for                                                      | Start docs                                                    | Then                                                      | Local examples                         |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| `@threlte/core`    | Canvas, `<T>`, runtime context, scheduler/hooks              | `apps/docs/src/content/reference/core/getting-started.mdx`    | `t.mdx`, `use-task.mdx`, `use-loader.mdx`                 | `skills/threlte/examples/core/`        |
| `@threlte/extras`  | Controls, interactivity, loaders, suspense, helpers          | `apps/docs/src/content/reference/extras/getting-started.mdx`  | `orbit-controls.mdx`, `interactivity.mdx`, `suspense.mdx` | `skills/threlte/examples/extras/`      |
| `@threlte/gltf`    | Generate reusable Svelte components from GLTF                | `apps/docs/src/content/reference/gltf/getting-started.mdx`    | `learn/basics/loading-assets.mdx`                         | `skills/threlte/examples/extras/gltf/` |
| `@threlte/rapier`  | Physics world, rigid bodies, colliders, joints               | `apps/docs/src/content/reference/rapier/getting-started.mdx`  | `world.mdx`, `rigid-body.mdx`, `auto-colliders.mdx`       | `skills/threlte/examples/rapier/`      |
| `@threlte/theatre` | Timeline/authoring animation integration                     | `apps/docs/src/content/reference/theatre/getting-started.mdx` | `theatre/studio.mdx`, `sheet-object.mdx`                  | `skills/threlte/examples/theatre/`     |
| `@threlte/xr`      | WebXR session, controllers, hands, teleport/pointer controls | `apps/docs/src/content/reference/xr/getting-started.mdx`      | `pointer-controls.mdx`, `teleport-controls.mdx`           | `skills/threlte/examples/xr/`          |
| `@threlte/flex`    | Yoga-based 3D flex layouts                                   | `apps/docs/src/content/reference/flex/getting-started.mdx`    | `flex.mdx`, `box.mdx`, `create-class-parser.mdx`          | `skills/threlte/examples/flex/`        |
| `@threlte/studio`  | Scene tooling/editor-like authoring workflows                | `apps/docs/src/content/reference/studio/getting-started.mdx`  | `extensions.mdx`, `deploying-to-production.mdx`           | `skills/threlte/examples/studio/`      |

## Heuristics

- Start `@threlte/core` unless user already selected package.
- Route to `@threlte/extras` for controls/interactions/loading UX.
- Route to `@threlte/gltf` for model pipeline and reuse.
- Route to `@threlte/rapier` when words like physics, collider, rigid body appear.
- Route to `@threlte/xr` when words like VR, AR, headset, controller appear.
