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

## Page — `writeProjectView(route, spec)` → `pages/<route>.view.json`

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

- `kind` is one of exactly eight: `list` `detail` `create` `stats` `markdown` `chat` `toolbar`
  `timeline`. There is no ninth and no `custom`.
- `query`/`mutation` name an endpoint's `export const name` — never a URL, never a route.
- Values are PATHS: `$` `$.field` `$props.x` `$route.<param>` `$data.<sectionId>.<path>`
  `$result.<field>` `$form.<field>` `$client.timezone`. No conditionals, no arithmetic, no `${…}`.
  A binding that resolves to null renders nothing.
- A `create` section declares NO fields — they derive from the mutation's `Input` JSON Schema. Give a
  foreign-key Input property an `x-options` annotation (`{ query, label, value }`) so it renders as a
  select instead of a UUID text box.
- The writer host-generates the trivial `pages/<route>.tsx` wrapper that renders the spec, so the
  existing page walk/hash/cache machinery is untouched.

## View component — `writeProjectViewComponent(name, def)` → `pages/components/<Name>.view.json`

`name` is PascalCase. `def` is `{ name, description?, props, node }`; `props` maps each prop to a type
(`{ item: 'Expense' }`), read inside `node` as `$props.<key>`. `node` is an element tree from the
closed 24-element vocabulary — `row col grid spacer divider surface heading text caption markdown
badge statcard meter keyvalue table timeline rating image icon banner empty button link field` — where
`row`/`col`/`grid`/`surface` take `children: [...]`. Components may reference other components
(acyclic) and never React.

## App shell — `writeProjectViewShell(shell)` → `pages/_shell.view.json`

`{ brand?, nav?, groups?, subnav?, placement?, assistant? }`. A `nav` entry's `route` must be a real
STATIC route (a `[param]` route is a drill-in, never a nav item). Above five top-level routes use
`groups: [{ label, home, routes, icon }]` instead of a flat `nav`. `subnav: [{ match: 'trips/[tripId]',
items: [...] }]` gives a parameterised route family its own bar. `assistant: { agent: 'thing' }` is
the persistent chat dock.

## Hook — `writeProjectHook(slug, src)` → `hooks/<slug>.ts`

Default export is one of:

```ts
// cron — time-based
export default { type: 'cron', every: '30m', trigger: 'space/agent#action' };
// database — write-triggered (declarative)
export default { type: 'database', on: { table: 'raw_items', event: 'insert' }, trigger: 'space/agent#action' };
// database — imperative
export default {
  type: 'database', on: { table: 'raw_items', event: 'insert' },
  handler: async ({ row, db, delegate }) => { /* ... */ },
};
```

`every` is `<n>m|h|d` (mutually exclusive with `daily: 'HH:MM'`). A database hook's `event` is
`insert`|`update`|`remove`, and it has EXACTLY ONE of `trigger` / `handler`.
