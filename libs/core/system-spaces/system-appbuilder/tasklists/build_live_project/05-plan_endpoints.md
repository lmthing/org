---
id: plan_endpoints
output:
  endpoints: array
dependsOn: [plan_app, plan_tables]
role: general
functions: []
---

Refine the endpoint list GROUNDED in the real tables, and ASSIGN each endpoint its stable `name` — the
single source of truth the whole app wires through. `query`, `plan_app` (`plan_app.endpoints`), and
`plan_tables` (`plan_tables.tables` — the actual tables + columns being written) are in scope. This is
a THINKING step — no writers. Plan the endpoints the pages need to read/write the real rows: at least
one read endpoint per view the app shows.

Each endpoint is `{ name, route, purpose, tables }`:
- `name` — a UNIQUE lowercase-hyphen id (e.g. `cost-lines`, `contacts-list`, `itinerary-legs`). This
  EXACT string is BOTH the endpoint module's `export const name` AND what pages pass to `useApi(...)`.
  **This is the ONLY node that assigns names; every downstream node uses them verbatim and never
  re-derives one.** No two endpoints may share a `name`, and no two may share a `route` — scan your own
  list before resolving and rename any collision.
- `route` — the file route with its HTTP method LAST (`cost-lines/GET`, `bookings/[id]/PATCH`); methods
  GET|POST|PUT|PATCH|DELETE.
- `tables` — the table name(s) from `plan_tables.tables` it reads/writes.

Read endpoints return `{ items: [...] }`, so plan read endpoints the pages consume as `data.items`.
Emit one statement:

```typescript
currentTask.resolve({
  endpoints: [
    { name: '<unique-hyphen-id>', route: '<path>/GET', purpose: '<what it returns or does>', tables: [ '<table from plan_tables.tables>' ] },
  ],
});
```
