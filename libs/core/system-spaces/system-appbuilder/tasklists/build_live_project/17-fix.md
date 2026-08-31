---
id: fix
output:
  path: string
  ok: boolean
dependsOn: [verify, plan_views, plan_endpoints, plan_view_components, plan_tables, plan_automations, implement_view_components]
forEach: verify.offending
role: general
functions: []
onFail:
  goto: verify
  when: "verify.ok == false"
  maxAttempts: 3
---

Fix ONE artifact the gate rejected — the one in `item` = `{ path, kind, errors }`. `kind` is
`'view' | 'viewComponent' | 'api' | 'hook' | 'shell'`; `errors` is the exact list of
`{ line?, phase, message }` produced for THIS artifact. The host runs this node once PER offending
artifact, so you reason about only this one and never hold the whole app. In scope: `item`,
`plan_endpoints` (each `{ name, route, purpose, tables, fields, input? }` — `input` is a write endpoint's request-BODY keys, and it is what a `create` section derives its form fields from), `plan_views` (each page's planned
sections), `plan_view_components`, `plan_tables`, and `implement_view_components`.

READ the artifact first — `readProjectFile(item.path).content`. It returns `{ ok, content, error }`
and hands back `content: ''` (not `undefined`) for a missing or 0-byte file, so a truthiness check on
the result object alone does NOT protect the parse. Only `JSON.parse` once you have confirmed
`cur.ok === true && cur.content.length > 0`; a missing artifact is recreated from your plan, never
parsed as `''` and never written back empty (that is a skeleton that passes every gate). Every spec
artifact is JSON, so `JSON.parse` it, edit the ONE field the error names, and write the OBJECT back
through its writer.
The layout (all top level): a page is `views/<route>.view.json`, a view component is
`components/<Name>.view.json`, the shell is `shell.view.json`. There is no generated `.tsx` and no
`pages/` dir — a spec is rendered directly by the shared renderer, so fixing the `.view.json` IS the
fix. Then fix EACH error, grounded in the real artifacts, never a guess.

**The gate already decided WHICH artifact is at fault — do not second-guess it.** A defect seen on a
page is often an endpoint's: `verify` routes it to the endpoint's file, and you will be handed that
file, not the page.

- **`phase: 'render-smoke'` on an api file — an ALWAYS-NULL binding.** The page mounted against real
  seeded data and a bound field came back null on every row. The spec is right; the HANDLER is not
  computing the field it declares. Find the field in this endpoint's `plan_endpoints` `fields`, and
  compute it: a cross-table name is a lookup, a total is a reduce, a status label is a mapping, a
  "current"/"tonight" pick is a selection over the rows. **NEVER "fix" this by removing the binding
  from the page** — that deletes the feature the user asked for and the gate will simply go quiet.
- **`phase: 'render-smoke'` reporting an EMPTY RENDER on a page** — the page mounted and showed
  nothing. Either its sections bind fields the endpoint never returns (fix the endpoint) or the
  section has no data-bound content at all (give it its `item`/`cards`/`fields`). A cousin the gates
  can MISS: a page stuck on grey LOADING SKELETONS renders fine, typechecks and validates — but its
  query never FIRED, because its `input` binds something the page's own route cannot supply
  (`$route.x` on a param-less route). Fix the `input` — a `$route.<param>` the route declares,
  `$data` from an earlier section, or a literal — never bury it.
- **`phase: 'views'` — an app-wide view fault.** An orphan route no nav reaches, a nav target that is
  not a real route, a `reveals`/`rowAction`/`prefill` target that resolves nowhere, a declared
  component nothing uses, a page with no data-bound section. Fix the artifact the message names: the
  shell for a nav/orphan fault, the page for a dangling target, and drop a component nothing uses.
- **A rejected spec field** (`sections[2].item.metaFormat is not a property`, `"chip" is not an
  element`, `"$.a + $.b" is not a binding`) — the message names the instance path AND the finite valid
  set. Change exactly that field to a value from the set. An expression never becomes legal: move the
  computation into the endpoint's Output, or use the named policy the message points at (`toneMap`,
  `poll.while`, `format`).
- **`phase: 'smoke'` — the endpoint was actually CALLED and misbehaved.** Never fix this by changing a
  page: fix the HANDLER. `returned 500` → it threw, usually querying a table or column that does not
  exist (check `plan_tables`). `envelope` → a read endpoint must resolve `{ items: [...] }`.
  `undefined` param → validate the param and return an error instead of matching everything.
- **`phase: 'acceptance'` — the endpoint answered a valid shape with WRONG numbers** over seeded data.
  Never a page fix and never a seeding fix. Two sub-cases, and the message says which. A row count or
  a floor that came back short: the handler reads the wrong table/column or filters on a value the rows
  never use — re-point the query at the column that actually holds the numbers. An `expected X == <n>`
  miss: the brief DEFINES that figure arithmetically and the handler dropped a TERM of it (a rate never
  applied, a joined table never summed). The `Source basis:` in the message spells the arithmetic out —
  compute every term of it, in this handler, and return the whole figure. Do not adjust the number to
  match; compute it.
- **`phase: 'gate'` naming a TABLE that does not exist in `database/`** → decide which side is wrong
  against `plan_tables.tables` and `listProjectDir('database').entries`: re-point the query at the
  real (drifted-spelling) name, or, if nothing holds this record, create the table with
  `writeProjectTable` (schema only — NEVER invent rows) and point every reference at it.
- **`phase: 'typecheck'` / `'build'` on an api or hook file** — ordinary compiler errors. Guard nulls
  (`x ?? 0`), use the contract's `<Name>Output` type, read a route `[id]` off `input.id` (there is no
  `ctx.params`), and import only `@app/runtime`'s `HttpError` or a `node:` builtin.

