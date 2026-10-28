---
name: threlte
description: Routes Threlte questions to exact, commit-pinned docs paths and practical workflows. Use when helping with setup, debugging, or architecture across @threlte/core, @threlte/extras, @threlte/gltf, @threlte/rapier, @threlte/theatre, @threlte/xr, @threlte/flex, and @threlte/studio.
license: MIT
metadata:
  author: kjanat
  version: "1.0"
---

# Threlte

Use for Threlte docs routing and implementation guidance.

## Scope and freshness

- Primary sources:
  - `https://threlte.xyz/`
  - `https://github.com/threlte/threlte`
  - `apps/docs` at commit `ebb4f7e28ee4db71d19109656cba80fb10eabe2c`
- Freshness constraint: guidance is only as up to date as that commit SHA.
- If user asks about newer behavior, state uncertainty and recommend checking latest docs/commits.

## Fast triage

```txt
What does user need?
├─ Concepts, onboarding, architecture
│  └─ Use Learn track first
│     (getting-started -> basics -> advanced)
│
└─ Exact API, props, hooks, components, plugins
   └─ Use Reference track first
      (core -> extras -> gltf -> rapier -> theatre -> xr -> flex -> studio)
```

## Defaults

- Start small: answer directly, then attach exact docs paths.
- Route to `@threlte/core` first unless user explicitly asked package-specific topic.
- Prefer one recommended path; avoid giving many equivalent options.
- Prefer exact snippets from `references/examples.md` or `examples/` mirror.
- For runtime bugs, check `references/gotchas.md` before deep dives.
- Keep package order aligned with docs navigation.

## Response workflow

1. Classify request: Learn vs Reference.
2. Pick package lane from `references/package-cheatsheet.md`.
3. Pull exact path bundle from `references/routing-map.md`.
4. If task-like request, follow matching flow in `references/workflows.md`.
5. Run gotcha scan from `references/gotchas.md`.
6. Include freshness note when recency could matter.

## Reading Order

| Task                         | Files to read                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| New to Threlte               | `SKILL.md` -> `references/package-cheatsheet.md` -> `references/workflows.md` |
| Route docs quickly           | `SKILL.md` -> `references/routing-map.md`                                     |
| Pull exact snippet           | `references/examples.md` -> `examples/`                                       |
| Fix broken scene/render loop | `references/workflows.md` -> `references/gotchas.md`                          |
| Choose package               | `references/package-cheatsheet.md`                                            |
| Verify source/freshness      | `references/source-index.md`                                                  |

## In This Reference

| File                               | Purpose                            |
| ---------------------------------- | ---------------------------------- |
| `references/routing-map.md`        | Intent -> exact docs paths         |
| `references/workflows.md`          | Top implementation/debug workflows |
| `references/examples.md`           | Commit-pinned exact snippets       |
| `references/gotchas.md`            | High-frequency failure patterns    |
| `references/package-cheatsheet.md` | Package selection and entry docs   |
| `references/source-index.md`       | Canonical sources and commit pin   |
