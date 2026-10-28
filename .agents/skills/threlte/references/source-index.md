# Source Index

Canonical sources and version pins for vendored content.

## Provenance

| Source                                                | Ref    | Resolved       | Date       |
| ----------------------------------------------------- | ------ | -------------- | ---------- |
| [threlte/threlte](https://github.com/threlte/threlte) | `main` | `d5f097ac2805` | 2026-10-26 |

## External references (not vendored)

- [threlte.xyz](https://threlte.xyz/) — official docs site
- [GitHub repo](https://github.com/threlte/threlte) — source code

## Re-sync

```bash
# Update to latest
bash scripts/sync-docs.sh

# Pin specific commit
bash scripts/sync-docs.sh --ref d5f097ac2805
```

## Vendored layout

- `docs/` — narrative MDX from apps/docs/src/content/ (249 files)
- `examples/` — Svelte example components from apps/docs/src/examples/ (641 files)

## Package order (from docs navigation)

1. `@threlte/core`
2. `@threlte/extras`
3. `@threlte/gltf`
4. `@threlte/rapier`
5. `@threlte/theatre`
6. `@threlte/xr`
7. `@threlte/flex`
8. `@threlte/studio`

## Freshness rule

Guidance is pinned to versions above. When user asks about newer APIs:

1. Answer with pinned guidance first
2. State version limit
3. Recommend checking latest docs
