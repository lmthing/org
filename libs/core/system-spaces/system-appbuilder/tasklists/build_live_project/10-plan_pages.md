---
id: plan_pages
output:
  pages: array
dependsOn: [plan_app, plan_endpoints, plan_components, user_stories]
role: general
functions: []
---

Detail the MULTIPLE pages of the app, each wired to the real endpoints and the reusable components, so
that every user story has a page that satisfies it. `query`, `user_stories` (`user_stories.stories` —
each page must serve one or more), `plan_app` (`plan_app.pages`, the binding page list), `plan_endpoints`
(`plan_endpoints.endpoints` — each is `{ name, route, purpose, tables }`), and `plan_components`
(`plan_components.components`) are in scope. This is a THINKING step — no writers. **Every endpoint a
page lists must be an existing `plan_endpoints.endpoints[].name`, copied VERBATIM — never invent a name
or transform one.** Detail the `index` home PLUS the additional views the stories call for (a list, a
detail `items/[id]`, a dashboard) — a single page is not enough. For each page, list the endpoint
`name`s it reads and the components it renders, so the implement step wires real data through shared UI.
Emit one statement:

```typescript
currentTask.resolve({
  pages: [
    {
      route: 'index',
      purpose: '<what this page shows>',
      // endpoint NAMES, each copied verbatim from plan_endpoints.endpoints[].name:
      endpoints: [ '<endpoint name>' ],
      // component names (from plan_components) this page renders:
      components: [ '<ComponentName>' ],
    },
  ],
});
```
