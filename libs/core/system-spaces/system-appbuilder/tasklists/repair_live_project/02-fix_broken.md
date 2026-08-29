---
id: fix_broken
output:
  path: string
  ok: boolean
dependsOn: [diagnose]
forEach: diagnose.offending
role: general
functions: []
---

Fix ONE artifact `diagnose` found broken — `item` = `{ path, kind, errors }`. `kind` is
`'view' | 'viewComponent' | 'api' | 'hook' | 'shell'`; `errors` is `{ line?, phase, message }[]` for
THIS artifact. The host runs this once PER broken artifact — reason about only this one.

READ the artifact first — `readProjectFile(item.path).content`. A view/viewComponent/shell is JSON:
`JSON.parse`, edit the ONE field each error names, write the OBJECT back through its writer. An api/hook
is real TypeScript: correct the named lines, never resubmit the same string. The layout (all top
level): a page is `views/<route>.view.json`, a view component is `components/<Name>.view.json`, the
shell is `shell.view.json` — there is no `pages/` dir and no generated `.tsx`.

**`diagnose` already decided WHICH artifact is at fault — do not second-guess it.** A defect seen on a
page is often an endpoint's: `diagnose` routes an always-null binding or a missing computed field to
the endpoint's file, not the page. If you need more context than `item` gives you (what a sibling page
expects, a table's real schema), read it — `listProjectDir('views')`/`listProjectDir('database')` and
`readProjectFile` on whatever you need — there is no plan to consult here, only the live files.

- **`phase: 'render-smoke'` on an api file — an ALWAYS-NULL binding.** The handler is not computing a
  field it declares. Read the page(s) that bind it to see what shape is expected, then compute it: a
  cross-table name is a lookup, a total is a reduce, a status label is a mapping. **NEVER "fix" this by
  removing the binding from the page** — that deletes the feature.
- **`phase: 'views'` — an app-wide view fault.** An orphan route, a nav target that resolves nowhere, a
  `reveals`/`rowAction`/`prefill` target with no match, a declared component nothing uses. Fix the
  artifact the message names: the shell for a nav fault, the page for a dangling target.
- **A rejected spec field** (`"chip" is not an element`, `"$.a + $.b" is not a binding`) — the message
  names the instance path AND the finite valid set. Change exactly that field. An expression never
  becomes legal: move the computation into the endpoint's Output.
- **`phase: 'gate'` naming a TABLE that does not exist** — re-point the query at the real name
  (`listProjectDir('database').entries`), or if nothing holds this record, that table itself is a
  `diagnose.toAuthor` job, not yours.
- **`phase: 'typecheck'` / `'build'` on an api or hook file** — ordinary compiler errors. Guard nulls
  (`x ?? 0`), read a route `[id]` off `input.id` (there is no `ctx.params`), import only
  `@app/runtime`'s `HttpError` or a `node:` builtin.

You must PRESERVE the artifact's real content — keep every section, binding and endpoint it already
has. You are correcting the fault, not wiping the file.

**`ok` is a REPORT, not a gate.** Resolve `ok: true` only when the writer's result was actually
consumed (`w.ok === true`) AND you re-read the artifact in this same statement and saw the corrected
content on disk. If you cannot establish that, resolve `ok: false` — that costs nothing and is the
honest answer; asserting an outcome you did not observe is the one thing this pipeline cannot recover
from.

**Build NOTHING across statements.** Every statement you emit is evaluated fresh: `const f = …`,
`const cur = …` and `const w = …` declared in one statement are NOT reliably visible in the next.
`Cannot find name 'f'` (under any name you pick) is exactly this mistake — read, edit, write and
verify-and-resolve, ALL in ONE statement:

```typescript
const f = item as { path: string; kind: 'view' | 'viewComponent' | 'api' | 'hook' | 'shell'; errors: Array<{ line?: number; phase: string; message: string }> };
const cur = readProjectFile(f.path);
let w: { ok: boolean; error?: string };
if (f.kind === 'view') {
  const spec = JSON.parse(cur.content) as { route: string; sections: unknown[] };
  // …edit `spec` for every entry in f.errors — never blank it, never drop a section…
  w = writeProjectView(spec.route, spec);
} else if (f.kind === 'viewComponent') {
  const def = JSON.parse(cur.content) as { name: string };
  w = writeProjectViewComponent(def.name, def);
} else if (f.kind === 'shell') {
  const shell = JSON.parse(cur.content) as Record<string, unknown>;
  w = writeProjectViewShell(shell);
} else {
  const fixed = cur.content; // replace with cur.content corrected for f.errors
  w = f.kind === 'hook'
    ? writeProjectHook(f.path.replace(/^hooks\//, '').replace(/\.ts$/, ''), fixed)
    : writeProjectApi(f.path.replace(/^api\//, '').replace(/\.ts$/, ''), fixed);
}
const landed = w.ok && readProjectFile(f.path).content !== cur.content;
currentTask.resolve({ path: f.path, ok: landed });
```

If the writer returns `{ ok: false }`, read `w.error` — but do NOT patch just the write call in a
follow-up statement; `f`, `cur` and `w` from the rejected attempt are gone. Re-emit the WHOLE statement,
with the ONE field `w.error` names corrected.
