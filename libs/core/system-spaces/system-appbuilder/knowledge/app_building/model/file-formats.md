---
description: LOAD WHEN you are hand-authoring a file kind freeform and want its exact required shape rather than your memory of it.
---

# File formats

The exact on-disk shapes each authoring global writes.

## There is NO generic filesystem — only the typed readers and writers by name

`readFile` / `writeFile` / `editFile` / `listDir` / `glob` / `grep` and raw `execShell` /
`readFileRaw` / `writeFileRaw` do NOT exist on your surface — a call to any of them FAILS typecheck
(`Cannot find name …`). That absence is deliberate: persistence goes ONLY through the typed writers,
reads ONLY through the typed readers. If you reach for a generic-fs name, the replacement is:

- **READ** — `readProjectFile(path)` (project) / `readSpaceFile(path)` (space); **list** —
  `listProjectDir(dir)` (project) / `listSpaceDir(dir)` (space).
- **WRITE / PERSIST** — a typed `writeProject*` writer, ALL of them listed below on this page:
  `writeProjectTable` · `writeProjectEntity` · `writeProjectQuery` · `writeProjectHook` ·
  `writeProjectEvent` · `writeProjectFunction` · `writeProjectView` ·
  `writeProjectViewComponent` · `writeProjectViewLayout` · `writeProjectViewShell`.
- `readFileRaw` / `writeFileRaw` are internal host primitives — never available to you. The only
  generic fs/shell anywhere is the ENGINEER's scratch sandbox (`createScratch()` then its
  `readFile`/`writeFile`/`execShell` inside `.lmthing/scratch/<random>`); if you are not the
  engineer, delegate the code to it and persist what it returns with a typed writer.

Reaching for a generic fs name is how a build burns its retry budget on a capability it will never
get — the reader/writer you actually want is on this page, by name.

## Table schema — `writeProjectTable(name, schema)` → `database/<name>.json`

`name` is a lowercase slug. `schema` is an object:

```json
{
  "title": "Feed items",
  "description": "One personalized item in the user's feed.",
  "columns": {
    "id":        { "type": "string",  "description": "unique id", "primaryKey": true, "generated": "uuid" },
    "title":     { "type": "string",  "description": "headline", "required": true },
    "url":       { "type": "string",  "description": "source URL", "required": true, "unique": true },
    "score":     { "type": "number",  "description": "relevance rank", "default": 0 },
    "read":      { "type": "boolean", "description": "opened yet", "default": false },
    "createdAt": { "type": "date",    "description": "when it entered the feed", "generated": "now" }
  },
  "relations": {
    "comments": { "hasMany": "comments", "via": "feedItemId", "description": "notes attached" }
  }
}
```

- Column `type`: `string` | `number` | `boolean` | `date` | `json`.
- Exactly one column sets `primaryKey: true` (use `generated: "uuid"`). `generated` is `uuid`|`now`.
- `references`: `{ table, column?, onDelete? }` (`onDelete`: `cascade`|`setNull`|`restrict`) is a
  real SQLite foreign key.
- Relations: `belongsTo` (this table holds the FK, `via` = its column) or `hasMany` (target holds
  the FK back). Both need a `description`. Validation fails loud on any missing description.

## Entity model (declarative — PREFER for a plain table) — `writeProjectEntity(name, entity)` → `model/<name>.entity.json` + `database/<name>.json`

Author FACTS, not columns — the table is COMPILED, never hand-written:

```json
{
  "entity": "job",
  "title": "Job",
  "identity": "id",
  "fields": {
    "id":     { "fact": "job.id", "type": "id" },
    "status": { "fact": "job.status", "type": "enum", "values": ["quoted", "in-progress", "done"] },
    "hours":  { "fact": "job.hours", "type": "number" }
  },
  "relations": { "parts": { "hasMany": "part", "via": "jobId", "description": "parts fitted" } }
}
```

