---
id: plan_app
output:
  title: string
  purpose: string
  tables: array
  endpoints: array
  components: array
  pages: array
dependsOn: [read_sources]
role: general
functions: []
---

Design the WHOLE app holistically before any file is written. `query` and `read_sources` (the
source-derived build brief in `read_sources.summary`) are in scope. This is the THINKING step: reason
from the material into a concrete shape, then resolve the plan object. You have no file writers here —
just produce the high-level lists that the per-category planners below will refine.

Substitute REAL values derived from the material for every `<…>` (never leave a placeholder). Plan for
an app the user OPENS: enough tables to hold every kind of record the source contains, endpoints to
read them, a few REUSABLE components (a card, a row, a stat) that repeat across pages, and MULTIPLE
pages — an `index` home plus the list/detail/dashboard views the material calls for. Emit one
statement:

```typescript
currentTask.resolve({
  title: '<human-readable app title>',
  purpose: '<one sentence: what the user opens this app to do>',
  // High-level only; plan_tables refines schemas + rows.
  tables: [ { name: '<table_slug>', purpose: '<what it stores, from the source>' } ],
  // Each route encodes its HTTP method last, e.g. 'items-list/GET'. Methods: GET|POST|PUT|PATCH|DELETE.
  endpoints: [ { route: '<name>/GET', purpose: '<what it returns or does>' } ],
  // Reusable UI the pages share — a card/row/badge/stat, PascalCase name.
  components: [ { name: '<ComponentName>', purpose: '<the repeated UI it renders>' } ],
  // Use 'index' for the home; add list/detail/dashboard pages the material needs.
  pages: [ { route: 'index', purpose: '<what the home shows>' } ],
});
```
