---
id: plan_change
output:
  tables: array
  endpoints: array
  components: array
  views: array
  data: array
dependsOn: []
role: general
functions: []
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
  await inspect(documents);
---

Decide the SMALLEST set of table/endpoint/component/page changes and concrete data rows that satisfies `query` — this is
the one thinking step; there are no writers here. `attachmentIds` may be empty (most iterations are
pure follow-up requests with no new material); when documents were supplied, the prelude has already
surfaced their content — read it for concrete new values, never invent one.

**CONVERGE — read what the project already has before naming anything.** `listProjectDir('database')`,
`listProjectDir('api')`, `listProjectDir('components')` and `listProjectDir('views')` are your ground
truth. For each existing table/page/endpoint/component the request touches, name it under its REAL,
existing name (read a table's `database/<name>.json` or a page's `views/<route>.view.json` with
`readProjectFile` to see its actual shape before deciding what to add to it) — never invent a second,
differently-spelled artifact for a concept already modeled. Mark that item `existing: true` so the
implementer knows to READ-THEN-EDIT rather than author from scratch.

**Bound membership to the request.** List ONLY the tables/endpoints/components/pages the request
names, plus what those structurally require to work (a column an existing table needs for the
change, the endpoint a requested view must read, a component a requested page will reuse). An
existing artifact the request does not touch is not listed at all — it is left exactly as it is. Do
NOT re-model, rename, or newly model an unrelated concept in the same pass just because you can see
it; that is `build_live_project` territory (a first build) or a separate future request, never this
one. A page that already exists and needs one more field/action/row is `existing: true` on `views`,
not a new route.

If `query` asks to add, seed, import, or enter concrete rows into an existing table, handle that
request here rather than treating it as a feature build. Read the real table schema before planning
`data`, use the table's exact name and column names, and put one item in `data`:
`{ table: '<real table>', rows: [ { /* concrete values */ } ] }`. Preserve every supplied value
verbatim; do not invent missing values. For a pure data-entry request, all four artifact arrays
(`tables`, `endpoints`, `components`, `views`) MUST be empty: inserting rows does not require an
endpoint, page, build, or repair. If the requested rows are not concrete enough to map to a real
schema, put no item in `data` and explain the missing information in the final result rather than
guessing.

**Naming conventions carry over unchanged**: table names are snake_case identifiers; endpoint routes
encode the HTTP method last (`items-list/GET`); component names are PascalCase; a `[param]` page
segment is a route dynamic. Every endpoint you list must be read by some view you also list (or an
existing one), and every mutation-shaped change (a new toggle, a new create action) needs its own
endpoint — the spec vocabulary has no way to flip a value client-side.

Emit one statement:

```typescript
currentTask.resolve({
  // A concept already on disk is named with its REAL existing name and existing: true — never
  // invented under a fresh one. Only list what `query` actually needs; nothing else.
  tables: [ { name: '<table_slug>', purpose: '<what changes/why>', existing: true } ],
  endpoints: [ { route: '<name>/GET', purpose: '<what it must now return/do>', existing: false } ],
  components: [ { name: '<ComponentName>', purpose: '<the shape it renders>', existing: false } ],
  views: [ { route: '<page-route>', purpose: '<what changes on this page>', existing: true } ],
  data: [ { table: '<real table>', rows: [ { /* concrete values */ } ] } ],
});
```
