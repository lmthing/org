---
description: LOAD WHEN you are hand-authoring a file kind freeform and want its exact required shape rather than your memory of it.
---

# File formats

The exact on-disk shapes each authoring global writes.

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

## API handler — `writeProjectApi('<name>/<METHOD>', src)` → `api/<name>/<METHOD>.ts`

The route's LAST segment is the HTTP method (`GET`|`POST`|`PUT`|`PATCH`|`DELETE`); the rest is the
endpoint path. `src` is a full ESM handler module:

```ts
export const name = 'items-list';
export const description = 'List all items, newest first.';
export interface Input {}
export interface Output { items: { id: string; title: string }[] }
export default async function handler(input: Input, ctx: { db: any }): Promise<Output> {
  const items = await ctx.db.query('items', { orderBy: { column: 'createdAt', dir: 'desc' } });
  return { items };
}
```

`ctx.db` is the async data API: `await ctx.db.query/insert/update/remove/tables(...)`. `Input`/
`Output` become the endpoint's JSON-Schema contract. `import { HttpError } from '@app/runtime'` to
signal 4xx/5xx.

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
