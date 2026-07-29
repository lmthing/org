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
`{ name, route, purpose, tables, fields }`) and `plan_view_components.components` (each
`{ name, purpose, props }`). This is a THINKING step — no writers, no spec syntax yet.

**A page is an ordered list of sections. Pick each section's kind from this menu — there is no other
kind and no escape hatch:**

| kind | use it for | needs |
|---|---|---|
| `list` | rows/cards of many records | one GET endpoint (or `from`: an array inside another section's Output) |
| `detail` | ONE record — a header plus its fields | one GET endpoint |
| `create` | any form / any write the user submits | one mutation endpoint (fields derive from its Input — you never list them) |
| `stats` | a strip of figures | one GET endpoint returning the numbers |
| `markdown` | prose an endpoint produced, or static text | optional endpoint |
| `chat` | an assistant dock on the page | an agent name |
| `toolbar` | buttons that reveal other sections, or fire an action | the ids it reveals |
| `timeline` | a date-GROUPED, time-ordered stream | an array (usually `from`) plus the field to group by |

Section ORDER is what the user sees, top to bottom. Put the thing the page exists for FIRST.

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

Emit one statement:

## If you are being RE-RUN (`feedback` is in scope)

A host-run `validate_contract` cross-checked the whole design and REJECTED it, so this node is running
again with `feedback` bound to its `errors` (and `attempt` to the pass number). Each entry is
`{ node, ref, message }`: `node` is which design node must change, `ref` is the exact offending
reference, `message` says what broke AND names the real options.

Read every entry that names THIS node and fix precisely that — do not redesign what was not faulted,
and do not re-emit the same reference and hope. An entry naming a different node is context. If
`feedback` is not in scope, this is the first pass; ignore this section.


```typescript
const pg = item; // { route, purpose } — this page, from the binding plan_app.pages list
currentTask.resolve({
  route: pg.route,
  purpose: pg.purpose,
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
