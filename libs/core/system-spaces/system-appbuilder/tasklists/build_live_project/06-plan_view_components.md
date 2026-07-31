---
id: plan_view_components
output:
  components: array
dependsOn: [plan_app, plan_endpoints, user_stories]
role: general
functions: []
---

Detail the REUSABLE VIEW COMPONENTS the pages will share. A view component is a **spec fragment** — a
named composition of the element vocabulary with declared props — never React, never TSX, never a
file the compiler sees. `query`, `plan_app` (`plan_app.components`, the binding list to detail),
`plan_endpoints` (`plan_endpoints.endpoints` — the data these render), and `user_stories` are in
scope. This is a THINKING step — no writers.

**Plan FEW.** Most rows and cards need no component at all: a section's `item` accepts a flat form
(`{ title: '$.name', caption: '$.note', badge: '$.status' }`) that covers an ordinary row completely.
A component earns its place only when the SAME multi-part shape appears on **two or more pages** —
a recipe card with image + title + prep time + tags, an itinerary card with time + place + cost.
One component used once is worse than no component: it is an extra name to get wrong.

Each entry is `{ name, purpose, props }`:
- `name` — PascalCase, unique. This EXACT string is what a section writes as `{ use: '<Name>' }`.
- `purpose` — the repeated shape it renders **and which pages use it** (name at least two, or drop it).
- `props` — the declared inputs, each `'<propName>: <type>'`. Inside the component every value is read
  as `$props.<propName>`, so the prop names are the component's whole interface. Prefer ONE prop
  carrying the whole record (`recipe: Recipe`) over eight scalars — the use site then passes
  `props: { recipe: '$' }` and nothing can be forgotten.

Emit one statement:

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
      purpose: '<the repeated shape it renders, and the TWO+ pages that use it>',
      props: [ '<propName>: <type>' ],
    },
  ],
});
```
