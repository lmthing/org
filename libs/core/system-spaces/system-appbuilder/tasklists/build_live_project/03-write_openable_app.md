---
id: write_openable_app
output:
  pages: array
  endpoints: array
  ok: boolean
dependsOn: [write_data]
goal: true
role: general
functions: []
---

Make the LIVE project openable now. `query` and `write_data` are in scope. If `write_data.ok` is
false, resolve `{ pages: [], endpoints: [], ok: false }` immediately — no API or page can be a
successful app without its source rows. Otherwise, do not inspect, survey, or re-seed the project:
the preceding node already wrote its source-derived tables. Write a project `GET` API that queries
the real rows from every table in `write_data.tables`, then write an `index` page that calls that API
with `useApi` and visibly renders real counts and values. Also write `_layout` with the persistent
`<Chat agent="thing" />` dock. Use design tokens only. This is the completion boundary: do not report
success until all three writes have succeeded.

Every `writeProjectApi` source is a complete endpoint ESM module, not just a request handler. It
MUST export a unique string `name`, a `description`, `Input` and `Output` interfaces, and a default
async handler that reads through `ctx.db`. The `name` is the same stable identifier the page passes
to `useApi`; without it, the endpoint loader rejects the whole app before any page can compile.

Every page source must use the project runtime and nothing else: import `useApi` and `Chat` only from
`@app/runtime`; use ordinary React markup and design-token utility classes. Do NOT import
`react-router`, `@agent-chat/react`, `@radix-ui/themes`, a relative `use-api` module, or any other
package. Those packages are unavailable in a generated project and make every page fail to compile.
The layout receives `children`; render them directly with the `Chat` dock, not an `Outlet`.

Emit the API and both pages plus `currentTask.resolve(...)` in the same model response; values
declared here must not be used by a later model response.

```typescript
currentTask.resolve({
  pages: ['index', '_layout'],
  endpoints: ['dashboard/GET'],
  ok: [
    writeProjectApi('dashboard/GET', [
      "export const name = 'dashboard';",
      "export const description = 'Read the project dashboard.';",
      "export interface Input {}",
      "export interface Output { data: Record<string, unknown[]> }",
      "export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {",
      "  return { data: {} };",
      "}",
    ].join("\\n")),
    writeProjectPage('index', [
      "import { useApi } from '@app/runtime';",
      "export default function IndexPage() {",
      "  const { data, isLoading, error } = useApi('dashboard');",
      "  if (isLoading) return <p className=\"p-4 text-muted\">Loading…</p>;",
      "  if (error) return <p className=\"p-4 text-destructive\">Could not load data.</p>;",
      "  return <main className=\"p-4 text-foreground\">{JSON.stringify(data)}</main>;",
      "}",
    ].join("\\n")),
    writeProjectPage('_layout', [
      "import type { ReactNode } from 'react';",
      "import { Chat } from '@app/runtime';",
      "export default function Layout({ children }: { children: ReactNode }) {",
      "  return <>{children}<Chat agent=\"thing\" /></>;",
      "}",
    ].join("\\n")),
  ].every((write) => write.ok),
});
```