You must PRESERVE the artifact's real content — keep every section, binding and endpoint it already
has. You are correcting the fault, not wiping the file.

**`ok` is a REPORT, not a gate — so report it truthfully and never invent it.** Resolve `ok: true`
only when the writer's result was actually consumed (`w.ok === true`) AND you re-read the artifact in
this same statement and saw the corrected content on disk. Declare and assign the write result in ONE
statement (`const w = …`), never a bare `let w;` assigned later.

If you cannot establish that — most often because a binding from an earlier statement is gone —
**resolve `ok: false`.** That is the correct answer and it costs nothing: `verify` re-runs after this
node and re-reads every artifact off disk itself, so it will find the file either fixed or still
broken regardless of what you claim here. Writing a bare `ok: true` you did not verify is therefore
pure downside — it cannot make the gate pass, and it trains the habit of asserting outcomes you have
not observed, which is the single most damaging thing an agent in this pipeline can do.

**Build NOTHING across statements — this is where a fix run is most often lost.** Every statement you
emit, including a RETRY after a rejected write or a typecheck error, is evaluated fresh: `const f = …`,
`const cur = …` and `const w = …` declared in one statement are NOT reliably visible in the next, and
a retry that assumes one was burns a whole turn. There is no safe two-step split here — read, edit
and write the artifact, then verify-and-resolve, ALL in ONE statement.

**If the host answers `Variable 'w' is used before being assigned.` (or
`Block-scoped variable 'w' used before its declaration`), you split the write — no other repair will
work.** That exact error is the compiler catching one of these: a bare `let w;` declared in one
statement and assigned in a later one; the `w = …` assignment sitting inside an `if`/`else` branch so
it is not guaranteed before the next statement reads `w`; or a `const w = …` in one statement and a
`w.ok` reference in a separate one. All three are the SAME defect, and the only fix is the one
statement below: declare AND assign `const w = writeProjectApi(…)` (never `let w;`), read `w.error`,
verify the landing and `currentTask.resolve(…)` all in the same block you emit in one go — do not
refer back to a `w` an earlier statement owns:

```typescript
const f = item as { path: string; kind: 'view' | 'viewComponent' | 'api' | 'hook' | 'shell'; errors: Array<{ line?: number; phase: string; message: string }> };
const cur = readProjectFile(f.path);
let w: { ok: boolean; error?: string };
if (!cur.ok || cur.content.length === 0) {
  // readProjectFile returns content:'' (NOT undefined) on a missing/0-byte file, so a truthiness
  // check on the result object alone does NOT protect `JSON.parse` — JSON.parse('') throws
  // 'Unexpected end of JSON input'. Never parse it, and never write an empty spec back: that ships a
  // valid-but-empty skeleton that passes every gate. This is a BUILD node with the plan in scope, so
  // RECREATE the artifact from its plan entry — the matching `plan_views` entry for a view,
  // `plan_view_components` entry for a viewComponent — and write it through the same writer. If the
  // kind cannot be rebuilt from the plan (api/hook need handler source), report the miss instead of
  // inventing content: set `w` to a failed write so the landing check below resolves `ok: false` and
  // the gate re-lists the artifact.
  if (f.kind === 'view') {
    const rebuilt = /* the matching plan_views entry — its route + its sections */;
    w = writeProjectView(rebuilt.route, rebuilt);
  } else if (f.kind === 'viewComponent') {
    const rebuilt = /* the matching plan_view_components entry */;
    w = writeProjectViewComponent(rebuilt.name, rebuilt);
  } else {
    w = { ok: false, error: 'no artifact on disk and no plan entry to rebuild this kind from — report the miss' };
  }
} else if (f.kind === 'view') {
  // A view is JSON: parse, correct the ONE field each error names, write the OBJECT back.
  const spec = JSON.parse(cur.content) as { route: string; sections: unknown[] };
  // …edit `spec` for every entry in f.errors — never blank it, never drop a section…
  w = writeProjectView(spec.route, spec);
} else if (f.kind === 'viewComponent') {
  const def = JSON.parse(cur.content) as { name: string };
  // …edit `def` for every entry in f.errors…
  w = writeProjectViewComponent(def.name, def);
} else if (f.kind === 'shell') {
  const shell = JSON.parse(cur.content) as Record<string, unknown>;
  // …edit `shell` (nav targets must be real routes; a [param] route is never a nav item)…
  w = writeProjectViewShell(shell);
} else {
  // api / hook — real TypeScript. Correct the named lines; NEVER resubmit the same string.
  const fixed = cur.content; // replace with cur.content corrected for f.errors
  w = f.kind === 'hook'
    ? writeProjectHook(f.path.replace(/^hooks\//, '').replace(/\.ts$/, ''), fixed)
    : writeProjectApi(f.path.replace(/^api\//, '').replace(/\.ts$/, ''), fixed);
}
// VERIFY the fix LANDED before claiming it — a writer that said ok AND a file that changed on disk.
const landed = w.ok && readProjectFile(f.path).content !== cur.content;
currentTask.resolve({ path: f.path, ok: landed });
```

If the writer returns `{ ok: false }`, read `w.error` (it names the instance path and the valid set) —
but do NOT try to patch just the write call in a follow-up statement. `f`, `cur` and `w` from the
rejected attempt are gone. Re-emit the WHOLE statement above, from `const f = item as …` down to
`currentTask.resolve(…)`, with the ONE field `w.error` named corrected, and re-verify the landing the
same way. The next verify pass re-checks the whole app, so a fix that did not fully land — or exposed
a further error — is caught, not shipped.
