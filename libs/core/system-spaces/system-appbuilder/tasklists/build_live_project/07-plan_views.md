---
id: plan_views
output:
  route: string
  purpose: string
  endpoints: array
  components: array
  sections: array
dependsOn: [plan_app, plan_endpoints, plan_view_components, user_stories]
forEach: plan_app.pages
role: general
functions: []
---

Plan ONE page as a LIST OF SECTIONS — the page in `item` (a member of `plan_app.pages`, the BINDING
page list; each is `{ route, purpose }`). The host runs this node once PER page, so you reason about
only this page. In scope: `item`, `query`, `user_stories.stories`, `plan_endpoints.endpoints` (each
`{ name, route, purpose, tables, fields, input? }`) and `plan_view_components.components` (each
`{ name, purpose, props }`). This is a THINKING step — no writers, no spec syntax yet.

What you resolve here is a PLAN, not a view spec. `implement_views` later CONSTRUCTS a fresh spec
from it — your `endpoint` becomes its `query`/`mutation`, your `bindings` become its `item`/`cards`
shapes — so keep plan fields plan-shaped (`purpose`, `endpoints`, `components`, `bindings`) and spec
fields spec-shaped (`layout`, `route`, `sections`, `title`): the plan artifact is never written to
disk and never forwarded to a writer as-is, and no later step can fix a plan it had to guess at.

**A page is an ordered list of sections. Pick each section's kind from this menu — there is no other
kind and no escape hatch:**

