---
id: implement_view_components
output:
  name: string
  ok: boolean
dependsOn: [plan_view_components, plan_endpoints, emit_types]
forEach: plan_view_components.components
role: general
functions: []
---

Write ONE reusable VIEW COMPONENT — a named element composition, not React. Your component is in
`item` = { name, purpose, props }. Call `writeProjectViewComponent(item.name, def)` with ONE object
literal. There is no source string, no TSX, no imports, no class names, no colors.

`def` is `{ name, description?, props?, node }`:
- `name` — `item.name`, PascalCase, verbatim.
- `props` — an OBJECT mapping each prop to its type (`{ expense: 'Expense' }`). `item.props` gives them
  as `'<key>: <type>'` strings; convert. Inside `node`, read a prop as `$props.<key>`.
- `node` — the element tree. Every node is `{ el: '<kind>', …props }`, and `row`/`col`/`grid`/`surface`
  take `children: [...]`.

**The element vocabulary is CLOSED — these 24 and no others:**
`row · col · grid · spacer · divider · surface · heading · text · caption · markdown · badge ·
statcard · meter · keyvalue · table · timeline · rating · image · icon · banner · empty · button ·
link · field`

Loading, error and empty states are the renderer's — there is no `skeleton`, `spinner` or `loading`.

**Values are PATHS, never expressions.** `'$props.expense.amount'` is a value; `'$props.a + $props.b'`,
`'${x}'` and `'$.done ? "yes" : "no"'` are rejected — the spec language has no expressions, **on
purpose**, so compute the value in the endpoint's Output and bind the result, or use a named policy
(`format`, `toneMap`). Inside a component the roots are `$props.<key>` and `$` (the current repeater
scope) — `$prop.` and `$item.` are not roots. A binding that resolves to null renders NOTHING
(and takes its label with it), which is what replaces every `x ? … : null` guard. Formatting is a
modifier on the value's own node — `format: 'currency' | 'date' | 'datetime' | 'time' |
'relative-time' | 'number' | 'percent' | 'humanize'` (+ `currencyField` for a per-row currency) — and
colour is `tone` (`neutral|accent|success|warning|danger|info|auto`) or a declared
`toneMap: { '<value>': '<tone>' }`, never a hex and never a class.

To let a row CHANGE something, use `field` — the one interactive element:
`{ el: 'field', kind: 'toggle'|'rating'|'select'|'stepper'|'text', value: '$props.x.done',
mutation: '<endpoint>', input: { id: '$props.x.id' }, invalidates: ['<endpoint>'] }`.

**If `w.ok` is false, DO NOT resolve yet.** `w.error` names the instance path, the offense, and the
finite set of valid values (`node.children[1].el: "chip" is not an element. Elements: row, col, …`).
Fix THAT ONE field and call `writeProjectViewComponent` again before resolving — a component that
never lands is a `{ use: … }` a page cannot resolve, and that page then fails to save.

Emit one statement:

```typescript
const c = item; // { name, purpose, props }
// props arrive as '<key>: <type>' strings — the writer wants an object.
const props: Record<string, string> = {};
for (const p of (Array.isArray(c.props) ? c.props : [])) {
  const [k, t] = String(p).split(':');
  if (k && k.trim()) props[k.trim()] = (t || 'string').trim();
}
const node = {
  el: 'surface',
  children: [
    { el: 'row', justify: 'between', children: [
      { el: 'text', text: '$props.expense.description', bold: true },
      { el: 'text', text: '$props.expense.amount', format: 'currency', currencyField: '$props.expense.currency' },
    ] },
    { el: 'row', gap: 1, children: [
      { el: 'badge', text: '$props.expense.category', tone: 'auto' },
      { el: 'caption', text: '$props.expense.paid_by_name' },
    ] },
  ],
};
const w = writeProjectViewComponent(c.name, { name: c.name, description: c.purpose, props, node });
if (w.ok) {
  currentTask.resolve({ name: c.name, ok: true });
} else {
  // w.error names the exact field and the finite valid set. Correct THAT ONE field in a copy of
  // `node` (or of `props`) and write once more — never resubmit the same object.
  const fixedNode = node; // replace with `node` corrected for the field w.error named
  const w2 = writeProjectViewComponent(c.name, { name: c.name, description: c.purpose, props, node: fixedNode });
  currentTask.resolve({ name: c.name, ok: w2.ok });
}
```
