---
id: plan_app
output:
  title: string
  purpose: string
  tables: array
  endpoints: array
  components: array
  pages: array
dependsOn: [read_sources, user_stories]
role: general
functions: []
---

Design the WHOLE app holistically before any file is written, and OWN ITS MEMBERSHIP — this is the ONE
node that sees the whole picture, so what you list here is BINDING: the per-category planners below only
add detail, they never add or drop an artifact. `query` (the request), `read_sources`
(`read_sources.summary`, the source brief), and `user_stories` (`user_stories.stories`) are in scope.
This is the THINKING step: reason from the stories + material into a concrete shape, then resolve the
plan. You have no file writers here.

Every user story must be SERVED by the shape you plan — trace each story to the tables that hold its
data, the endpoints that read it, and the page the user opens to do it. Substitute REAL values derived
from the material for every `<…>` (never leave a placeholder). Plan for an app the user OPENS:

- **tables** — one per KIND of record the material actually contains AND can fill with real rows. Do NOT
  list a table the sources have no rows for (a created-but-empty table is the #1 failure — decide that
  HERE, where you can see everything; downstream nodes may not drop what you list).
- **endpoints** — enough to read every table a page shows (at least one read per view).
- **components** — a few REUSABLE pieces (a card, a row, a stat) that repeat across pages. COUNT them
  deliberately: name each shared UI element the pages will import, not per-page markup.
- **pages** — an `index` home PLUS the list/detail/dashboard views the stories call for. Multiple pages.

Emit one statement:

```typescript
currentTask.resolve({
  title: '<human-readable app title>',
  purpose: '<one sentence: what the user opens this app to do>',
  // BINDING membership; the plan_* nodes below detail these, never change the set.
  tables: [ { name: '<table_slug>', purpose: '<what it stores + which stories it serves, from the source>' } ],
  // Each route encodes its HTTP method last, e.g. 'items-list/GET'. Methods: GET|POST|PUT|PATCH|DELETE.
  endpoints: [ { route: '<name>/GET', purpose: '<what it returns or does>' } ],
  // Reusable UI the pages share — a card/row/badge/stat, PascalCase name. Count them.
  components: [ { name: '<ComponentName>', purpose: '<the repeated UI it renders>' } ],
  // Use 'index' for the home; add list/detail/dashboard pages the stories need.
  pages: [ { route: 'index', purpose: '<what the home shows + the story it serves>' } ],
});
```
