---
id: plan_components
output:
  components: array
dependsOn: [plan_app, plan_endpoints, user_stories]
role: general
functions: []
---

Detail the REUSABLE components the pages will share — the point is UI written ONCE and imported by
several pages, not per-page markup. `query`, `plan_app` (`plan_app.components`, the binding list to
detail), `plan_endpoints` (`plan_endpoints.endpoints` — the data these components render), and
`user_stories` (`user_stories.stories` — what the user needs to see) are in scope. This is a THINKING
step — no writers. COUNT deliberately: for every component `plan_app` named, produce a concrete spec —
a `Card`, a `Row`, a `Badge`, a `StatTile`, an `EmptyState` — each rendering one record or one value and
appearing on more than one page. Each `name` is PascalCase; state the `props` it takes so the implement
step and the pages agree on the shape. Emit one statement:

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
