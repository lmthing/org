---
id: implement_views
output:
  route: string
  ok: boolean
  error: string
dependsOn: [plan_views, plan_endpoints, plan_view_components, implement_view_components, implement_endpoints, emit_types]
forEach: plan_views
role: general
functions: []
---

Write ONE page as a SPEC. Your page is in `item` = { route, purpose, endpoints, components, sections }.
Call `writeProjectView(item.route, spec)` with ONE object literal: `{ route, title?, sections: [...] }`.
No strings of code, no TSX, no imports, no class names, no colors. Your statement itself is plain
TypeScript, and every runtime global it calls (`writeProjectView`, `currentTask`) is AMBIENT — already
in scope, never imported; there is no `@lmthing/*` module.

Writing the `index` route REPLACES the project's newborn placeholder chat page with a real landing —
that is intended. Do not re-add a `chat` section to reproduce it: the assistant dock is on every page
already, so the conversation stays one tap away as a floating modal.

The twelve kinds are `list detail create stats markdown chat toolbar timeline board calendar chart
outlet`. Three carry one extra required field each: `board` needs `group` (the column key),
`calendar` needs `date` (the row's date), `chart` needs `charts: [{ kind, x, y }]`. `outlet` is legal
only in a layout — if the plan asks for a shared frame across a route family, write it with
`writeProjectViewLayout(prefix, { sections })` instead of repeating a header on every page.

Keep `item.sections` in order, and keep each section's `id` and `kind`. Per section:
- `query` = a READ endpoint's name; `mutation` = a WRITE endpoint's name — verbatim from the plan, never
  renamed or re-pluralised by you; a planned name you think is wrong is fixed in the plan, not tidied here.
  The writer resolves these against the endpoints **actually on disk**, not against the plan, and it
  names every real one in its rejection. So a name it does not recognise means the endpoint was
  written under a different name — take the one the error lists, never invent a spelling.
- `input: { … }` supplies that endpoint's arguments. `param` names the record for a `[param]` route
  and is a BINDING, not a bare param name: `param: '$route.id'`, never `param: 'id'`.
- **Section `id`s are lowerCamelCase** (`addPlantForm`, `dueToday`) — a plain name of letters, digits
  and `_`. A dashed id (`add-plant-form`) is rejected. `reveals` targets must match an `id` exactly.
- **A `create` section NEVER lists fields** — they derive from the mutation's Input schema.
- `item: { … }` is a row's flat shape. The keys are exactly: `title subtitle caption meta value suffix
  note markdown badge status image icon badges keyvalue action actions`. The first eleven take a
  string or `{ value, format?, currencyField?, tone?, toneMap?, maxLines? }`.
- Instead of a flat item you may write `{ use: '<ComponentName>', props: { … } }` for a component that
  `implement_view_components` landed, or an element tree (`{ el: 'row', children: [...] }`).
- `empty: { title, message? }` overrides the default empty state. Loading/error states are automatic.
- Live data: `poll: { everyMs: 3000, while: { field: '$.status', in: ['pending'] } }`.

**Values are PATHS, never expressions.** The eight roots, and nothing else: `$` `$.field` `$props.x`
`$route.<param>` `$data.<sectionId>.<path>` `$result.<field>` `$form.<field>` `$client.timezone`.
The framework spellings do NOT work here — write `$route.id` not `$params.id`, and `$.name` not
`$item.name`/`$row.name` (`$prop.` → `$props.`). No `?:`, no `+`, no `${…}`, no `{{…}}`: the spec
language has no expressions, **on purpose**. A value that needs computing is computed in the
ENDPOINT'S OUTPUT and bound by name, or expressed as a named policy — `format`, `toneMap`,
`poll.while`. A null binding renders NOTHING, so no guard is needed or possible.
`$route.<param>` resolves ONLY on a page whose OWN route declares that `[param]` — bound on a
param-less route the query never fires and the page shows loading skeletons forever (no error, no
500) — and an `input` can never bind `$.x`: that is the section's own endpoint's RESULT, and the
call's argument cannot be its output. Legal `input` bindings: a `$route.<param>` the route declares,
`$data.<earlierSectionId>.<field>`, or a literal.

**Navigation uses the AUTHORING route plus params** —
`{ navigate: 'trips/[tripId]/expenses', params: { tripId: '$.id' } }`. Never `/trips/:tripId/...`,
never a string with a binding spliced into it. A DETAIL page exists only at the END of such a link:
give it the `[param]` route and reach it from its list's `rowAction` — never a param-less
`dog-detail` page, and never a nav entry (nav holds LIST pages only).

**Make it feel finished (the UX the plan asked for).** The renderer already gives you loading, empty
and error states, archetype layout and responsive behaviour for free — so spend your effort on the
parts only you can set:
- **Human copy.** Give each page and section a specific `title`, and every `list` a warm `empty:`
  that invites the next action ("No expenses yet — add one above."), never placeholder text. Know the
  difference when you check your work: grey loading placeholders that never resolve mean the query
  never FIRED (an `input` the page's route cannot supply — see the `$route.<param>` rule above); a
  proper `empty:` title means it fired and found nothing. Only the second is a finished page.
- **Readable values.** Put `format` on money/dates/durations, and `tone`/`toneMap` on a status or
  badge so good and bad read apart at a glance — a raw `false` or a bare `78` beside `70.49` is a
  finding the smoke gate will flag anyway.
- **Order for the eye.** Sections render top-to-bottom in the order you list them; put the thing the
  page exists for first, a `toolbar` or `stats` strip above the collection it summarises.

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
