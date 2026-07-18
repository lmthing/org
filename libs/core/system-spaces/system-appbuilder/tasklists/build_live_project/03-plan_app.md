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

**CONVERGE — check what ALREADY EXISTS before you plan anything.** This pipeline is meant for the FIRST
whole-app build, but the SAME project can reach it twice (a retry after an interruption, a caller that
runs it again) — and a second pass that plans a fresh app from scratch produces a duplicate app sitting
beside the real one: a new table for a concept an EXISTING table already covers, under a different name
(a second sales table because the first is spelled differently), or a second home page. Read
`listProjectDir('database').entries` and `listProjectDir('pages').entries` FIRST. If the project already
has tables/pages, this is NOT a from-scratch build: name every table/page for an EXISTING concept with
its REAL, existing name — never invent a parallel one — and only add a table/page for a concept nothing
existing covers yet.

Every user story must be SERVED by the shape you plan — trace each story to the tables that hold its
data, the endpoints that read it, and the page the user opens to do it. Substitute REAL values derived
from the material for every `<…>` (never leave a placeholder). Plan for an app the user OPENS:

- **tables** — one per KIND of record the material actually contains AND can fill with real rows. Do NOT
  list a table the sources have no rows for (a created-but-empty table is the #1 failure — decide that
  HERE, where you can see everything; downstream nodes may not drop what you list).
- **every parsed source needs a home — check this before you finalize the list.** `read_sources.summary`
  sometimes carries a document that doesn't fit any of the domain-specific tables you're otherwise
  planning (a one-off receipt, a stray note unrelated to the app's main subject). Its stated values still
  have to land SOMEWHERE — do not let membership-by-kind silently drop them. Do NOT mint a table shaped
  only for that one document (that is junk-table sprawl, one throwaway table per stray item); instead add
  ONE general-purpose table (e.g. `notes`, columns like a label/detail/date and a source/origin field) that
  catches ANY number of such one-off facts across the whole material. Reserve a DEDICATED table for a
  shape only once it actually recurs — a single stray document earns a row in the general table, not a
  table of its own.
- **endpoints** — enough to read every table a page shows (at least one read per view).
- **components** — a few REUSABLE pieces (a card, a row, a stat) that repeat across pages. COUNT them
  deliberately: name each shared UI element the pages will import, not per-page markup.
- **pages** — an `index` home PLUS the list/detail/dashboard views the stories call for. Multiple pages.

Emit one statement:

```typescript
// CONVERGE first — see what this project already has before naming anything new.
const existingTables = listProjectDir('database').entries;   // e.g. ['sales.json', 'materials.json', …]
const existingPages = listProjectDir('pages').entries;
currentTask.resolve({
  title: '<human-readable app title>',
  purpose: '<one sentence: what the user opens this app to do>',
  // BINDING membership; the plan_* nodes below detail these, never change the set.
  // For a concept an existingTables entry already covers, reuse its REAL name (strip the
  // '.json') — never a fresh, differently-spelled table for the same thing.
  tables: [ { name: '<table_slug>', purpose: '<what it stores + which stories it serves, from the source>' } ],
  // Each route encodes its HTTP method last, e.g. 'items-list/GET'. Methods: GET|POST|PUT|PATCH|DELETE.
  endpoints: [ { route: '<name>/GET', purpose: '<what it returns or does>' } ],
  // Reusable UI the pages share — a card/row/badge/stat, PascalCase name. Count them.
  components: [ { name: '<ComponentName>', purpose: '<the repeated UI it renders>' } ],
  // Use 'index' for the home; add list/detail/dashboard pages the stories need.
  pages: [ { route: 'index', purpose: '<what the home shows + the story it serves>' } ],
});
```
