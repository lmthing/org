# File formats

The exact on-disk shapes each authoring global writes.

## Table schema — `writeTableSchema(name, schema)` → `database/<name>.json`

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

## API handler — `writeApi('<name>/<METHOD>', src)` → `api/<name>/<METHOD>.ts`

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

## Page — `writePage(route, src)` → `pages/<route>.tsx`

`route` is `index` (root) or a path like `items/[id]` (a `[seg]` is dynamic, read via
`useParams`). `src` is a full `.tsx` module with a default-exported component. Data hooks come from
`@app/runtime`: `useApi(name, input?, opts?)` (GET/DELETE reads → `{ data, error, isLoading,
refetch }`), `useApiMutation(name, { invalidates? })` (POST/PATCH/PUT → `{ mutate }`), `apiCall`,
`Link`, `navigate`. Style with design tokens ONLY.

## Hook — `writeHook(slug, src)` → `hooks/<slug>.ts`

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
