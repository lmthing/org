---
id: fix
output:
  path: string
  ok: boolean
dependsOn: [verify, plan_pages, plan_endpoints, plan_components, plan_tables, implement_components]
forEach: verify.offending
role: general
functions: []
onFail:
  goto: verify
  when: "verify.ok == false"
  maxAttempts: 3
---

Fix ONE file the compiler rejected — the file in `item` = `{ path, kind, errors }` (`kind` is
`'page'|'component'|'api'`; `errors` is the exact list of `{ line?, phase, message }` the real typecheck
or bundle produced for THIS file). The host runs this node once PER offending file, so you reason about
only this ONE file and never hold the whole app. In scope: `item`, `plan_endpoints`
(`plan_endpoints.endpoints` — each `{ name, route, purpose, tables, fields }`), `plan_components`
(`plan_components.components` — each `{ name, purpose, props }`), `plan_pages`, `plan_tables`, and
`implement_components` (the per-item `{ name, ok }[]` ok-list of components that actually landed).

READ the file first — `readProjectFile(item.path).content` — then build a CORRECTED source that fixes
EACH error `item.errors` names, grounded in the real artifacts, NOT a guess:
- A wrong/re-cased FIELD name (`data.total_cost_usd`, `item.grandTotalUSD`) → look the endpoint up in
  `plan_endpoints.endpoints`, read `data.items` / `data.items[0]`, and use its `fields` VERBATIM.
- A COMPONENT PROP the component does not declare, or a prop fed no data → match the component's real
  `props` in `plan_components`; if a figure has no endpoint to feed it, that prop is a planning gap — drop
  the dependent markup and render inline, never a hardcoded literal.
- An import of a module the project does not have (`react-router`, `@radix-ui/*`, a relative `use-api`) or
  a `@app/runtime` name that is not exported → import ONLY from `@app/runtime`
  (`useApi`/`useApiMutation`/`apiCall`/`Link`/`useParams`/`navigate`/`Chat`), or drop it.
- A component that is imported but NOT in the `implement_components` ok-list → remove the import and render
  the value inline (a dangling import fails the whole bundle).
- `window`/`document`/`navigator`/`alert` (NO-DOM ambient) → express it as JSX and React state instead.
  (`console`, `fetch`, `crypto`, `setTimeout`/`setInterval` are DECLARED — they are never this error.)
- A null-guard the types demand (`x.toLocaleString()` on a nullable) → coalesce first (`(x ?? 0)`).
- A `phase: 'smoke'` error — the endpoint was actually CALLED and misbehaved. This is the only fault
  class proving RUNTIME behaviour, so never "fix" it by changing the page: fix the HANDLER.
  `returned 500` → the handler threw; the usual cause is querying a table or column that does not
  exist, so check the real names in `plan_tables`. `envelope` → a read endpoint must resolve
  `{ items: [...] }` (an aggregate is the single summary at `items[0]`). `undefined` param → the
  handler answered 2xx with rows when its `[id]` was missing; it must validate the param and return
  an error instead of silently matching everything, because a plausible 200 carrying the wrong row
  is worse than a failure.
- A `phase: 'gate'` error — the file references a TABLE that does not exist in `database/` (the handler
  builds clean but every call 500s at runtime) → decide which side is wrong, grounded in
  `plan_tables.tables` and `listProjectDir('database').entries`: if an EXISTING table already holds this
  kind of record under a drifted spelling (case/hyphen/plural of a real name), re-point the query at the
  real name; if NO existing table holds it, the TABLE is the missing artifact — create it first with
  `writeProjectTable` under a valid snake_case name (columns derived from the endpoint's declared
  `fields`; schema-only — NEVER invent rows), then point every reference in this file at that name.
- A `phase: 'gate'` error naming a `useApi`/`useApiMutation`/`apiCall` call whose name is not a real
  generated endpoint (the page calls one that was never written, so the hook short-circuits to an error
  state with NO network request ever firing) → find the REAL endpoint that serves this page's data in
  `plan_endpoints.endpoints` (match by `purpose`/`tables` against what this file is trying to show), and
  rewrite the call to that endpoint's `name`, VERBATIM. Re-read `fields` off that SAME endpoint and use
  exactly those keys — never invent a name and never leave the call pointed at the missing one.
