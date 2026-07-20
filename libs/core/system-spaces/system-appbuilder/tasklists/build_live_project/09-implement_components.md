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
`text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`) — never a raw hex,
`rgb()/hsl()`, or a stock Tailwind color (`gray-500`, `blue-600`). Muted TEXT is
`text-muted-foreground` — NEVER `text-muted` (that resolves to the `--muted` BACKGROUND token, so it
compiles clean but renders text the same color as the surface behind it). Import only from
`react`/`@app/runtime` if needed.
`@app/runtime` exports ONLY `apiCall`, `HttpError`, `useApi`, `useApiMutation`, `useParams`, `Link`,
`navigate`, and `Chat`; do not import utility helpers such as `cn`, `clsx`, or `classNames`.

**If `w.ok` is false, DO NOT resolve yet.** Read `w.error` — it names the concrete problem (a parse
error at a line/column, a missing default export, an unresolved import) — construct a CORRECTED source
that fixes exactly that mistake, and call `writeProjectComponent` a second time before resolving. A
common concrete cause: a JSX `{...}` expression container holds exactly ONE expression — a stray
trailing comma after it (`{ a ? x : y, }`) is a comma with nothing following, which is a syntax error,
not a harmless list-style trailing comma. Never resolve `{ ok: false }` (or a stale `{ ok: true }`) off
the FIRST attempt without reading `w.error` and retrying: a component that never actually lands on disk
still gets imported by a page downstream (`implement_pages` doesn't re-verify), and one dangling import
fails the WHOLE app's build, not just this component — the entire app becomes unopenable over one
unwritten file. Emit one statement:

```typescript
const c = item;
const src = [
  "export default function " + c.name + "({ title, subtitle }: { title: string; subtitle?: string }) {",
  "  return (",
  "    <div className=\"rounded-lg border border-border bg-card p-3\">",
  "      <p className=\"font-medium text-foreground\">{title}</p>",
  "      {subtitle ? <p className=\"text-sm text-muted-foreground\">{subtitle}</p> : null}",
  "    </div>",
  "  );",
  "}",
].join("\n");
const w = writeProjectComponent(c.name, src);
if (w.ok) {
  currentTask.resolve({ name: c.name, ok: true });
} else {
  // w.error named the exact mistake — e.g. a stray trailing comma inside a JSX expression
  // container, an unclosed tag, a missing default export. Fix THAT problem in a corrected
  // source (never just resubmit the same broken string) and retry once before giving up.
  const fixedSrc = src; // replace with `src` corrected for the specific issue in w.error
  const w2 = writeProjectComponent(c.name, fixedSrc);
  currentTask.resolve({ name: c.name, ok: w2.ok });
}
```

The TSX you assemble is typechecked against a **NO-DOM ambient** (no `window`/`document`; `console`,
`fetch`, `crypto` and the timers are available) and is
presentational only — the data arrives through props, never a fetch.

✅ **The component source should look like this** (default export, PascalCase, props in, design tokens):

```tsx
export default function CostCard({ title, amount }: { title: string; amount?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="font-medium text-foreground">{title}</p>
      {amount ? <p className="text-sm text-muted-foreground">{amount}</p> : null}
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
<span className={
  "font-medium " + (ok ? "text-foreground" : "text-muted-foreground"),
}>                                                // ✗ trailing comma after the expression — a JSX
                                                  //   `{...}` container holds exactly ONE expression;
                                                  //   a comma with nothing after it fails to parse and
                                                  //   the write is silently rejected
<p className="text-sm text-muted">{amount}</p>   // ✗ text-muted resolves to the --muted BACKGROUND
                                                  //   color, not a text color — compiles clean, renders
                                                  //   near-invisible; use text-muted-foreground
```
