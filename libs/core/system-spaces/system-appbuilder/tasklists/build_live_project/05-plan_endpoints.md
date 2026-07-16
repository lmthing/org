---
id: plan_endpoints
output:
  endpoints: array
dependsOn: [plan_app, plan_tables]
role: general
functions: []
---

Refine the endpoint list, GROUNDED in the real tables. `query`, `plan_app` (`plan_app.endpoints`), and
`plan_tables` (`plan_tables.tables` — the actual tables + columns being written) are in scope. This is
a THINKING step — no writers. Plan the endpoints the pages will need to read/write the real rows: at
least one read endpoint per view the app shows. Each `route` encodes its HTTP method LAST (e.g.
`items-list/GET`, `item-detail/[id]/GET`, `item-create/POST`); methods are GET|POST|PUT|PATCH|DELETE.
Name the tables each endpoint touches so the implement step can query real columns. Emit one statement:

```typescript
currentTask.resolve({
  endpoints: [
    {
      route: '<name>/GET',
      purpose: '<what it returns or does>',
      tables: [ '<table name from plan_tables.tables it reads/writes>' ],
    },
  ],
});
```
