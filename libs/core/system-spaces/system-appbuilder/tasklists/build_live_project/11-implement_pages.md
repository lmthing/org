---
id: implement_pages
output:
  route: string
  ok: boolean
dependsOn: [plan_pages, plan_endpoints, plan_components, implement_components]
forEach: plan_pages.pages
role: general
functions: []
---

Write ONE React page into the LIVE project's `pages/`. Your page is in `item` =
{ route, purpose, endpoints, components } (`index` is the home; `items/[id]` is a dynamic route).
`plan_endpoints.endpoints` and `plan_components.components` are in scope. Write the FULL `.tsx` source
inline with the array-`join("\n")` pattern (real line breaks).

Wiring rules — the app fails to compile if you break them:
- Import data hooks ONLY from `@app/runtime` (`useApi`/`useApiMutation`/`apiCall`/`Link`/`useParams`) —
  never `fetch` a raw URL, and NEVER import `react-router`, `@radix-ui/*`, `@agent-chat/react`, or a
  relative `use-api`; none exist in a generated project.
- Read data by passing an endpoint `name` to `useApi` — the exact stable id the endpoint exported. Use
  ONLY names listed for this page in `item.endpoints` (each is a real `plan_endpoints.endpoints[].name`);
  never invent or transform a name. Every read endpoint returns `{ items: [...] }` (ALWAYS an array), so
  read `data.items` — and for a dashboard/aggregate endpoint read its single summary object as
  `data.items[0]`. NEVER read a field straight off `data` (e.g. `data.total_cost_usd`): the shape is
  always `{ items: [...] }`, so a flat field is always `undefined` and the value silently vanishes.
- The item's FIELD NAMES are fixed by the endpoint: look up this endpoint in `plan_endpoints.endpoints`,
  find its `fields`, and read ONLY those keys, EXACTLY as written (snake_case, verbatim). The endpoint
  returns those exact keys, so `item.grand_total_usd` works and a re-cased guess like
  `item.grandTotalUSD` is `undefined` → the page renders blank or crashes on `.toLocaleString()`. Never
  invent or camelCase a field name; copy it from the endpoint's `fields`.
- IMPORT the reusable components you planned, by relative path from `pages/` to `components/`: a
  top-level page uses `../components/<Name>`, a page one directory deep uses `../../components/<Name>`.
