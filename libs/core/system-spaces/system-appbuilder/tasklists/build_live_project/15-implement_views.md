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

Write ONE page as a SPEC. Your page is in `item` = { route, purpose, endpoints, components, sections }
— that is the PLAN ARTIFACT, your INPUT. It is not a spec and never an argument: `purpose`, `endpoints`
and `components` are planning metadata that must never be written, and `item.sections` are DESIGN NOTES
(`{ id, kind, endpoint?, from?, component?, reveals?, bindings }`), not spec sections. You CONSTRUCT a
fresh `ViewSpec` from the plan — plan `endpoint` becomes the section's `query` (a read) or `mutation`
(a write), plan `bindings` become the `item:`/`cards:`/`fields:` shapes, plan `component` becomes
`{ use: '<Name>' }` — and hand the writer ONE object literal: `{ layout?, route, sections, title? }`.
No strings of code, no TSX, no imports, no class names, no colors. Your statement itself is plain
TypeScript, and every runtime global it calls (`writeProjectView`, `currentTask`) is AMBIENT — already
in scope, never imported; there is no `@lmthing/*` module.

**Never pass the plan through.** `writeProjectView(item.route, item)`, a copy of `item` with three
fields deleted, or `{ route, sections: item.sections }` forwarding the plan sections as-is — all the
same fault, and the typecheck rejects each in its own words: `"purpose" is not a property here.
Properties: layout, route, sections, title`, `sections[0]: "query" is required here`,
`Type 'unknown[]' is not assignable to type 'SectionSpec[]'`. A retry of the same object cannot fix
a wrong object; author the spec.

**Author the literal INLINE, in the call.** `writeProjectView(item.route, { route, title,
sections: [...] })`: the parameter types the literal in place, so `kind: 'list'` stays the literal it
must be and a wrong property is rejected BY NAME. TypeScript's object-literal check fires only on a
FRESH literal — hoist the object (`const spec = { … }; writeProjectView(r, spec)`) and you lose it:
`kind` widens to plain `string`, stray plan fields slip through unmentioned, and every fault
collapses into `Argument of type '{ … }' is not assignable to parameter of type 'ViewSpec'` — an
error that names nothing and makes the retry a coin flip. If you genuinely need a binding (the
retry below), annotate it — `const spec2: ViewSpec = { … }` — never a bare `const spec2 = { … }`.

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
const pg = item; // the PLAN artifact — read route/sections from it, never pass `pg` itself
let w = writeProjectView(pg.route, {
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
});
if (!w.ok) {
  // w.error named ONE field, its instance path, and the valid values. Re-author the spec with THAT
  // ONE field corrected — annotated so the literal stays contextually typed. Never resubmit the
  // same object, never delete the section the error named.
  const spec2: ViewSpec = { /* the literal above, that one field corrected */ };
  w = writeProjectView(pg.route, spec2);
}
currentTask.resolve({ route: pg.route, ok: w.ok, error: w.ok ? '' : (w.error ?? 'write failed') });
```
