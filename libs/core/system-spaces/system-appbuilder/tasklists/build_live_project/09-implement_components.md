---
id: implement_components
output:
  name: string
  ok: boolean
dependsOn: [plan_components]
forEach: plan_components.components
role: general
functions: []
---

Write ONE reusable component into the LIVE project's `components/`. Your component is in `item` =
{ name, purpose, props }. Call `writeProjectComponent(item.name, src)` — the name MUST be PascalCase
and the source MUST have a DEFAULT export (the component a page renders); the writer validates both and
that it parses as TSX, returning `{ ok, error? }`. Write the FULL `.tsx` source inline with the
array-`join("\n")` pattern. This is presentational UI: take the record/value via props and render it —
do NOT fetch data here (pages pass data in). STYLE WITH `@lmthing/css` DESIGN TOKENS ONLY (`bg-card`,
`text-foreground`, `text-muted`, `border-border`, `bg-primary`) — never a raw hex, `rgb()/hsl()`, or a
stock Tailwind color (`gray-500`, `blue-600`). Import only from `react`/`@app/runtime` if needed.
`@app/runtime` exports ONLY `apiCall`, `HttpError`, `useApi`, `useApiMutation`, `useParams`, `Link`,
`navigate`, and `Chat`; do not import utility helpers such as `cn`, `clsx`, or `classNames`. Emit
one statement:

```typescript
const c = item;
const src = [
  "export default function " + c.name + "({ title, subtitle }: { title: string; subtitle?: string }) {",
  "  return (",
  "    <div className=\"rounded-lg border border-border bg-card p-3\">",
  "      <p className=\"font-medium text-foreground\">{title}</p>",
  "      {subtitle ? <p className=\"text-sm text-muted\">{subtitle}</p> : null}",
  "    </div>",
  "  );",
  "}",
].join("\n");
const w = writeProjectComponent(c.name, src);
currentTask.resolve({ name: c.name, ok: w.ok });
```

The TSX you assemble is typechecked against a **NO-DOM ambient** (no `console`/`window`) and is
presentational only — the data arrives through props, never a fetch.

✅ **The component source should look like this** (default export, PascalCase, props in, design tokens):

```tsx
export default function CostCard({ title, amount }: { title: string; amount?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="font-medium text-foreground">{title}</p>
      {amount ? <p className="text-sm text-muted">{amount}</p> : null}
    </div>
  );
}
```

❌ **Never emit any of these**:

```tsx
import { useApi } from '@app/runtime';           // ✗ components don't fetch — the page passes data in
import { cn } from '@app/runtime';               // ✗ not exported; no cn / clsx / classNames anywhere
<div className="bg-gray-100 text-blue-600">      // ✗ stock Tailwind colors — use bg-card / text-foreground
<div style={{ color: '#0a0a0a' }}>               // ✗ raw hex — use a token (text-foreground)
console.log(title);                              // ✗ Cannot find name 'console' — no DOM lib
```
