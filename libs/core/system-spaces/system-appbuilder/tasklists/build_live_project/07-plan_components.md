---
id: plan_components
output:
  components: array
dependsOn: [plan_app, plan_endpoints]
role: general
functions: []
---

Plan the REUSABLE components the pages will share — the point is UI written ONCE and imported by
several pages, not per-page markup. `query`, `plan_app` (`plan_app.components`), and `plan_endpoints`
(`plan_endpoints.endpoints`) are in scope. This is a THINKING step — no writers. Plan a small set of
presentational components (a `Card`, a `Row`, a `Badge`, a `StatTile`, an `EmptyState`) that render one
record or one value and will appear on more than one page. Each `name` is PascalCase; state the `props`
it takes so the implement step and the pages agree on the shape. Emit one statement:

```typescript
currentTask.resolve({
  components: [
    {
      name: '<ComponentName>',
      purpose: '<the repeated UI it renders, and which pages use it>',
      props: [ '<propName: type>' ],
    },
  ],
});
```
