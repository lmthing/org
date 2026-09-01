---
id: implement_endpoints
output:
  route: string
  name: string
  ok: boolean
dependsOn: [plan_endpoints, plan_tables, emit_types, reconcile_tables]
forEach: plan_endpoints.endpoints
role: general
functions: []
---

Write ONE declarative API endpoint into the LIVE project. `item` is the endpoint object from
`plan_endpoints`; it MUST carry `declarative: true` and its complete query IR. **Every endpoint uses
`writeProjectQuery`. Never write a TypeScript handler and never call `writeProjectApi`.**

First verify that `item.entity` and every `item.tables` entry are the exact table names from
`plan_tables.tables`. The query's `route` is the route without its final HTTP-method segment:
`recipes/[id]/GET` becomes `recipes/[id]`. `kind`, `entity`, `where`, `order`, `limit`, `include`,
`compute`, `set`, and `toggleField` are data from the plan; copy them verbatim rather than inventing
handler logic. **`item.fields` remains the binding response contract for the views and emitted
`types/contract.d.ts`. Before writing, reconcile it with the query output:** a list/get returns the
entity columns plus declared `compute` fields (and included relation fields); an aggregate returns its
`compute` keys; a mutation returns its entity row. Every field the plan declares must be produced by
that IR with the same spelling and type. If it does not, correct the plan/query or extend the IR — do
not rely on a generated local `Output` interface to hide the disagreement.

Parent/child endpoints are declarative too. Before writing one, make sure `04-plan_tables` declared the
relation on the parent table. Use `include: ['ingredients']` to return child rows; use a row formula
such as `compute: { ingredientCount: { count: '$ingredients.id' } }` to count them. The formula-derived
relation is included automatically, but it must be declared. A rejection naming an absent relation means
fix the table relation/query data — it is never a reason to create freeform TypeScript.

```typescript
const ep = item;
if (!ep.declarative) {
  throw new Error(`Endpoint ${ep.name} is missing declarative: true. Every endpoint must provide query IR.`);
}
const query = {
  name: ep.name,
  kind: ep.kind,
  entity: ep.entity,
  route: ep.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, ''),
  ...(ep.where ? { where: ep.where } : {}),
  ...(ep.order ? { order: ep.order } : {}),
  ...(ep.limit !== undefined ? { limit: ep.limit } : {}),
  ...(ep.include ? { include: ep.include } : {}),
  ...(ep.compute ? { compute: ep.compute } : {}),
  ...(ep.set ? { set: ep.set } : {}),
  ...(ep.toggleField ? { toggleField: ep.toggleField } : {}),
};
const w = writeProjectQuery(ep.name, query);
if (!w.ok) throw new Error(w.error ?? `writeProjectQuery failed for ${ep.name}`);
currentTask.resolve({ route: ep.route, name: ep.name, ok: true });
```

`writeProjectQuery` validates table names, columns, declared relation names, formulas, route shape, and
write fields, then generates `api/<route>/<METHOD>.ts`. For a rejected query, read the actionable error
and correct the declarative IR. If the requirement cannot be represented by the current IR, stop and
extend the IR before proceeding; do not add an escape hatch.
