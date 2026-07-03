---
id: build_page
output:
  route: string
  ok: boolean
dependsOn: [design, build_api]
forEach: design.pages
role: general
functions: []
---

Write ONE React page into the project's `pages/`. Your page is in `item` = { route, purpose }
(`index` is the app root; `items/[id]` is a dynamic route). Write the FULL `.tsx` source inline.
Import data hooks from `@app/runtime` (`useApi`/`useApiMutation`/`apiCall`/`Link`/`useParams`) —
never `fetch` a raw URL — and read from the endpoints you built. STYLE WITH `@lmthing/css` DESIGN
TOKENS ONLY: use classes like `bg-primary`, `text-foreground`, `text-muted`, `border-border` —
never a raw hex, `rgb()/hsl()`, or a stock Tailwind color (`gray-500`, `blue-600`). Emit:

const pg = item;
const ep = design.endpoints[0] ? design.endpoints[0].route.split('/')[0] : 'items-list';
const src = [
  "import { useApi } from '@app/runtime';",
  "",
  "export default function Page() {",
  "  const { data, isLoading } = useApi<{ items: { id: string; title: string }[] }>('" + ep + "');",
  "  if (isLoading) return <p className=\"text-muted p-4\">Loading…</p>;",
  "  return (",
  "    <ul className=\"divide-y divide-border\">",
  "      {(data?.items ?? []).map((it) => (",
  "        <li key={it.id} className=\"p-3 text-foreground\">{it.title}</li>",
  "      ))}",
  "    </ul>",
  "  );",
  "}",
].join("\n");
const w = writePage(pg.route, src);
// w = { ok, error? }. Rewrite and retry if w.ok is false.
currentTask.resolve({ route: pg.route, ok: w.ok });