Field `type`: `id`|`string`|`text`|`number`|`decimal`|`money`|`boolean`|`date`|`json`|`enum`|`ref`.
Exactly one field is `type: "id"` (the primary key). `type: "ref"` needs `to` (the target entity);
`type: "enum"` needs `values` (a rebuild may only ADD values, never drop/rename — one vocabulary per
fact, forever); `type: "money"` needs `currencyField` naming another string/enum field on the SAME
entity. `fact` is a stable key — reusing it for a different column name on a rebuild is rejected.
`writeProjectTable` still exists for a table not worth modeling as facts, but prefer this.

## Declarative query (every endpoint) — `writeProjectQuery(name, query)` → `api/<name>.query.json` + `api/<route>/<METHOD>.ts`

Every endpoint is query DATA and its handler is GENERATED, so it cannot disagree with its contract.
Use a list/get/aggregate/create/update/toggle/delete query. Parent/child work is also declarative:
declare the table relation, use `include` to attach children, and use row `compute` to count or sum
children. If a future behavior cannot be represented, extend this IR; never write a handler module.

```json
{
  "name": "jobs-list", "kind": "list", "entity": "job", "route": "jobs/list",
  "where": [ { "field": "status", "op": "in", "input": "status", "default": ["quoted", "in-progress"] } ],
  "order": [ { "field": "createdAt", "dir": "desc" } ],
  "limit": 50
}
```

`kind`: `list`|`get`|`aggregate`|`create`|`update`|`toggle`|`delete`. `where[].op`: `= != in not-in gt gte lt
lte contains is-null not-null`. `compute` (aggregates, and computed fields on a list/get) is a closed
formula AST — `add sub mul div min max round coalesce` (arithmetic) and `sum count avg first`
(reduce over an `include`d relation, or over the whole set inside an aggregate) — NOT TypeScript; a
formula outside that set means the IR needs an extension before the endpoint can be authored. `set`
(create/update) maps a column to `{ "input": "<field>" }` or `{ "value": <literal> }`; `toggleField`
(toggle) names the boolean column the handler flips. A `delete` needs a `[param]` in its route (or a
`where`) to name the row; its method defaults to DELETE.

**A toggle that ALSO needs to stamp a companion field is STILL declarative** — do not hand-write it.
Give that column a `set` entry shaped `{ "whenTrue": ..., "whenFalse": ... }` (not `{ input }`/
`{ value }` — those are for create/update, which have no "flip direction"): `"now"` means the current
timestamp, anything else is a literal.

```json
{
  "name": "job-toggle-collected", "kind": "toggle", "entity": "job",
  "route": "jobs/[id]/toggle-collected", "toggleField": "collected",
  "set": { "collectedDate": { "whenTrue": "now", "whenFalse": null } }
}
```

This is the exact shape a "mark collected, stamp the date; un-mark, clear it" toggle needs. The exact
IR shape is in your ambient DTS (`declare function writeProjectQuery`) — read it there, not from memory.

## Page — `writeProjectView(route, spec)` → `views/<route>.view.json`

`route` is `index` (root) or a path like `items/[id]` (a `[seg]` is dynamic, read as `$route.id`).
`spec` is a plain OBJECT — never a string, never TSX:

```ts
{
  route: 'items',
  title: 'Items',
  sections: [
    { kind: 'toolbar', id: 'tools', actions: [ { label: 'Add', icon: 'plus', reveals: ['add'] } ] },
    { kind: 'create', id: 'add', mutation: 'add-item', invalidates: ['items-list'] },
    { kind: 'list', id: 'items', query: 'items-list', layout: 'rows',
      item: { title: '$.title', caption: '$.note', value: { value: '$.amount', format: 'currency' } },
      rowAction: { navigate: 'items/[id]', params: { id: '$.id' } },
      empty: { title: 'Nothing yet', message: 'Add one above.' } },
  ],
}
```

An action is EXACTLY ONE of `copy` / `download` / `mutate` / `navigate` / `print` — never two at once.
A mutation that must then leave the page puts its navigation in the mutation's OWN `onSuccess`:
`action: { mutate: 'delete-item', input: { id: '$route.id' }, onSuccess: { navigate: 'items', … }, confirm: true }`.
See `spec-vocabulary` for the full action rules.

