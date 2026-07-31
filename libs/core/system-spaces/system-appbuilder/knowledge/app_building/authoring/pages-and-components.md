---
description: LOAD WHEN you are about to author a PAGE and the read API behind it, or you notice the same piece of UI on a second page. What makes data visible, and when repeated markup earns a writeProjectComponent.
---

# When the automation needs to be SEEN (a live app page)

When the user wants to *view* what an automation produces — "a page for X", "an activity
feed on the app home page", "show me my bookings" — author it INTO THE LIVE PROJECT so it
serves at `/app/<project>/`: (1) `writeProjectTable` for the data, (2) `writeProjectApi` for
a `GET` endpoint that reads it, (3) `writeProjectPage` for the page that renders it via
`useApi`. This is the live twin of the appbuilder's catalog writers — use it whenever you are
adding to the project the user is already working in, so the app grows in place (no separate
install). The old catalog writers (`writePage`/`writeApi`/`writeTableSchema`) are GONE — they targeted the
store catalog, not a live project. `writeProject*` is the only writer family; a call to one of the
removed names is a typecheck error (not granted ⇒ absent from the DTS).

```typescript
const w = writeProjectApi('activity-list/GET', [
  "export const name = 'activity-list';",
  "export const description = 'Recent activity, newest first.';",
  "export interface Input {}",
  "export interface Output { items: any[] }",
  "export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {",
  "  const items = await ctx.db.query('activity', { orderBy: { createdAt: 'desc' }, limit: 50 });",
  "  return { items };",
  "}",
].join("\n"));
const p = writeProjectPage('index', [
  "import { useApi } from '@app/runtime';",
  "export default function Home() {",
  "  const { data, isLoading } = useApi<{ items: { id: string; summary: string }[] }>('activity-list');",
  "  if (isLoading) return <p className=\"text-muted-foreground p-4\">Loading…</p>;",
  "  return (<ul className=\"divide-y divide-border\">{(data?.items ?? []).map((a) => (",
  "    <li key={a.id} className=\"p-3 text-foreground\">{a.summary}</li>))}</ul>);",
  "}",
].join("\n"));
display(p.ok && w.ok ? 'wrote the activity feed page + api' : ('app write error: ' + (p.error ?? w.error)));
```

### The piece that appears on more than one page is a COMPONENT

The moment the SAME piece of UI shows up on a second page — a row card, a status pill, a summary
tile, an empty state — stop copying it and give it a name with `writeProjectComponent('<Name>',
src)` (`components/<Name>.tsx`, PascalCase), then import it by relative path from each page that
needs it. Type its props with the row type the app already generates rather than re-describing the
shape by hand:

```typescript
const c = writeProjectComponent('ItemCard', [
  "import type { Order } from '@app/types';",   // the generated row types — one source of truth
  "export function ItemCard({ item }: { item: Order }) {",
  "  return (<div className=\"rounded-lg border border-border p-3\">",
  "    <p className=\"text-foreground font-medium\">{item.reference}</p>",
  "  </div>);",
  "}",
].join("\n"));
// …and in a page:  import { ItemCard } from '../components/ItemCard';
```

Copy-pasted markup is how two pages start disagreeing about the same thing: one gets the fix, the
other keeps the bug. Two copies of a card is the point to factor it, not five.
