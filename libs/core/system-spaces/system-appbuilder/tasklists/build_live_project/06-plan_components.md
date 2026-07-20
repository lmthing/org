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

## If you are being RE-RUN (`feedback` is in scope)

A host-run `validate_contract` cross-checked the whole design and REJECTED it, so this node is running
again with `feedback` bound to its `errors` (and `attempt` to the pass number). Each entry is
`{ node, ref, message }`: `node` is which design node must change, `ref` is the exact offending
reference, `message` says what broke AND names the real options.

Read every entry that names THIS node and fix precisely that — do not redesign what was not faulted,
and do not re-emit the same reference and hope. An entry naming a different node is context: it tells
you what the rest of the contract must line up with. If `feedback` is not in scope, this is the first
pass; ignore this section.


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
