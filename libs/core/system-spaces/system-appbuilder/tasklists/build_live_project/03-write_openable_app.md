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
success until all three writes have succeeded. Emit the API and both pages plus
`currentTask.resolve(...)` in the same model response; values declared here must not be used by a
later model response.

```typescript
currentTask.resolve({
  pages: ['index', '_layout'],
  endpoints: ['dashboard/GET'],
  ok: [
    writeProjectApi('dashboard/GET', '<handler that queries every write_data.tables entry>'),
    writeProjectPage('index', '<page that uses useApi on dashboard and renders actual rows>'),
    writeProjectPage('_layout', '<persistent Chat dock layout>'),
  ].every((write) => write.ok),
});
```