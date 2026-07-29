# Capability model

The authoring globals are not ambient — each is host-injected ONLY for an agent that holds the
matching `capabilities:` grant in its `instruct.md` frontmatter. A grant that is absent is absent
from both the injected globals AND the typecheck DTS, so a stray call fails typecheck instead of
reaching the engine. This is least-privilege: give an agent exactly the caps its job needs.

## The grants and what they unlock

| Capability | Unlocks | Config |
|---|---|---|
| `project:manage` | `createProject`, `selectProject` | bare (no config) |
| `db:schema` | `writeTableSchema`, `db.createTable`/`db.addColumn` | optional `{ tables: [...] }` |
| `db:read` | `db.query`, `db.tables` | optional `{ tables: [...] }` |
| `db:write` | `db.insert`, `db.update` | optional `{ tables: [...] }` |
| `pages:write` | `writePage`, `writeProjectPage`, `writeProjectComponent` (TSX — **NOT held by any agent in this space**) | bare |
| `views:write` | `writeProjectView`, `writeProjectViewComponent`, `writeProjectViewShell` | bare |
| `api:write` | `writeApi`, `writeProjectApi` | bare |
| `hooks:write` | `writeHook` | bare |
| `api:call` | `apiCall(name, input)` | required `{ allow: [...] }` |
| `connections:use` | `callConnection`, `integrationStatus` | optional `{ providers: [...] }` |
| `store:read` | `storeSearch`, `storeInspect` | bare |
| `store:install` | `installSpace` (consent-gated) | bare |
| `events:emit` | `emitEvent` | bare |
| `fs:scratch` | scratch-dir file access | bare |

That is the complete set of recognized ids; an unknown id fails the space load.

## Declaring capabilities

`capabilities:` is a YAML list. An entry is either a bare id or a single-key map carrying config:

```yaml
capabilities:
  - project:manage          # bare
  - db:schema               # bare = all tables
  - db:read: { tables: [items, comments] }   # narrowed to named tables
  - views:write
  - api:write
  - hooks:write
```

- `db:read`/`db:write`/`db:schema` accept an optional `{ tables: [...] }` that narrows the grant to
  named tables; bare = all tables. The `db` object exposes only the verbs of the granted db caps.
- `pages:write`/`views:write`/`api:write`/`hooks:write`/`project:manage` are BARE — passing a config
  is an error.
- `api:call` REQUIRES a non-empty `{ allow: [...] }` allowlist (there is no "call anything").
- An unknown capability id fails the space load (fail-loud).

## Least-privilege in practice

The `automator` is the broad authoring agent — it builds the LIVE project (data model + api +
automation + UI) end-to-end and so holds six grants: `hooks:write`, `db:schema`, `db:read`,
`db:write`, `api:write`, **`views:write`**. Its `build_live_project` tasklist runs its per-file steps
with role `general` under the automator's own grants, so every write global is callable in those task
bodies without any extra delegation. The narrower specialists hold only their slice: `data-modeler` =
`db:schema`+`db:read`; `api-author` = `api:write`+`db:read`; `spec-builder` = `views:write`+`db:read`
— a spec builder cannot write a table; a data modeler cannot write a page.

**No agent in this space holds `pages:write`, and that is load-bearing.** `pages:write` is what earns
`writeProjectPage`/`writeProjectComponent`, the TSX writers. Withholding it means they are neither
injected nor present in the DTS anywhere in this pipeline, so an attempt to author freehand React is a
TYPECHECK ERROR the model can see and retry — not a policy it is asked to respect. The UI here is
100% spec by construction, which is also what makes it render natively with no WebView. Freehand
React remains available: it is `system-appbuilder`'s, unchanged.

`project:manage` (`createProject`/`selectProject`) is held by the **host orchestrator (THING)**, not
this space's agents: THING creates or selects the LIVE project, and the runtime automatically
retargets the automator's build into that project. The automator itself never creates a project — it
only authors files into the project the session is already targeting.