- **NEVER import a component that failed to write.** `implement_components` (an upstream dependency, in
  scope by its task id) is that node's own per-item `{ name, ok }[]` results — the SAME array
  `12-finalize` filters. Before importing ANY planned component, check it is actually in THAT ok-list
  (`ok === true` for its name), not merely in `plan_components.components` (the plan) or in
  `item.components` (this page's wishlist) — a component can be planned and still have failed to
  land. If a component this page wants is NOT in the ok-list, do not import it or reference it on this
  page at all: drop the dependent markup and render the row/value inline instead. One page with a
  dangling import to a component that never landed fails the WHOLE app's build, not just this page —
  this check is cheap; skipping it is not.
- LINK BETWEEN PAGES with `<Link>` (from `@app/runtime`) to a page's ROUTE, authored base-agnostic:
  the route is the page's file path under `pages/` WITHOUT the `pages/` prefix or the `.tsx`
  (`pages/park-fees.tsx` → `to="/park-fees"`, `pages/index.tsx` → `to="/"`, `pages/items/[id].tsx` →
  `` to={`/items/${id}`} ``). NEVER prefix `/pages/` (the on-disk folder name is NOT part of the URL —
  `to="/pages/park-fees"` 404s as "No page for /pages/park-fees") and NEVER hard-code `/app/<project>/…`
  (`Link` re-adds the base). A leading slash is required so the base resolves.
- STYLE WITH `@lmthing/css` DESIGN TOKENS ONLY (`bg-primary`, `text-foreground`, `text-muted`,
  `border-border`) — never a raw hex, `rgb()/hsl()`, or a stock Tailwind color.
- GUARD NULLS. Every DB column is NULLABLE, so any value you read may be null/undefined — real parsed
  data routinely leaves fields blank. Never use a value in a way that a null would break (calling a
  method on it, reading a property, indexing, passing it somewhere non-null). COALESCE first:
  `value ?? fallback` (e.g. `amount ?? 0`, `items ?? []`, `label ?? '—'`), then use the result. One
  unguarded use crashes the whole page the moment a row's field is null.
- NEVER HARDCODE A LITERAL IN PLACE OF LIVE DATA. A component prop that represents a real figure (a
  total, a count, a computed value) must be read from `data.items[0].<field>` off one of `item.endpoints`
  — never a bare number/string typed straight into the JSX (`usdTotal={0}`, `count={12}`). A missing
  null is a crash you'd notice; a hardcoded placeholder compiles clean and LOOKS like a real value while
  quietly showing nothing the user has — the worse failure because nothing flags it. If no endpoint on
  this page supplies a component's figure, that is a PLANNING gap (`item.endpoints` is missing one) —
  do not paper over it with a literal; the fix is upstream, not a stand-in value.

`writeProjectPage` validates the page has a default export and parses, returning `{ ok, error? }`;
rewrite and retry if `w.ok` is false. Emit one statement:

```typescript
const pg = item;
const depth = String(pg.route).split('/').length; // 'index' → 1, 'items/[id]' → 2
const up = '../'.repeat(depth);                    // '../' to reach the project root from this page
const ep = (Array.isArray(pg.endpoints) && pg.endpoints[0]) ? pg.endpoints[0]
  : (plan_endpoints.endpoints[0] ? plan_endpoints.endpoints[0].name : 'items-list');
// Cross-check against implement_components' OWN ok-list — planned is not the same as landed.
const okComponentNames = (Array.isArray(implement_components) ? implement_components : [])
  .filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const wantedComp = (Array.isArray(pg.components) && pg.components[0]) ? pg.components[0]
  : (plan_components.components[0] ? plan_components.components[0].name : null);
const comp = (wantedComp && okComponentNames.includes(wantedComp)) ? wantedComp : null;
const src = [
  "import { useApi } from '@app/runtime';",
  comp ? ("import " + comp + " from '" + up + "components/" + comp + "';") : "",
  "",
  "export default function Page() {",
  "  const { data, isLoading, error } = useApi<{ items: { id: string; title?: string }[] }>('" + ep + "');",
  "  if (isLoading) return <p className=\"p-4 text-muted\">Loading…</p>;",
  "  if (error) return <p className=\"p-4 text-destructive\">Could not load data.</p>;",
  "  return (",
  "    <main className=\"space-y-2 p-4\">",
  "      {(data?.items ?? []).map((it) => (",
  comp ? ("        <" + comp + " key={it.id} title={it.title ?? it.id} />") : "        <div key={it.id} className=\"text-foreground\">{it.title ?? it.id}</div>",
  "      ))}",
  "    </main>",
  "  );",
  "}",
].filter((line) => line !== "").join("\n");
const w = writeProjectPage(pg.route, src);
currentTask.resolve({ route: pg.route, ok: w.ok });
```

The page TSX is typechecked against a **NO-DOM ambient** (no `console`/`window`). Data comes only from
`useApi(<endpoint name>)`; the endpoint name is one of `item.endpoints`, copied VERBATIM.

✅ **The page source should look like this** (hooks from `@app/runtime`, verbatim endpoint name, component
by relative path, tokens, reads `data.items`):

```tsx
import { useApi } from '@app/runtime';
import CostCard from '../components/CostCard';

export default function Page() {
  const { data, isLoading, error } = useApi<{ items: { id: string; title?: string }[] }>('cost-lines');
  if (isLoading) return <p className="p-4 text-muted">Loading…</p>;
  if (error) return <p className="p-4 text-destructive">Could not load data.</p>;
  return (
    <main className="space-y-2 p-4">
      {(data?.items ?? []).map((it) => <CostCard key={it.id} title={it.title ?? it.id} />)}
    </main>
  );
}
```

❌ **Never emit any of these** — each one fails the compile or breaks the wiring:

```tsx
import { useRoute } from 'react-router';          // ✗ react-router is not in a generated project
import * as Dialog from '@radix-ui/react-dialog'; // ✗ no @radix-ui
import { useApi } from '../use-api';              // ✗ hooks come ONLY from '@app/runtime'
useApi('costLines');                              // ✗ invented / transformed name — use item.endpoints verbatim
const total = data?.total_cost_usd;               // ✗ read data.items[0].total_cost_usd — never a field off data
const t = data?.items?.[0]?.grandTotalUSD;        // ✗ re-cased guess — read the endpoint's exact field: grand_total_usd
{row.amount.toLocaleString()}                     // ✗ amount may be null → crashes the whole page; use (row.amount ?? 0).toLocaleString()
<Link to="/pages/park-fees">Fees</Link>          // ✗ no `/pages/` prefix — link to the route: to="/park-fees"
<Link to="/app/trip/park-fees">Fees</Link>       // ✗ never hard-code the base — Link re-adds it: to="/park-fees"
const res = await fetch('/api/cost-lines');       // ✗ no raw fetch — read through useApi
<div className="text-blue-600">                   // ✗ stock Tailwind color — use text-foreground
console.log(data);                                // ✗ Cannot find name 'console' — no DOM lib
import Missing from '../components/Missing';      // ✗ imported without checking implement_components'
                                                   //   ok-list — if Missing failed to write, this import
                                                   //   resolves to nothing and fails the WHOLE app build,
                                                   //   not just this page; drop it and render inline instead
```
