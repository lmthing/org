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

Write or update ONE declarative endpoint. `item` is `{ route, purpose, existing }`. Endpoints are
query IR only: never write or edit a handler module and never call `writeProjectApi`.

For an existing endpoint, read its generated handler only to recover the banner
`@generated from api/<name>.query.json`, then read that query JSON, preserve every behavior unrelated
to `purpose`, correct the query data, and regenerate it with `writeProjectQuery`. For a new endpoint,
read callers and real tables to determine the query's `kind`, `entity`, route (without method suffix),
filters, relation includes, compute, and write set. Parent/child work uses declared relations plus
`include`/row `compute`; if the requirement cannot be represented, report the missing IR capability.

```typescript
const ep = item;
const bareRoute = ep.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, '');
const current = ep.existing ? readProjectFile(`api/${bareRoute}/GET.ts`) : undefined;
const match = current?.content.match(/@generated from api\/([a-z][a-z0-9-]*)\.query\.json/);
const name = match?.[1] ?? bareRoute.split('/').filter(Boolean).join('-');
const stored = match ? readProjectFile(`api/${name}.query.json`) : undefined;
const query = stored?.ok && stored.content
  ? JSON.parse(stored.content)
  : { kind: 'list', entity: '<real table>', route: bareRoute };
// …apply item.purpose to query data; do not add TypeScript…
const w = writeProjectQuery(name, query);
currentTask.resolve({ route: ep.route, name, ok: w.ok, error: w.ok ? undefined : w.error });
```