- A `phase: 'gate'` error saying a call passes NO INPUT to a route that takes `[id]` (or another param) →
  that endpoint's route is parameterized, so the value belongs in the call: `useApi('trip-detail', { id })`.
  Read the id from the page's own route with `useParams()` (a `pages/items/[id].tsx` page) or from the row
  being rendered — never hard-code one, and never drop the call. Left as-is the client stringifies the
  missing value into the URL (`/api/trips/undefined`), which still matches the route and still returns
  200, so the page shows the WRONG row with nothing to debug.
- A `phase: 'gate'` error naming a `text-<token>` that is a SURFACE colour (`text-muted`, `text-card`,
  `text-accent`, …) → that paints the text in its own background colour, so it is invisible on the
  surface it sits on (a shipped app measured 1.08:1 where WCAG AA needs 4.5). It is a real Tailwind
  utility, so nothing else catches it. Swap it for the paired text token the error names
  (`text-muted-foreground`, `text-card-foreground`, …), or `text-foreground` where the token has no
  `-foreground` partner. Keep `bg-<token>` exactly as it is — the bare name is correct for a background.
- A `phase: 'gate'` error citing a bare `{ type, props }` (or `{ type, props, children }`) object literal
  returned from a page/component → that is THIS SYSTEM'S OWN display()-descriptor shape (the chat/tasklist
  rendering protocol) leaking into JSX authoring, not real React. Rewrite the SAME markup as JSX, keeping
  every element, prop, and child the descriptor already encoded (`{ type: 'div', props: { className: 'p-4',
  children: 'Cash Expenses' } }` → `<div className="p-4">Cash Expenses</div>`; a component reference in
  `type` becomes a JSX tag: `{ type: RunningTotalBanner, props: { total } }` → `<RunningTotalBanner
  total={total} />`) — never `React.createElement`, never a stringified template.

You must PRESERVE the file's real content — keep every endpoint it already reads and every section it
already renders; you are correcting the fault, not wiping the file. Write with the matching typed writer
for `item.kind` and resolve the outcome honestly.

**`ok: true` is a VERIFIED claim, never an intention.** Resolve `ok: true` ONLY when the writer's result
was actually consumed (`w.ok === true`) AND you re-read the file in this SAME fork and confirmed the
corrected content is what is on disk. A resolve based on what you were ABOUT to write, or on the
assumption that the write "would succeed", is fabricated success: the gate downstream trusts your `ok`,
the file you never actually fixed ships broken, and the whole app can fail to build over it. If the
write failed or you could not verify it landed, resolve `ok: false` with the reason — an honest failure
gets routed onward; a fabricated success is invisible. Declare and assign the write result in ONE
statement (`const w = …`), never a bare `let w;` assigned later. Emit one statement:

```typescript
const f = item as { path: string; kind: 'page' | 'component' | 'api'; errors: Array<{ line?: number; message: string }> };
const cur = readProjectFile(f.path);
// Build `fixed` = cur.content corrected for EVERY fault in f.errors (see above). NEVER resubmit the
// same string, and NEVER blank the file — fix the specific lines the compiler named.
const fixed = cur.content; // replace with cur.content corrected for f.errors
const w = f.kind === 'component'
  ? writeProjectComponent(f.path.replace(/^components\//, '').replace(/\.tsx$/, ''), fixed)
  : f.kind === 'api'
    ? writeProjectApi(f.path.replace(/^api\//, '').replace(/\.ts$/, ''), fixed)
    : writeProjectPage(f.path.replace(/^pages\//, '').replace(/\.tsx$/, ''), fixed, { replace: true });
// VERIFY the fix LANDED before claiming it: the writer said ok AND the file on disk is the corrected
// source. ok:true from assumption (not verification) ships a broken file behind a green flag.
const landed = w.ok && readProjectFile(f.path).content === fixed;
currentTask.resolve({ path: f.path, ok: landed });
```

If the writer returns `{ ok: false }`, read `w.error` (it names a parse/contract fault), correct THAT and
write once more before resolving — re-verifying the landing the same way. The next compile pass re-checks
the whole app, so a fix that did not fully land — or exposed a further error — is caught, not shipped.
