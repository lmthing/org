---
id: implement_views
output:
  route: string
  ok: boolean
  error: string?
dependsOn: [plan_change, implement_endpoints, implement_components]
forEach: plan_change.views
role: general
functions: []
---

Write ONE page as a SPEC. Your item is `{ route, purpose, existing }`. No TSX, no imports, no class
names, no colours — the twelve section kinds are `list detail create stats markdown chat toolbar
timeline board calendar chart outlet`, and values are PATHS only: `$` `$.field` `$props.x`
`$route.<param>` `$data.<sectionId>.<path>` `$result.<field>` `$form.<field>` `$client.timezone` —
never an expression, a ternary or a template string.

**`existing: true` — read the real spec, add/change the ONE thing `purpose` asks for, keep every
other section untouched and in order.** `readProjectFile('views/' + item.route + '.view.json')`.
Adding a field to a row shows up as one more key in that section's `item`; a new action is a
`rowAction`/`toolbar` entry naming the endpoint `implement_endpoints` just landed; a genuinely new
concern on the page is a new section appended (or inserted where it reads best), never a rewrite of
sections nobody asked to change.

**`existing: false` — author a fresh page** (`{ route, title?, sections: [...] }`), then add it to
the nav: `readProjectFile('shell.view.json')`, append ONE entry to `nav` (`{ route: item.route, label:
'<Human Label>' }` — only for a static, non-`[param]` route; a drill-in is reached by a `rowAction`,
never a nav item), and `writeProjectViewShell` the WHOLE shell object back (it takes the full shell,
not a patch — dropping the existing `nav` entries un-reaches every page already in it).

`query`/`mutation` on a section must name a real endpoint **on disk**, not the plan — the writer
resolves against `listProjectDir('api')` and names every real one in its rejection if you get a name
wrong. Section `id`s are lowerCamelCase. `writeProjectView`/`writeProjectViewShell` are `{ ok,
error? }` — branch on `ok`, read `error` (it names the instance path and the finite valid set), fix
that ONE field, and write again before resolving; never delete a section or a nav entry to make the
error go away.

```typescript
const pg = item;
const cur = pg.existing ? readProjectFile('views/' + pg.route + '.view.json') : undefined;
const spec = cur?.ok
  ? { ...JSON.parse(cur.content), /* the one changed/added section */ }
  : { route: pg.route, title: '<Human Title>', sections: [] };
const w = writeProjectView(pg.route, spec);
let navOk = true;
if (!pg.existing && w.ok) {
  const shellFile = readProjectFile('shell.view.json');
  const shell = shellFile.ok ? JSON.parse(shellFile.content) : { nav: [] };
  shell.nav = [...(shell.nav ?? []), { route: pg.route, label: '<Human Title>' }];
  navOk = writeProjectViewShell(shell).ok;
}
currentTask.resolve({ route: pg.route, ok: w.ok && navOk, error: w.ok ? undefined : w.error });
```
