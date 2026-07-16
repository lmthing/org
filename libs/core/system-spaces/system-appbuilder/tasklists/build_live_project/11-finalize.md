---
id: finalize
output:
  ok: boolean
  tables: array
  endpoints: array
  components: array
  pages: array
dependsOn: [implement_tables, implement_endpoints, implement_components, implement_pages]
goal: true
role: general
functions: []
---

Complete and package the build. This is the GOAL task — it ALWAYS runs and ALWAYS resolves a uniform
summary. Upstream per-item arrays arrive by task id: `implement_tables` ({ name, ok }[]),
`implement_endpoints` ({ route, name, ok }[]), `implement_components` ({ name, ok }[]),
`implement_pages` ({ route, ok }[]).

First make the app OPENABLE by writing the persistent chat layout `_layout` with the `<Chat
agent="thing" />` dock — receive `children` and render them directly with the dock (NOT an `Outlet`);
import `Chat` only from `@app/runtime`. Then keep only the pieces that wrote ok and resolve the
summary. Emit one statement:

```typescript
const layout = writeProjectPage('_layout', [
  "import type { ReactNode } from 'react';",
  "import { Chat } from '@app/runtime';",
  "export default function Layout({ children }: { children: ReactNode }) {",
  "  return <>{children}<Chat agent=\"thing\" /></>;",
  "}",
].join("\n"));
const okTables = (Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okEndpoints = (Array.isArray(implement_endpoints) ? implement_endpoints : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const okComponents = (Array.isArray(implement_components) ? implement_components : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okPages = (Array.isArray(implement_pages) ? implement_pages : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
currentTask.resolve({
  ok: layout.ok && okTables.length > 0 && okPages.length > 0,
  tables: okTables,
  endpoints: okEndpoints,
  components: okComponents,
  pages: okPages.concat(layout.ok ? ['_layout'] : []),
});
```
