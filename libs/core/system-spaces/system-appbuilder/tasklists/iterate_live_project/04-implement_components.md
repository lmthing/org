---
id: implement_components
output:
  name: string
  ok: boolean
  error: string?
dependsOn: [plan_change]
forEach: plan_change.components
role: general
functions: []
---

Write ONE reusable view component. Your item is `{ name, purpose, existing }`. A component is a
spec fragment — a composition of the element vocabulary with declared props, never React/TSX.

**`existing: true`** — `readProjectFile('components/' + item.name + '.view.json')` first, change
only what `purpose` asks for, keep every prop/child not being changed. **`existing: false`** —
author a fresh `{ name, props, node }` definition: `props` names each value the component needs from
its caller (a `{ use: item.name, props: {...} }` reference in a page), `node` is the element tree
(`{ el: '...', children: [...] }`) reading those props via `$props.<name>`.

```typescript
const c = item;
const cur = c.existing ? readProjectFile('components/' + c.name + '.view.json') : undefined;
const def = cur?.ok
  ? { ...JSON.parse(cur.content), /* the one changed field */ }
  : { name: c.name, props: { /* declared props */ }, node: { el: 'row', children: [] } };
const w = writeProjectViewComponent(c.name, def);
currentTask.resolve({ name: c.name, ok: w.ok, error: w.ok ? undefined : w.error });
```

If `w.ok` is false, `w.error` names the offending field — fix it and write once more before
resolving.
