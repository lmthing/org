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
`plan_endpoints` (each `{ name, route, purpose, tables, fields }`), `plan_views` (each page's planned
sections), `plan_view_components`, `plan_tables`, and `implement_view_components`.

READ the artifact first — `readProjectFile(item.path).content`. Every spec artifact is JSON, so
`JSON.parse` it, edit the ONE field the error names, and write the OBJECT back through its writer.
The layout: a page is `pages/<route>.view.json`, a view component is
`pages/components/<Name>.view.json`, the shell is `pages/_shell.view.json`. (`pages/<route>.tsx` is
HOST-GENERATED from the spec — never edit or write one; fix the `.view.json` and the wrapper is
re-emitted for you.) Then fix EACH error, grounded in the real artifacts, never a guess.

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
  section has no data-bound content at all (give it its `item`/`cards`/`fields`).
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
  Never a page fix and never a seeding fix: the handler reads the wrong table/column or filters on a
  value the rows never use. Re-point the query at the column that actually holds the numbers.
- **`phase: 'gate'` naming a TABLE that does not exist in `database/`** → decide which side is wrong
  against `plan_tables.tables` and `listProjectDir('database').entries`: re-point the query at the
  real (drifted-spelling) name, or, if nothing holds this record, create the table with
  `writeProjectTable` (schema only — NEVER invent rows) and point every reference at it.
- **`phase: 'typecheck'` / `'build'` on an api or hook file** — ordinary compiler errors. Guard nulls
  (`x ?? 0`), use the contract's `<Name>Output` type, read a route `[id]` off `input.id` (there is no
  `ctx.params`), and import only `@app/runtime`'s `HttpError` or a `node:` builtin.

You must PRESERVE the artifact's real content — keep every section, binding and endpoint it already
has. You are correcting the fault, not wiping the file.

**`ok: true` is a VERIFIED claim, never an intention.** Resolve `ok: true` ONLY when the writer's
result was actually consumed (`w.ok === true`) AND you re-read the artifact in this SAME fork and
confirmed the corrected content is on disk. A resolve based on what you were ABOUT to write is
fabricated success: the gate downstream trusts your `ok` and the artifact ships broken. Declare and
assign the write result in ONE statement (`const w = …`), never a bare `let w;` assigned later.
Emit one statement:

```typescript
const f = item as { path: string; kind: 'view' | 'viewComponent' | 'api' | 'hook' | 'shell'; errors: Array<{ line?: number; phase: string; message: string }> };
const cur = readProjectFile(f.path);
let w: { ok: boolean; error?: string };
if (f.kind === 'view') {
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

If the writer returns `{ ok: false }`, read `w.error` (it names the instance path and the valid set),
correct THAT and write once more before resolving — re-verifying the landing the same way. The next
verify pass re-checks the whole app, so a fix that did not fully land — or exposed a further error —
is caught, not shipped.
