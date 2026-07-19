---
id: plan_pages
output:
  route: string
  purpose: string
  endpoints: array
  components: array
dependsOn: [plan_app, plan_endpoints, plan_components, user_stories]
forEach: plan_app.pages
role: general
functions: []
---

Detail ONE page of the app — the page in `item` (a member of `plan_app.pages`, the BINDING page list;
each is `{ route, purpose }`) — wiring it to the real endpoints and reusable components so it satisfies
the user stories it serves. The host runs this node once PER planned page, so you reason about ONLY THIS
page and never hold the whole multi-page app in one turn — and one page's detailing failing is salvaged
on its own, it cannot zero the others. `item` (this page), `query`, `user_stories`
(`user_stories.stories` — the jobs this page must serve), `plan_endpoints` (`plan_endpoints.endpoints` —
each is `{ name, route, purpose, tables, fields }`), and `plan_components` (`plan_components.components` —
each is `{ name, purpose, props }`) are in scope. This is a THINKING step — no writers. **Every endpoint
you list must be an existing `plan_endpoints.endpoints[].name`, copied VERBATIM — never invent a name or
transform one.** List the endpoint `name`s this page reads and the components it renders, so the implement
step wires real data through shared UI.

**This page's endpoints must cover every component's props, not just its OWN headline numbers.** For every
component you assign to this page, check its `plan_components` `props` against this page's endpoint list:
each prop that represents a live figure (a total, a count, a computed summary — not a static label) must
be produced by a field on ONE of this page's listed endpoints. If a component you want needs a figure
none of its endpoints supplies, ADD the endpoint that supplies it (from `plan_endpoints`) — never assign
the component anyway and leave its data need unmet; a page that ships a total/summary component with
nothing to feed it renders a **hardcoded zero**, indistinguishable from broken to the person looking at
it. Emit one statement:

```typescript
const pg = item; // { route, purpose } — this page, from the binding plan_app.pages list
currentTask.resolve({
  route: pg.route,
  purpose: pg.purpose,
  // endpoint NAMES this page reads, each copied verbatim from plan_endpoints.endpoints[].name:
  endpoints: [ /* '<endpoint name>' */ ],
  // component names (from plan_components.components) this page renders:
  components: [ /* '<ComponentName>' */ ],
});
```
