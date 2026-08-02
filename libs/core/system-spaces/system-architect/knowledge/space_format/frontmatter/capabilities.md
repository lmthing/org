---
description: LOAD WHEN writeAgentFile rejected a `capabilities:` entry, or you need to know what a grant actually earns — a capability not listed is not injected AND is stripped from the built agent's DTS.
---

# The `capabilities:` key

`capabilities:` is a YAML list under an agent's frontmatter that grants access to a **project's**
app layer (`database/views/api/hooks` — the project-owned application, distinct from a space's own
`agents/knowledge/functions/components/tasklists`). A capability not listed is not injected as a
global **and is stripped from the agent's typecheck DTS** — a stray call fails typecheck, not just
at runtime. This is least-privilege: grant an agent exactly the capabilities its job needs, never
the full set "just in case".

Each list entry is either a **bare id** (full scope) or a **single-key map** carrying that id's
config (narrowed scope):

```yaml
capabilities:
  - project:manage                              # bare — createProject/selectProject
  - db:schema                                    # bare = all tables
  - db:read: { tables: [items, comments] }       # narrowed to named tables
  - db:write: { tables: [items] }                # per-verb scope — read wide, write narrow
  - views:write                                  # bare only
  - api:write                                    # bare only
  - hooks:write                                  # bare only
  - api:call: { allow: [markRead, weatherLookup] } # REQUIRED allow list — no "call anything"
```

| Capability | Unlocks | Config |
|---|---|---|
| `db:read` | `db.query`, `db.tables` | optional `{ tables: [...] }` |
| `db:write` | `db.insert`, `db.update` | optional `{ tables: [...] }` |
| `db:schema` | `db.createTable`, `db.addColumn`, `writeProjectTable(name, schema, rows?)` | optional `{ tables: [...] }` |
| `views:write` | `writeProjectView(route, spec)`, `writeProjectViewLayout(prefix, spec)`, `writeProjectViewComponent(name, def)`, `writeProjectViewShell(shell)` | bare only |
| `api:write` | `writeProjectApi(route, src)` | bare only |
| `hooks:write` | `writeProjectHook(slug, src)`, `writeProjectEvent(name, src)`, `writeProjectFunction(name, src)` | bare only |
| `api:call` | `apiCall(name, input)` | **required** `{ allow: [...] }` |
| `project:manage` | `createProject(id, opts)`, `selectProject(id)` | bare only |

> The writers are all `writeProject*` and write into the session's OWN live project. The older
> store-catalog names (`writePage`/`writeApi`/`writeHook`/`writeTableSchema`) are **gone** — a space
> authored against one produces an agent whose call is absent from its DTS, i.e. a typecheck error on
> every turn that tries it (`sdk/org/libs/core/src/typecheck/library-dts.ts`).

**Validation is fail-loud**: an unknown capability id, an unknown config key, a `db:*` `tables`
entry naming a table absent from the project's `database/`, a config payload given to a bare-only
capability (`views:write`/`api:write`/`hooks:write`/`project:manage`), or a bare `api:call` (its
`allow` list is required) all throw and abort the space load.

**When to reach for this**: never for a plain research/Q&A/tool-calling space — those never need
`capabilities:` at all. If a request is actually "build me a data-backed app with pages/tables/
endpoints", that is **not** a job for this architect's `synthesize_and_run`/`iterate_space`
pipeline — delegate to `system-appbuilder/automator`, which already knows this model and holds the
matching capability grants for building the live project (with the `data-modeler`/`spec-builder`/
`api-author` specialists available for isolated slices).
