# THRELTE KNOWLEDGE BASE

Large vendored skill. Contains commit-pinned docs and a very large example set.

## STRUCTURE

```tree
threlte/
├── SKILL.md
├── references/                 # routing, workflows, gotchas, source-index
├── scripts/
│   └── sync-docs.sh            # refresh vendored docs/examples metadata
├── docs/                       # vendored MDX docs content
└── examples/                   # vendored Svelte/TS/GLSL examples
```

## WHERE TO LOOK

| Task                              | Location                                  | Notes                        |
| --------------------------------- | ----------------------------------------- | ---------------------------- |
| Route question to exact docs path | `references/routing-map.md`               | Primary lookup index         |
| Choose package lane               | `references/package-cheatsheet.md`        | `core`/`extras`/`rapier`/etc |
| Debug known issues                | `references/gotchas.md`                   | High-frequency failures      |
| Find snippet                      | `references/examples.md` then `examples/` | Prefer pinned examples       |
| Refresh vendored content          | `scripts/sync-docs.sh`                    | Source-of-truth sync path    |

## LOCAL CONVENTIONS

- Respect commit-pinned freshness in skill metadata.
- Prefer `references/` for routing; use `docs/` and `examples/` as backing corpus.
- Keep responses package-lane aware and aligned with docs navigation order.

## ANTI-PATTERNS

- Do not hand-edit vendored `docs/` or `examples/` as normal maintenance.
- Do not answer with random example paths without routing-map confirmation.
- Do not ignore freshness limits when user asks about newer behavior.
