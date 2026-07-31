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
`{ name, route, purpose, tables, fields, input? }` — the exact endpoint NAMES you target and the exact
`fields` each answers), and `plan_views` (an array of page specs, each with an `endpoints` list — the
endpoints a page actually RENDERS). A check names ONE endpoint by its exact `name` and asserts one of
three things:

- **`rows-min`** — calling the endpoint returns at least `min` items (`min` >= 1). Use it when the
  source states a countable set: "18 itinerary days" → `{ endpoint: 'itinerary', kind: 'rows-min',
  min: 18 }`; "the trip has costs" → the costs list has `min: 1`. A `[param]` route needs an `input`
  with a real id from the seeded data — prefer a non-param list endpoint instead.
- **`field-min`** — a numeric `field` on ONE returned row is at least `min` (`min` > 0). Use it for a
  figure the source only APPROXIMATES or only proves positive: "unpaid balances remain" →
  `{ kind: 'field-min', field: 'outstanding_usd', min: 0.01 }`; "total trip cost is ~$3,344" →
  `{ field: 'grand_total_usd', min: 3000 }` — a conservative FLOOR, because the source itself is
  approximate.
- **`field-equals`** — a numeric `field` on ONE returned row EQUALS `equals`, within `tolerance`
  (default 0.01). **This is the check that catches the failure nothing else in this pipeline can see**,
  and the rule below makes it mandatory wherever the brief states arithmetic.

Pick the row a `field-*` check reads with `match: { field, value }` — a stable business value from the
seeded data (`match: { field: 'bike_name', value: 'Specialized Allez' }`). Omit `match` only for a
single-row aggregate, where `items[0]` IS the answer. **Row ORDER is never a reason to skip a check** —
that is exactly what `match` is for.

## Every number the brief STATES becomes a check, with the value WORKED OUT

A rule the source states arithmetically, plus the rows it seeds, is a value you can compute right here.
"Labour is charged at £45/hour. A job's total is labour plus the parts fitted to it" + a 2.5-hour job
carrying £28.99 + £41.50 of parts ⇒ 2.5 × 45 + 70.49 = **182.99**. Emit it:

```typescript
{ id: 'allez-job-total', endpoint: 'jobs-list', kind: 'field-equals',
  match: { field: 'bike_name', value: 'Specialized Allez' }, field: 'total_gbp', equals: 182.99,
  why: 'brief: labour £45/h; total = labour + parts. 2.5h x 45 = 112.50, parts 28.99 + 41.50 = 70.49, total 182.99' }
```

That build shipped **£70.49** — the parts alone, the labour priced in the same sentence simply dropped —
and every gate was green, because the shape was right and the type was right. A floor cannot catch a
dropped term; only the expected VALUE can.

So: **if the source states a number, something here must check it.** Stated totals, rates (per hour,
per unit, per day), counts, elapsed days between two stated dates, thresholds and cut-offs. Work the
arithmetic out in `why` so the number is auditable by whoever reads the failure.

Three excuses that are NOT reasons to omit an arithmetic check — all three were used verbatim by a
build that then shipped the wrong number:
- *"Row order is not guaranteed"* → use `match`.
- *"The detail page is a `[param]` route and I don't know the seeded id"* → the same figure appears on
  the LIST endpoint. Check it there.
- *"Exact equality risks false alarms"* → not when the brief DEFINES the arithmetic. Every term is
  stated, so the value is determined: use `field-equals` with its default penny tolerance. Keep
  `field-min` for the figures the source itself only approximates.

## Rules that keep this from ever flagging correct code

- **Check ONLY an endpoint a page RENDERS.** The endpoint you name must appear in some `plan_views`
  page's `endpoints` list — an endpoint no page reads shows the user nothing, so proving it works
  proves nothing they see. Verifying an orphaned endpoint is exactly how a broken dashboard passes
  acceptance while the real endpoint its page renders is the one that fails.
- **Only emit a check the SOURCE grounds.** If the brief neither states the number nor defines the
  arithmetic that produces it, do not invent a threshold — omit the check. A vague story yields NO check.
- **`field` and `match.field` must be real `plan_endpoints` fields** of that endpoint, copied verbatim.
- **Never assert something legitimately zero/empty can fail.** If the source does not prove a positive
  balance, a `field-min` on "outstanding" is wrong — a fully-paid trip is not a bug.

## The CONTRACT — `check_acceptance` validates every check before it runs one

A check emitted in a shape the host node cannot evaluate is WORSE than no check: the pipeline reads the
story as covered while nothing was proven. So the node validates each check FIRST, and a bad one is
reported as `malformed`, **fails the build, and resumes THIS node** — it is never silently skipped.
Emit exactly these keys, and nothing vacuous (`rows-min` needs `min` >= 1; `field-min` needs `min` > 0):

```typescript
currentTask.resolve({
  checks: [
    {
      id: '<kebab-check-id>',
      story: '<the story id this verifies, or omit>',
      endpoint: '<exact plan_endpoints name>',
      // input: { id: '<real seeded id>' },      // ONLY for a [param] route; prefer a list endpoint
      kind: 'field-equals',                       // or 'rows-min' | 'field-min'
      // match: { field: 'bike_name', value: 'Specialized Allez' },  // field-* : picks ONE row; omit for an aggregate
      field: 'total_gbp',                         // field-* only — a numeric key of that row
      equals: 182.99,                             // field-equals only — the worked-out value
      // tolerance: 0.01,                         // field-equals only — default one penny
      // min: 18,                                 // rows-min (>= 1) / field-min (> 0) only
      why: '<the source figure AND the arithmetic: "labour 2.5h x £45 = 112.50 + parts 70.49 = 182.99">',
    },
  ],
  ok: true,
});
```

## If you are being RE-RUN (`feedback` is in scope)

`check_acceptance` could not EVALUATE one or more of your checks, and `feedback` is the list of them —
each with the `check` id and the exact `reason`. You are not being asked whether the app is right; you
are being asked to re-emit those checks in a shape the gate can run. Fix precisely what each `reason`
names (a missing `field`, a non-numeric `equals`, a `match` that selected several rows, a floor that
proves nothing), keep every check that was fine, and drop only a check no source figure grounds. Never
tighten a check to force a failure, and never drop an arithmetic check to make the gate quiet — a
dropped term reaching the user is the exact failure this node exists to prevent.
