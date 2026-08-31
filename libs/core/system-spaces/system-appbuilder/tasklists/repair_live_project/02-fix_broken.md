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

READ the artifact first — `readProjectFile(item.path).content`. It returns `{ ok, content, error }` and
hands back `content: ''` (not `undefined`) for a missing or 0-byte file, so a truthiness check on the
result object alone does NOT protect the parse. Only `JSON.parse` once you have confirmed
`cur.ok === true && cur.content.length > 0`; a missing artifact is reported, never parsed as `''` and
never written back empty (that is a skeleton that passes every gate). A view/viewComponent/shell is JSON:
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
Read, edit, write and verify-and-resolve, ALL in ONE statement. **If the host answers
`Variable 'w' is used before being assigned.`, you split the write** — a bare `let w;` in one
statement, a `w = …` stuffed inside a branch, or a `w.ok` reference in a different statement than the
`const w = …`. The only repair is the one statement below: declare AND assign `const w = …`, read
`w.error`, verify the landing and `currentTask.resolve(…)` all in one block you emit in one go:

```typescript
const f = item as { path: string; kind: 'view' | 'viewComponent' | 'api' | 'hook' | 'shell'; errors: Array<{ line?: number; phase: string; message: string }> };
const cur = readProjectFile(f.path);
let w: { ok: boolean; error?: string };
if (!cur.ok || cur.content.length === 0) {
  // readProjectFile returns content:'' (NOT undefined) on a missing/0-byte file, so a truthiness
  // check on the result object alone does NOT protect `JSON.parse` — JSON.parse('') throws
  // 'Unexpected end of JSON input'. Never parse it, and never write an empty spec back: that ships a
  // valid-but-empty skeleton that passes every gate. There is NO plan here to rebuild the artifact
  // from — only live files — so report the miss instead of inventing content: set `w` to a failed
  // write so the landing check below resolves `ok: false` and `diagnose` re-lists the artifact (a
  // genuinely missing file is a toAuthor job, not a guess).
  w = { ok: false, error: 'no artifact to fix — report the miss to diagnose' };
} else if (f.kind === 'view') {
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

**Fix the artifact IN PLACE. Never leave two pages where there was one.** A page whose route cannot
supply a binding it uses (`$route.id` on a route with no `[param]` segment — the page renders loading
skeletons forever) is tempting to "fix" by writing a NEW page at a param'd route and leaving the old one
behind. That is not a fix: the old page stays on disk, the nav still points at it, and the user still
sees the broken screen. Correct the page you were given — drop the unsatisfiable binding and its input,
or re-point the section at an endpoint the page's own route CAN feed. And NEVER "fix" an unsatisfiable
`$route.x` by swapping it to `$.x` — that is circular (`input` is what the query is CALLED with; `$` is
that same query's result, which does not exist until after the call) and save-time validation rejects
it. The real options: a `$route.<param>` the page's route actually declares, `$data.<sectionId>.<field>`
from an EARLIER section, or a literal.

There is a delete for the genuine superseded case — `deleteProjectView(route)`, and likewise
`deleteProjectViewComponent(name)`, `deleteProjectViewLayout(prefix)`, `deleteProjectApi(route)`,
`deleteProjectQuery(name)`, `deleteProjectHook(slug)`. Each is REFUSED while anything still references
the artifact (the shell's nav/groups/subnav, another page's `navigate`/`link.to`), and the error names
the referencing file. You own ONE artifact, so you cannot repoint the shell yourself: if a delete is
refused, do NOT create the replacement and strand a duplicate — fix in place instead and let the
shell's own `fix_broken` item handle the nav. Only delete when the delete actually returns `{ ok: true }`,
and resolve on what you OBSERVED, never on what you intended.
