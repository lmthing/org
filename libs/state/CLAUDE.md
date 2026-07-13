# @lmthing/state

The browser-side state layer for the web SPAs: a single in-memory virtual filesystem (`AppFS` — a flat `Map<string, string>`) with a fine-grained event bus, scoped views (`ProjectFS`/`SpaceFS`), React contexts + hooks, a `DraftStore` for unsaved edits, format parsers, and a `PodTransport` that makes the VFS a write-through cache over the compute pod's PVC.

## Source of truth

**[org/docs/](../../../../org/docs/README.md) (published at lmthing.org) is the single source of truth for this codebase** — every sentence there is cited to the implementation.

> **Full grounded reference for this package → [../../../../org/docs/libs/state.md](../../../../org/docs/libs/state.md)** — the VFS model and key layout, the `FSInterface` API, `FSEventBus`, the glob engine, every parser, `PodTransport`'s routes, the context/provider wiring, and the hook catalog.

**A code change is not done until the matching org/docs page is updated in the same change** — see [org/docs/SYNC.md](../../../../org/docs/SYNC.md). For this package that page is `org/docs/libs/state.md`.

## Run it

```bash
pnpm --filter @lmthing/state build       # tsc → dist/
pnpm --filter @lmthing/state dev         # tsc --watch
pnpm --filter @lmthing/state test        # vitest (jsdom; co-located *.test.ts[x])
pnpm --filter @lmthing/state typecheck   # tsc --noEmit
pnpm --filter @lmthing/state lint
```

Tests are co-located next to the source they cover. Hooks need the provider stack (`AppProvider` → `ProjectProvider` → `SpaceProvider`); use the helpers in `src/test-utils.tsx`.

## Task Index

| Working on… | Read |
|---|---|
| anything in this package — FS, events, globs, parsers, pod transport, contexts, hooks | [org/docs/libs/state.md](../../../../org/docs/libs/state.md) |
| the other shared libs (`ui`, `css`, `auth`) | [org/docs/libs/](../../../../org/docs/libs/README.md) |
| the on-disk shape this VFS mirrors | [org/docs/format/space/](../../../../org/docs/format/space/README.md) · [org/docs/format/project/](../../../../org/docs/format/project/README.md) |
| the pod REST routes `PodTransport` calls | [org/docs/cli-api/](../../../../org/docs/cli-api/README.md) |
| the Studio surface that consumes this package | [org/docs/studio/](../../../../org/docs/studio/README.md) |
