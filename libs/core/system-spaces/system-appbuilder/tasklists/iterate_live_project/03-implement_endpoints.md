---
id: implement_endpoints
output:
  route: string
  name: string
  ok: boolean
  error: string?
dependsOn: [plan_change, implement_tables]
forEach: plan_change.endpoints
role: general
functions: []
---

Write ONE endpoint. Your item is `{ route, purpose, existing }`. There is no pre-computed type
contract here (no `emit_types` ran) — **every endpoint you write, new or edited, declares its own
LOCAL `interface Input {}` / `interface Output {}`, never an ambient `<Name>Input`/`<Name>Output`
global** (those exist only inside a fresh `build_live_project` plan).

**`existing: true` — read the real file, change the ONE thing `purpose` asks for, keep the rest.**
`readProjectFile('api/' + item.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, '') + '.ts')` (or grep
`listProjectDir('api')` if the exact file path is unclear — the route's method suffix maps to the
filename). Read every section/page that already calls this endpoint (`listProjectDir('views')` +
`readProjectFile` each, looking for a matching `query`/`mutation`) so your edit does not drop a field
another page still binds. Add the new field/behavior to the existing `Output`/handler body; do not
rewrite fields nobody asked to change.

**`existing: false` — author fresh**, exactly as `repair_live_project`'s `author_missing` does for a
missing endpoint: find who will call it (a page listed alongside it in `plan_change.views`, or read
`database/*.json` for the real table), declare local `Input`/`Output`, and write with
`writeProjectApi(route, src)` where `route` is `<item.route>` verbatim (method already encoded last).

```typescript
export const name = 'walks-list';               // === the route's slug, character-for-character
export const description = 'Upcoming walks, enriched with dog and client names.';
interface Input {}
interface Output { items: { id: string; scheduled_at: string; dog_name: string }[] }
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const items = await ctx.db.query('walks');
  return { items };
}
```

Every read endpoint returns `{ items: T[] }` — an aggregate returns its ONE summary object as
`items: [summary]`, never a bare object. A `[param]` route reads `input.<param>` — there is no
`ctx.params`. A toggle FLIPS the stored value server-side (the page has no `!`). A handler's only
legal import is `import { HttpError } from '@app/runtime'`; no relative import, no `@app/database`.

```typescript
const ep = item;
const cur = ep.existing ? readProjectFile('api/' + ep.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, '') + '.ts') : undefined;
const src = /* the full module source — edited from cur.content, or authored fresh */ '';
let w: { ok: boolean; error?: string } = writeProjectApi(ep.route, src);
currentTask.resolve({ route: ep.route, name: ep.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, ''), ok: w.ok, error: w.ok ? undefined : w.error });
```

If `w.ok` is false, `w.error` names the exact fault — fix that ONE thing and write once more, in the
SAME statement, before resolving (never split a declare/assign across statements — the next turn does
not see it).
