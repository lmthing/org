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
- Read data by passing an endpoint's logical `name` to `useApi` (the same id the endpoint exported).
- IMPORT the reusable components you planned, by relative path from `pages/` to `components/`: a
  top-level page uses `../components/<Name>`, a page one directory deep uses `../../components/<Name>`.
- STYLE WITH `@lmthing/css` DESIGN TOKENS ONLY (`bg-primary`, `text-foreground`, `text-muted`,
  `border-border`) — never a raw hex, `rgb()/hsl()`, or a stock Tailwind color.

`writeProjectPage` validates the page has a default export and parses, returning `{ ok, error? }`;
rewrite and retry if `w.ok` is false. Emit one statement:

```typescript
const pg = item;
const depth = String(pg.route).split('/').length; // 'index' → 1, 'items/[id]' → 2
const up = '../'.repeat(depth);                    // '../' to reach the project root from this page
const ep = (Array.isArray(pg.endpoints) && pg.endpoints[0]) ? pg.endpoints[0]
  : (plan_endpoints.endpoints[0] ? String(plan_endpoints.endpoints[0].route).split('/')[0] : 'items-list');
const comp = (Array.isArray(pg.components) && pg.components[0]) ? pg.components[0]
  : (plan_components.components[0] ? plan_components.components[0].name : null);
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