| kind | use it for | needs |
|---|---|---|
| `list` | rows/cards of many records | one GET endpoint (or `from`: an array inside another section's Output) |
| `detail` | ONE record — a header plus its fields | one GET endpoint |
| `create` | any form / any write the user submits | one mutation endpoint (fields derive from its Input — you never list them) |
| `stats` | a strip of figures | one GET endpoint returning the numbers |
| `markdown` | prose an endpoint produced, or static text | optional endpoint |
| `chat` | an INLINE assistant, when the PAGE is a conversation | an agent name |
| `toolbar` | buttons that reveal other sections, or fire an action | the ids it reveals |
| `timeline` | a date-GROUPED, time-ordered stream | an array (usually `from`) plus the field to group by |
| `board` | rows bucketed into COLUMNS by a status/stage field — a pipeline | one GET endpoint plus the field to group by |
| `calendar` | rows placed on a MONTH GRID | one GET endpoint plus each row's date field |
| `chart` | bar / line / area / donut plots over one endpoint's rows | one GET endpoint returning the points |

Section ORDER is what the user sees, top to bottom. Put the thing the page exists for FIRST.

## Every entity must be ADDABLE, EDITABLE and DELETABLE from the UI

`05-plan_endpoints.md` guarantees create/update/delete endpoints exist for every table behind a list or
detail page. An endpoint no page reaches is dead: plan the section that reaches it. A read-only app is a
FAILED app, and `08-validate_contract.ts` rejects one.

Three patterns. Note WHERE each belongs — the properties are per-kind, not universal:

- **add** — a `create` section bound to the POST endpoint. On the list page, or on a page of its own.
- **edit** — a `create` section bound to the PATCH/PUT endpoint, plus `prefill` (load the current
  values) and `input: { id: '$route.id' }` (which record). Same `create` kind: a form bound to a
  mutation is a form whether it inserts or updates. Put it ON the detail page. If you do give it its own
  route it is a `[param]` route (`items/[id]/edit`) — which means it must NOT appear in nav (see below).
- **delete** — from a LIST row, a `rowActions` entry with `confirm`. From a DETAIL page, a
  `detail.actions` entry with `confirm` plus `onSuccess: { navigate: '<the list route>' }` — the record
  is gone, so the page it was showing must not remain.

**Any `navigate` to a `[param]` route must supply the param.** `{ navigate: 'items/[id]' }` alone is
rejected — "needs a value for [id] and nothing supplies one". Pair it:
`rowAction: { navigate: 'items/[id]', params: { id: '$.id' } }`. Never flatten `navigate` and `params`
onto one object, and never give one action both `mutate` and `navigate` — pick exactly one.

**A `[param]` route is NEVER a nav destination.** Nav entries are static routes only; a detail or edit
page is reached from its list row's `rowAction`, not from the nav bar. `nav[N].route:
"items/[id]/edit" is not valid here` is this mistake, and adding edit pages is when it happens.

**`rowAction`/`rowActions` are LIST properties.** They do not exist on `detail` (the typecheck says so:
`Property 'rowActions' does not exist on type 'DetailSection'`). A detail page's actions live under
`detail.actions`. Putting a row action on a detail section is the single most common way this goes wrong.

**One section reads ONE endpoint, and that endpoint must carry every value the section shows.** For
each section list `bindings` — the exact fields it will read, as `$.<field>` paths — and check each
one against that endpoint's `fields` in `plan_endpoints.endpoints`. A binding with no matching field
is the design being wrong NOW, and a host-run `validate_contract` will send it back: the fix is
always to grow the ENDPOINT a computed field, never to make the page do arithmetic (it cannot).

**Say what you cannot express.** If this page's job needs a surface none of the eight kinds gives —
a multi-select that drives a query, a drag-to-reschedule grid, a freehand chart — do NOT force it
into the nearest kind. Plan the sections you honestly can and record the rest in `cannotExpress`,
naming WHICH PART and WHY. That is a correct, useful answer; a wrong-kind approximation is the
failure this pipeline measures.

**Build NOTHING across statements.** Each statement you emit — and each RETRY after a typecheck error
or a `validate_contract` re-run — is evaluated fresh: a `const` declared earlier is not reliably in
scope later. Do NOT alias `item`
(`const pg = item`). Read `item.route` / `item.purpose` directly inline, so the whole plan is ONE
statement with no local binding to lose:

## If you are being RE-RUN (`feedback` is in scope)

A host-run `validate_contract` cross-checked the whole design and REJECTED it, so this node is running
again with `feedback` bound to its `errors` (and `attempt` to the pass number). Each entry is
`{ node, ref, message }`: `node` is which design node must change, `ref` is the exact offending
reference, `message` says what broke AND names the real options.

Read every entry that names THIS node and fix precisely that — do not redesign what was not faulted,
and do not re-emit the same reference and hope. An entry naming a different node is context. If
`feedback` is not in scope, this is the first pass; ignore this section. Re-emit the WHOLE statement
below on every re-run — never a partial patch that assumes a prior turn's binding survived.


```typescript
currentTask.resolve({
  route: item.route,
  purpose: item.purpose,
  // Endpoint NAMES this page reads, each copied VERBATIM from plan_endpoints.endpoints[].name.
  endpoints: [ /* '<endpoint name>' */ ],
  // View component names (from plan_view_components.components) this page references.
  components: [ /* '<ComponentName>' */ ],
  sections: [
    {
      id: 'expenses',                  // unique on this page; the handle for reveals / $data
      kind: 'list',                    // one of the eight kinds above
      endpoint: 'list-expenses',       // verbatim from plan_endpoints; omit for toolbar/markdown-static
      from: '$.expenses',              // OPTIONAL: an array inside that endpoint's Output
      component: null,                 // OPTIONAL: a plan_view_components name used as the row shape
      reveals: [],                     // OPTIONAL (toolbar): section ids on THIS page it shows/hides
      // Every value this section shows, as a $.<field> path. Each must be a field of `endpoint`.
      bindings: [ '$.description', '$.amount', '$.paid_by_name' ],
    },
  ],
  // Anything this page needs that the eight kinds cannot express — name the PART and the REASON.
  // Leave it out entirely when the page expresses fully.
  // cannotExpress: [ { part: '<the surface>', reason: '<why no kind fits>' } ],
});
```
