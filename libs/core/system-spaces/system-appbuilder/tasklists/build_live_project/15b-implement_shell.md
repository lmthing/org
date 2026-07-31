---
id: implement_shell
output:
  ok: boolean
  navCount: number
  error: string
dependsOn: [plan_app, plan_views, implement_views]
role: general
functions: []
---

Write the app SHELL — the one spec that makes the app navigable and gives it its assistant dock. This
is the spec replacement for the hand-written `_layout.tsx`, and it runs HERE, before the verify gate,
because the app-wide checks ask "is every route reachable from the nav?" — a shell written after them
would be a shell nothing checked.

In scope: `plan_app` (`title`, `pages`) and `implement_views` (the per-page `{ route, ok, error }[]` —
the routes that ACTUALLY landed). The writer is

```
writeProjectViewShell(shell: unknown): { ok: boolean; error?: string }
```

— ONE argument, a plain object literal (never a JSON string), landing at `pages/_shell.view.json`.
It is synchronous and returns `{ ok, error? }`: branch on `w.ok`, read `w.error`; never treat it as
an array and never `await` it.

Rules the writer enforces:
- **A nav entry's `route` must be a real, landed, STATIC route.** A parameterised route
  (`trips/[tripId]`, `feed/[articleId]`) is a drill-in reached by a `rowAction`, never a nav item.
  Build the nav from `implement_views` entries with `ok: true`, dropping every route containing `[`.
- **`index` is the home** and should be the first nav entry.
- **Up to 5 top-level destinations, list them flat in `nav`.** Above that, GROUP them: an unusable
  13-item bottom bar is the measured failure. Each group is `{ label, home, routes: [...], icon }` —
  `home` is the route the tab opens, `routes` the family it stays highlighted for.
- **Per-entity sub-navigation** — when several pages share a parameterised prefix
  (`trips/[tripId]/expenses`, `trips/[tripId]/timeline`), declare it ONCE:
  `subnav: [{ match: 'trips/[tripId]', items: [{ route: 'trips/[tripId]/expenses', label: 'Expenses' }] }]`.
  Without it those pages cannot reach each other at all.
- **`assistant: { agent: 'thing' }`** puts the persistent chat dock on every page. Always include it.
- Icons come from a fixed set — `home search plus edit trash check close chevron-right chevron-down
  arrow-left filter more refresh calendar clock user users tag file map-pin alert info star bell chart
  list link external-link download upload mail settings`. `label` and `icon` are both optional.

Resolve honestly: if `w.ok` is false, read `w.error` (it names the offending entry and why), correct
that ONE field and write again before resolving. Emit one statement:

```typescript
const landed = (Array.isArray(implement_views) ? implement_views : [])
  .filter((p: { ok: boolean }) => p.ok)
  .map((p: { route: string }) => p.route);
// Nav destinations = landed, top-level, STATIC routes. `index` first; drill-ins are not nav items.
const navRoutes = landed
  .filter((r: string) => !r.includes('[') && !r.startsWith('_'))
  .sort((a: string, b: string) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));
const label = (r: string) => r === 'index'
  ? 'Home'
  : r.split('/').pop()!.replace(/-/g, ' ').replace(/^./, (ch: string) => ch.toUpperCase());
const shell = {
  brand: plan_app.title,
  // ≤5 destinations: flat. More than that: replace `nav` with `groups` (see the rule above).
  nav: navRoutes.slice(0, 5).map((r: string) => ({ route: r, label: label(r) })),
  assistant: { agent: 'thing' },
};
const w = writeProjectViewShell(shell);
currentTask.resolve({ ok: w.ok, navCount: shell.nav.length, error: w.ok ? '' : (w.error ?? 'shell write failed') });
```
