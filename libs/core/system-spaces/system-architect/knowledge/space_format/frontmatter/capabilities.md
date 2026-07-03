# The `capabilities:` key

`capabilities:` is a YAML list under an agent's frontmatter that grants access to a **project's**
app layer (`database/pages/api/hooks` — the project-owned application, distinct from a space's own
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
  - pages:write                                  # bare only
  - api:write                                    # bare only
  - hooks:write                                  # bare only
  - api:call: { allow: [markRead, weatherLookup] } # REQUIRED allow list — no "call anything"
```

| Capability | Unlocks | Config |
|---|---|---|
| `db:read` | `db.query`, `db.tables` | optional `{ tables: [...] }` |
| `db:write` | `db.insert`, `db.update`, `db.remove` | optional `{ tables: [...] }` |
| `db:schema` | `db.createTable`, `db.addColumn`, `writeTableSchema` | optional `{ tables: [...] }` |
| `pages:write` | `writePage(route, src)` | bare only |
| `api:write` | `writeApi(route, src)` | bare only |
| `hooks:write` | `writeHook(slug, def)` | bare only |
| `api:call` | `apiCall(name, input)` | **required** `{ allow: [...] }` |
| `project:manage` | `createProject(id, opts)`, `selectProject(id)` | bare only |

**Validation is fail-loud**: an unknown capability id, an unknown config key, a `db:*` `tables`
entry naming a table absent from the project's `database/`, a config payload given to a bare-only
capability (`pages:write`/`api:write`/`hooks:write`/`project:manage`), or a bare `api:call` (its
`allow` list is required) all throw and abort the space load.

**When to reach for this**: never for a plain research/Q&A/tool-calling space — those never need
`capabilities:` at all. If a request is actually "build me a data-backed app with pages/tables/
endpoints", that is **not** a job for this architect's `synthesize_and_run`/`iterate_space`
pipeline — delegate to `system-appbuilder/app-architect`, which already knows this model and holds
the matching capability grants across its `data-modeler`/`page-builder`/`api-author`/`automator`
specialists.