- `kind` is one of exactly twelve: `list` `detail` `create` `stats` `markdown` `chat` `toolbar`
  `timeline` `board` `calendar` `chart` `outlet`. There is no thirteenth and no `custom`.
- `query`/`mutation` name an endpoint's `export const name` — never a URL, never a route.
- Values are PATHS: `$` `$.field` `$props.x` `$route.<param>` `$data.<sectionId>.<path>`
  `$result.<field>` `$form.<field>` `$client.timezone`. No conditionals, no arithmetic, no `${…}`.
  A binding that resolves to null renders nothing.
- A `create` section declares NO fields — they derive from the mutation's `Input` JSON Schema. Give a
  foreign-key Input property an `x-options` annotation (`{ query, label, value }`) so it renders as a
  select instead of a UUID text box.
- The writer persists ONLY the spec JSON — no `.tsx`, no `pages/` dir. The prebuilt AppHost (web) and
  the native app fetch the specs and render them directly, so there is nothing generated to keep in sync.

## Layout — `writeProjectViewLayout(prefix, spec)` → `views/<prefix>/_layout.view.json`

`{ prefix, title?, sections }`, where exactly ONE section is `{ kind: 'outlet' }` — the position every
route under `prefix` renders at. The chain shares one runtime scope, so a child page reads a layout
section's data as `$data.<layoutSectionId>.…`.

## View component — `writeProjectViewComponent(name, def)` → `components/<Name>.view.json`

`name` is PascalCase. `def` is `{ name, description?, props, node }`; `props` maps each prop to a type
(`{ item: 'Expense' }`), read inside `node` as `$props.<key>`. `node` is an element tree from the
closed 32-element vocabulary — `row col grid spacer divider surface heading text caption markdown code
quote badge statcard meter keyvalue table timeline rating chart calendar steps image icon avatar
banner empty button link field tabs accordion` — where `row`/`col`/`grid`/`surface`/`tabs`/`accordion`
take `children: [...]`. Components may reference other components
(acyclic) and never React.

## App shell — `writeProjectViewShell(shell)` → `shell.view.json`

`{ brand?, nav?, groups?, subnav?, placement?, assistant? }`. A `nav` entry's `route` must be a real
STATIC route (a `[param]` route is a drill-in, never a nav item). Above five top-level routes use
`groups: [{ label, home, routes, icon }]` instead of a flat `nav`. `subnav: [{ match: 'trips/[tripId]',
items: [...] }]` gives a parameterised route family its own bar. **`assistant` is an OVERRIDE, not a
switch**: every app already has a chat dock on every page, so leave the key out unless you need a
different agent — or `false` for the rare surface where a chat box is wrong.

## Hook — `writeProjectHook(slug, src)` → `hooks/<slug>.ts`

Default export is one of:

```ts
// cron — time-based
export default { type: 'cron', every: '30m', trigger: 'space/agent#action' };
// event — a db write, declarative
export default {
  type: 'event',
  on: { event: 'project/db.raw_items.insert' },
  trigger: 'space/agent#action',
};
// event — a db write, imperative. `ctx.input` IS the written row.
export default {
  type: 'event',
  on: { event: 'project/db.raw_items.insert' },
  handler: async ({ input, db, delegate }) => { /* ... */ },
};
```

`type` is `'cron' | 'event' | 'webhook'`, and a hook has EXACTLY ONE of `trigger` / `handler`.
`every` is `<n>m|h|d` (mutually exclusive with `daily: 'HH:MM'`).

**There is no `{ type: 'database' }` hook.** It was removed with no back-compat: a db write auto-emits
the synthetic event `project/db.<table>.<insert|update|remove>` whose payload IS the row, and you
subscribe to that with an `event` hook. Writing the old shape is the worst kind of mistake here —
`writeProjectHook` accepts the file and the loader then DROPS it with a warning, so the automation
looks written and never runs.
