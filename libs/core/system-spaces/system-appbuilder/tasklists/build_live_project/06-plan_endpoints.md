---
id: plan_endpoints
output:
  endpoints: array
dependsOn: [plan_app, plan_tables, implement_tables, user_stories]
role: general
functions: []
---

Refine the endpoint list GROUNDED in the FULL tables that were just written, and ASSIGN each endpoint
its stable `name` — the single source of truth the whole app wires through. `query`, `plan_app`
(`plan_app.endpoints`, the binding list), `plan_tables` (`plan_tables.tables` — the full schemas +
columns + rows now in the DB), `implement_tables` (`{ name, ok }[]` — which tables actually landed), and
`user_stories` (`user_stories.stories` — the reads each story needs) are in scope. This is a THINKING
step — no writers. Plan the endpoints the pages need to read/write the real rows: at least one read
endpoint per view the app shows, and enough that every user story's data is reachable. Give each a
purpose specific enough that the implement step writes the right query against the real columns.

Each endpoint is `{ name, route, purpose, tables, fields }`:
- `name` — a UNIQUE lowercase-hyphen id (e.g. `cost-lines`, `contacts-list`, `itinerary-legs`). This
  EXACT string is BOTH the endpoint module's `export const name` AND what pages pass to `useApi(...)`.
  **This is the ONLY node that assigns names; every downstream node uses them verbatim and never
  re-derives one.** No two endpoints may share a `name`, and no two may share a `route` — scan your own
  list before resolving and rename any collision.
- `route` — the file route with its HTTP method LAST (`cost-lines/GET`, `bookings/[id]/PATCH`); methods
  GET|POST|PUT|PATCH|DELETE.
- `tables` — the table name(s) it reads/writes, using the names `implement_tables` actually RESOLVED
  (the written ground truth — a write-time correction may have altered a planned name). Fall back to
  `plan_tables.tables` only for a name `implement_tables` confirms `ok`. An endpoint planned against a
  table that never landed ships a handler that builds clean and 500s at runtime.
- `fields` — the EXACT keys of ONE item in the response (`items[0]`), each as `'key: type'`. This is the
  SINGLE SOURCE OF TRUTH for the response shape: `implement_endpoints` emits exactly these keys and
  `implement_pages` reads exactly these keys — so the two never disagree on a name. For a table-backed
  read, list the real `plan_tables` column names you return (snake_case, verbatim — do NOT re-case them
  to camelCase). For an aggregate/dashboard, list the computed keys you invent (still the exact strings
  the page will read). Every field a page needs must appear here.

Read endpoints return `{ items: [...] }` (an aggregate is the single summary at `items[0]`), so plan
read endpoints the pages consume as `data.items`. Emit one statement:

```typescript
currentTask.resolve({
  endpoints: [
    {
      name: '<unique-hyphen-id>',
      route: '<path>/GET',
      purpose: '<what it returns or does>',
      tables: [ '<table from plan_tables.tables>' ],
      // Exact keys of items[0], verbatim — snake_case table columns for a list, computed keys for an aggregate:
      fields: [ 'id: string', 'amount_usd: number', '<real column or computed key>: <type>' ],
    },
  ],
});
```
