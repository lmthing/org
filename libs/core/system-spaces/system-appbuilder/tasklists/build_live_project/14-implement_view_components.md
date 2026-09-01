---
id: implement_view_components
output:
  name: string
  ok: boolean
dependsOn: [plan_view_components, plan_endpoints, implement_endpoints, emit_types, smoke_endpoints, check_acceptance]
forEach: plan_view_components.components
role: general
functions: []
---

Write ONE reusable VIEW COMPONENT — a named element composition, not React. Your component is in
`item` = { name, purpose, props }. Call `writeProjectViewComponent(item.name, def)` with ONE object
literal. There is no source string, no TSX, no imports, no class names, no colors. Your statement itself
is plain TypeScript, and every runtime global it calls (`writeProjectViewComponent`, `currentTask`) is
AMBIENT — already in scope, never imported; there is no `@lmthing/*` module.

`def` is `{ name, description?, props?, node }`:
- `name` — `item.name`, PascalCase, verbatim.
- `props` — an OBJECT mapping each prop to its type (`{ expense: 'Expense' }`). `item.props` gives them
  as `'<key>: <type>'` strings; convert. A prop type is a type NAME, optionally an array —
  `string`, `number`, `boolean`, `Book`, `Book[]` — never an inline object literal (`'{ id: string }'`
  is rejected). Inside `node`, read a prop as `$props.<key>`.
- `node` — the element tree. Every node is `{ el: '<kind>', …props }`, and `row`/`col`/`grid`/`surface`
  take `children: [...]`.

**The element vocabulary is CLOSED — these 24 and no others:**
`row · col · grid · spacer · divider · surface · heading · text · caption · markdown · badge ·
statcard · meter · keyvalue · table · timeline · rating · image · icon · banner · empty · button ·
link · field`

Loading, error and empty states are the renderer's — there is no `skeleton`, `spinner` or `loading`.

**Two element shapes are worth getting right first time**, because they are where a component most
often dies:
- `keyvalue` carries `pairs: [{ label, value }]` — `label`, never `key`, and a pair takes only
  `label · value · format · currencyField` (no `tone` on a pair).
- `button` carries ONE action shape, and the rejection lists all five because it cannot tell which
  you meant: `{ mutate, input?, invalidates?, confirm?, arg?, over?, onSuccess? }` ·
  `{ navigate, params? }` · `{ download, filename?, input? }` · `{ print }` · `{ copy }`.
  There is no `endpoint` key — a write is `mutate`.

**The section rules a save-time rejection most often teaches the hard way** — a page's `sections`
follow the same vocabulary, so get them right before the writer does:
- A `detail` SECTION takes `header`/`fields`/`body` — never `item` (`item` is a LIST section's row
  template) — and its `body` is an OBJECT, not an array.
- Every section and element `id` is a plain lowerCamelCase name — letters, digits, `_` only. NO
  dashes: `overviewStats`, never `overview-stats`.
- An entry in `actions[]` takes `{ action, icon, label, reveals, tone, variant }` — there is no
  `navigate` on the entry itself; navigation rides INSIDE `action` (`{ label: 'Open', action:
  { navigate: 'books/[id]', params: { id: '$.id' } } }`).
- A page cannot COMPUTE. Every value a section binds must already be a field of its query's Output —
  a value the endpoint does not return is added to the ENDPOINT's Output and computed there.

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
The endpoint names there come from the plan VERBATIM — never renamed or tidied.

**If `w.ok` is false, DO NOT resolve yet.** `w.error` names the instance path, the offense, and the
finite set of valid values (`node.children[1].el: "chip" is not an element. Elements: row, col, …`).
Fix THAT ONE field and call `writeProjectViewComponent` again before resolving — a component that
never lands is a `{ use: … }` a page cannot resolve, and that page then fails to save.

**Build NOTHING across statements.** Each statement you emit is typechecked and evaluated on its own,
so a `const` declared in an earlier statement is not reliably in scope in a later one, and a retry
that assumes one was costs a whole turn. In
particular do NOT alias `item` (`const c = item`) and do NOT accumulate `props` in a loop. Read `item`
directly and inline the props conversion, so the write is ONE statement:

```typescript
const w = writeProjectViewComponent(item.name, {
  name: item.name,
  description: item.purpose,
  // `item.props` arrives as '<key>: <type>' strings; the writer wants an object. Inline it.
  props: Object.fromEntries(
    (Array.isArray(item.props) ? item.props : []).map((p: string) => {
      const [k, t] = String(p).split(':');
      return [String(k).trim(), (t || 'string').trim()];
    }),
  ),
  node: {
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
  },
});
```

Then, in your NEXT statement, resolve on `w`:

```typescript
currentTask.resolve({ name: item.name, ok: w.ok });
```

**If `w.ok` is false, do not resolve.** `w.error` named ONE field and the finite set of valid values.
Re-emit the whole `writeProjectViewComponent` statement with that ONE field corrected, then resolve —
never resubmit it unchanged, and never delete the offending element to silence the error. A component
that never lands is a `{ use: … }` a page cannot resolve, and that page then fails to save.
