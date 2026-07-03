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
| `db:write` | `db.insert`, `db.update`, `db.remove` | optional `{ tables: [...] }` |
| `pages:write` | `writePage` | bare |
| `api:write` | `writeApi` | bare |
| `hooks:write` | `writeHook` | bare |
| `api:call` | `apiCall(name, input)` | required `{ allow: [...] }` |

## Declaring capabilities

`capabilities:` is a YAML list. An entry is either a bare id or a single-key map carrying config:

```yaml
capabilities:
  - project:manage          # bare
  - db:schema               # bare = all tables
  - db:read: { tables: [items, comments] }   # narrowed to named tables
  - pages:write
  - api:write
  - hooks:write
```

- `db:read`/`db:write`/`db:schema` accept an optional `{ tables: [...] }` that narrows the grant to
  named tables; bare = all tables. The `db` object exposes only the verbs of the granted db caps.
- `pages:write`/`api:write`/`hooks:write`/`project:manage` are BARE — passing a config is an error.
- `api:call` REQUIRES a non-empty `{ allow: [...] }` allowlist (there is no "call anything").
- An unknown capability id fails the space load (fail-loud).

## Least-privilege in practice

The `app-architect` orchestrator holds the full authoring set (it builds every file kind). The
specialist agents hold only their slice: `data-modeler` = `db:schema`+`db:read`; `page-builder` =
`pages:write`+`db:read`; `api-author` = `api:write`+`db:read`; `automator` = `hooks:write`. A page
builder cannot write a table; a data modeler cannot write a page. The build_app tasklist runs its
per-file steps with role `general` under the app-architect's own grants, so every write global is
callable in those task bodies without any extra delegation.
