---
name: new-space
description: Load when creating or modifying a space (agents, functions, components, tasklists, knowledge).
---

# Skill: Creating or Modifying a Space

Applies when you are authoring or editing a **space** — a directory bundling `agents/` plus the
tooling they reference (`functions/`, `knowledge/`, `tasklists/`, `components/`, `events/`, `hooks/`)
— whether it is a project space, a shipped system space, a store integration, or a runtime-registered
one. This file holds **no** format knowledge: the loader rules, the frontmatter allow-list, the
capability ids and every per-file spec live in `org/docs` and are cited to code there.

## Read first

- `org/docs/contributing/add-a-space.md` — **the procedure**: which kind of space you're adding, what
  to scaffold, every way `loadSpace` fails loud, and how to register/install each kind.
- `org/docs/format/space/README.md` — the on-disk format, the directory layout, how an agent wires up
  to its tooling.
- Per file kind: `org/docs/format/space/agents/` (charter + instruct + `frontmatter.md` +
  `capabilities.md` + `delegation.md`) · `functions/` · `components/` · `tasklists/` · `knowledge/` ·
  `events/` · `hooks/` · `package.json.md` (store spaces).
- `org/docs/runtime/spaces-loading.md` — loader/merge internals, system-space merge + collision rules.
- `org/docs/system-spaces/README.md` — the shipped spaces. To add/modify one, also load
  `@.claude/skills/system-spaces.md`.
- `org/docs/runtime-globals/store-and-consent.md` — `installSpace` and the consent gate.

## Procedure

1. **Pick the kind** — it decides discovery, not the file contents
   (`org/docs/contributing/add-a-space.md` §0).
2. **Scaffold** only the dirs you need; every loader but `agents/` returns empty when absent. Write
   both agent files: `agents/<slug>/charter.md` (fork-safe identity — injected into every fork) and
   `agents/<slug>/instruct.md` (frontmatter = all config, body = operating instructions).
3. **Author the tooling the agent names.** Every `functions`/`components`/`knowledge`/
   `actions[].tasklist` reference is resolved against the sibling directory at load — a dangling ref
   throws.
4. **Prefer the catalog before writing a component**, and **never forbid a tool in prose** — scope it
   in tasklist frontmatter (`role`, `functions:`, `canDelegateTo`); the host enforces it.
5. **Register it** per kind — project space: drop it in and it is auto-scanned. System space: create
   the dir **and** add its name to `SYSTEM_SPACE_NAMES`. Store space: add the `lmthing` block to
   `package.json`, then regenerate the catalog:
   ```bash
   pnpm --dir store gen:apps-manifest     # store/projects/manifest.json is GENERATED, never hand-edited
   ```
6. **Verify it loads**, then run it:
   ```bash
   cd sdk/org && pnpm test libs/core/src/spaces      # loader + system-space DAG/charter guards
   cd sdk/org && pnpm typecheck
   node sdk/org/libs/cli/dist/cli/bin.js --space ./my-space "<message>"   # add --mock <file> to run keyless
   ```
   A space that threw is silently skipped from pod listings — if it "vanished" from Studio, load it
   directly and read the throw.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
