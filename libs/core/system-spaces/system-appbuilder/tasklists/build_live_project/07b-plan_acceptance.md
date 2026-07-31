---
id: plan_acceptance
output:
  checks: array
  ok: boolean
dependsOn: [plan_endpoints, plan_views, user_stories, read_sources]
role: general
functions: []
---

Turn the user stories into a small set of MACHINE-CHECKABLE acceptance checks — the semantic proof the
finished app is not just well-typed but actually RIGHT. Everything upstream proves the app COMPILES and
its endpoints answer the correct SHAPE; nothing proves the numbers MEAN anything. A handler that reads a
column nobody populated returns `{ items: [{ total: 0 }] }` — valid TypeScript, valid envelope, a
dashboard that reads €0 over a €2,707 trip. `check_acceptance` (a HOST-RUN code node) will CALL each
endpoint against the seeded data and evaluate the checks you emit here, so every check must be concrete,
grounded in the SOURCE, and evaluable by plain code — never a vibe.

In scope: `user_stories.stories` (each with its `acceptance` prose), `read_sources.summary` (the
source-derived build brief — the FIGURES the app must reflect), `plan_endpoints.endpoints` (each
`{ name, route, purpose, tables, fields, input? }` — the exact endpoint NAMES you target), and `plan_views` (an
array of page specs, each with an `endpoints` list — the endpoints a page actually RENDERS). A check
names ONE endpoint by its exact `name` and asserts one of two things a source figure justifies:

- **`rows-min`** — calling the endpoint returns at least `min` items. Use it when the source states a
  countable set: "18 itinerary days" → `{ endpoint: 'itinerary', kind: 'rows-min', min: 18 }`; "the
  trip has costs" → the costs list has `min: 1`. Set `min` to the number the source actually states, or
  `1` when the source only proves the set is non-empty. A `[param]` route needs an `input` with a real
  id from the seeded data — prefer a non-param list endpoint instead.
- **`field-min`** — calling the endpoint, `Number(items[0].<field>)` is at least `min`. Use it for an
  AGGREGATE the source proves is positive: "unpaid balances remain" → the summary endpoint's
  `outstanding_usd` `{ kind: 'field-min', field: 'outstanding_usd', min: 0.01 }`; "total trip cost is
  ~$3,344" → `{ field: 'grand_total_usd', min: 3000 }` (a conservative FLOOR, never an exact equality —
  round-off and currency splits make exact matches false alarms).

Rules that keep this from ever flagging correct code:
- **Check ONLY an endpoint a page RENDERS.** The endpoint you name must appear in some `plan_views`
  page's `endpoints` list — an endpoint no page reads shows the user nothing, so proving it works
  proves nothing they see. Verifying an orphaned endpoint is exactly how a broken dashboard passes
  acceptance while the real endpoint its page renders is the one that fails.
- **Only emit a check a SOURCE FIGURE grounds.** If the brief does not state or prove the number, do not
  invent a threshold — omit the check. A vague story yields NO check. It is far better to check three
  things you are sure of than ten you are guessing.
- **Thresholds are conservative FLOORS.** `min` is the least the value can honestly be. Never assert an
  exact total, an upper bound, or a value the source only implies.
- **Never assert something legitimately zero/empty can fail.** If the source does not prove a positive
  balance, a `field-min` on "outstanding" is wrong — a fully-paid trip is not a bug.
- Prefer `rows-min` on plain list endpoints (no params, no filter) — they are the most robust.

Most apps yield a handful of checks. An app whose stories are all "see the data on a page" and whose
source states only a few hard figures might emit two or three — that is correct; do not pad the list.
Emit exactly one statement:

```typescript
currentTask.resolve({
  checks: [
    {
      id: '<kebab-check-id>',
      story: '<the story id this verifies, or omit>',
      endpoint: '<exact plan_endpoints name>',
      // input: { id: '<real seeded id>' },   // ONLY for a [param] route; prefer a list endpoint
      kind: 'rows-min',                        // or 'field-min'
      min: 1,                                  // rows: item count floor; field: numeric floor
      // field: 'outstanding_usd',             // field-min only — a numeric key of items[0]
      why: '<the exact source figure that grounds this: "the brief lists 18 dated legs">',
    },
  ],
  ok: true,
});
```

## If you are being RE-RUN (`feedback` is in scope)

`check_acceptance` found the finished app contradicts a check you emitted, and the redesign could not be
grounded — but that is not your concern here: you only DECLARE what must be true. If `feedback` names a
check that proved to be a FALSE alarm (the value was legitimately zero/empty, or the threshold was a
guess), DROP or loosen that check. Never tighten a check to force a failure.
