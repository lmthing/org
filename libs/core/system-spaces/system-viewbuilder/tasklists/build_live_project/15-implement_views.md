---
id: implement_views
output:
  route: string
  ok: boolean
  error: string
dependsOn: [plan_views, plan_endpoints, plan_view_components, implement_view_components, emit_types]
forEach: plan_views
role: general
functions: []
---

Write ONE page as a SPEC. Your page is in `item` = { route, purpose, endpoints, components, sections }.
Call `writeProjectView(item.route, spec)` with ONE object literal: `{ route, title?, sections: [...] }`.
No strings of code, no TSX, no imports, no class names, no colors.

Keep `item.sections` in order, and keep each section's `id` and `kind`. Per section:
- `query` = a READ endpoint's name; `mutation` = a WRITE endpoint's name — verbatim from the plan.
- `input: { … }` supplies that endpoint's arguments; `param` picks the record for a `[param]` route.
- **A `create` section NEVER lists fields** — they derive from the mutation's Input schema.
- `item: { … }` is a row's flat shape. The keys are exactly: `title subtitle caption meta value suffix
  note markdown badge status image icon badges keyvalue action actions`. The first eleven take a
  string or `{ value, format?, currencyField?, tone?, toneMap?, maxLines? }`.
- Instead of a flat item you may write `{ use: '<ComponentName>', props: { … } }` for a component that
  `implement_view_components` landed, or an element tree (`{ el: 'row', children: [...] }`).
- `empty: { title, message? }` overrides the default empty state. Loading/error states are automatic.
- Live data: `poll: { everyMs: 3000, while: { field: '$.status', in: ['pending'] } }`.

**Values are PATHS, never expressions.** Roots: `$` `$.field` `$props.x` `$route.<param>`
`$data.<sectionId>.<path>` `$result.<field>` `$form.<field>` `$client.timezone`. No `?:`, no `+`, no
`${…}`, no `{{…}}`. A null binding renders NOTHING, so no guard is needed or possible.

**Navigation uses the AUTHORING route plus params** —
`{ navigate: 'trips/[tripId]/expenses', params: { tripId: '$.id' } }`. Never `/trips/:tripId/...`,
never a string with a binding spliced into it.

**If `w.ok` is false, DO NOT resolve.** `w.error` names the instance path, the offense and the finite
valid set (`sections[1].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe? Mutations:
addRecipe, importRecipe`). **Edit that ONE field and write again** — never resubmit the same object,
and never delete the section to make the error go away. Resolve the final outcome honestly, carrying
`w.error` when it still failed. Emit one statement:

```typescript
const pg = item;
const spec = {
  route: pg.route,
  title: 'Expenses',
  sections: [
    { kind: 'toolbar', id: 'tools',
      actions: [ { label: 'Add expense', icon: 'plus', reveals: ['addExpense'] } ] },

    { kind: 'create', id: 'addExpense', mutation: 'add-expense',
      input: { trip_id: '$route.tripId' }, invalidates: ['list-expenses', 'trip-totals'] },

    { kind: 'stats', id: 'totals', query: 'trip-totals', input: { id: '$route.tripId' },
      cards: [ { label: 'Spent', value: '$.spent', format: 'currency' },
               { label: 'Budget', value: '$.budget', format: 'currency' } ] },

    { kind: 'list', id: 'expenses', query: 'list-expenses', input: { id: '$route.tripId' },
      layout: 'rows',
      item: { title: '$.description', badge: '$.category', caption: '$.paid_by_name',
              value: { value: '$.amount', format: 'currency', currencyField: '$.currency' } },
      rowActions: [ { label: 'Remove',
        action: { mutate: 'remove-expense', input: { id: '$.id' }, invalidates: ['list-expenses', 'trip-totals'] } } ],
      empty: { title: 'No expenses yet', message: 'Add one above.' } },
  ],
};
let w = writeProjectView(pg.route, spec);
if (!w.ok) {
  // w.error named ONE field, its instance path, and the valid values. Correct THAT field in a copy
  // of `spec` and write once more — never the same object, never a deleted section.
  const spec2 = spec; // replace with `spec` corrected for the field w.error named
  w = writeProjectView(pg.route, spec2);
}
currentTask.resolve({ route: pg.route, ok: w.ok, error: w.ok ? '' : (w.error ?? 'write failed') });
```
