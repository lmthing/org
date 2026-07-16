---
id: plan_pages
output:
  pages: array
dependsOn: [plan_app, plan_endpoints, plan_components]
role: general
functions: []
---

Plan the MULTIPLE pages of the app, each wired to the real endpoints and the reusable components.
`query`, `plan_app` (`plan_app.pages`), `plan_endpoints` (`plan_endpoints.endpoints` — each carries a
stable `name`… planned via its route's first segment), and `plan_components`
(`plan_components.components`) are in scope. This is a THINKING step — no writers. Plan an `index` home
PLUS the additional views the material calls for (a list, a detail `items/[id]`, a dashboard) — a
single page is not enough. For each page, name the endpoints it reads (by their route's logical name)
and the components it renders, so the implement step wires real data through shared UI. Emit one
statement:

```typescript
currentTask.resolve({
  pages: [
    {
      route: 'index',
      purpose: '<what this page shows>',
      // endpoint logical names (the first segment of the route, e.g. 'items-list') this page reads:
      endpoints: [ '<endpoint name>' ],
      // component names (from plan_components) this page renders:
      components: [ '<ComponentName>' ],
    },
  ],
});
```
