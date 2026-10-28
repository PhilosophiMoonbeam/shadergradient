# Gotchas

High-frequency failure patterns.

Freshness: pinned to `ebb4f7e28ee4db71d19109656cba80fb10eabe2c`.

## Context and structure

| Symptom                            | Check                                                     | Source                                                 |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Hook throws or undefined context   | Ensure component is under `<Canvas>`                      | `apps/docs/src/content/learn/basics/app-structure.mdx` |
| Scene randomly fails in larger app | Prefer single `<Canvas>` to avoid too many WebGL contexts | `apps/docs/src/content/learn/basics/app-structure.mdx` |

## Render loop and scheduling

| Symptom                        | Check                                                                       | Source                                                    |
| ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Nothing updates in manual mode | `renderMode='manual'` needs explicit `advance()` / invalidation             | `apps/docs/src/content/learn/basics/render-modes.mdx`     |
| Stutter or wrong order updates | Verify task stages/dependencies (`before`/`after`)                          | `apps/docs/src/content/learn/basics/scheduling-tasks.mdx` |
| Too many rerenders             | Consider `useTask(..., { autoInvalidate: false })` with manual invalidation | `apps/docs/src/content/reference/core/use-task.mdx`       |

## Props and object lifecycle

| Symptom                                | Check                                                                                 | Source                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime issues after prop shape change | Keep inferred prop type constant for component lifetime                               | `apps/docs/src/content/learn/getting-started/your-first-scene.mdx` |
| Memory growth after unmount            | Auto-disposal covers `<T>`-owned refs; external/shared assets may need manual dispose | `apps/docs/src/content/learn/basics/disposing-objects.mdx`         |

## Loading and suspense

| Symptom                                   | Check                                                         | Source                                                |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Loader usage fails in callback-only setup | Instantiate `useLoader(...)` at top level; call `.load` later | `apps/docs/src/content/reference/core/use-loader.mdx` |
| Suspense fallback behavior confusing      | One slot shown at a time; unmount drops suspended child state | `apps/docs/src/content/reference/extras/suspense.mdx` |
| Draco decode blocked offline              | `useDraco` defaults to Google CDN; use local path if needed   | `apps/docs/src/content/reference/extras/gltf.mdx`     |

## SSR and integration

| Symptom                             | Check                                          | Source                                                       |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| SSR build issues with controls libs | Add package to `ssr.noExternal` where required | `apps/docs/src/content/reference/extras/camera-controls.mdx` |

## Physics, XR, Flex specifics

| Symptom                                           | Check                                                       | Source                                                       |
| ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Rapier components no-op                           | Ensure physics nodes are inside `<World>`                   | `apps/docs/src/content/reference/rapier/world.mdx`           |
| Unexpected Rapier constraints in app architecture | Current note: one Rapier-enabled Threlte instance           | `apps/docs/src/content/reference/rapier/getting-started.mdx` |
| XR objects always in scene                        | Put XR-only objects inside `<XR>` if session-scoped desired | `apps/docs/src/content/reference/xr/getting-started.mdx`     |
| Flex layout wrong size                            | `<Flex>` needs explicit width/height container size         | `apps/docs/src/content/reference/flex/getting-started.mdx`   |
