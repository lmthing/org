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
