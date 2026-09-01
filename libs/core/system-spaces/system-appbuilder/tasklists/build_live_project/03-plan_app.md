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
`listProjectDir('database').entries` and `listProjectDir('views').entries` FIRST — pages are `.view.json`
specs under `views/`, never `pages/`. If the project already has tables/pages, this is NOT a from-scratch build: name every table/page for an EXISTING concept with
its REAL, existing name — never invent a parallel one — and only add a table/page for a concept nothing
existing covers yet.

**Every project is born as a CHAT PAGE — your build replaces it.** A fresh project ships one
placeholder page, `views/index.view.json`, whose only section is a full-height `chat`. That is the
starting app, not a page to preserve: plan a real `index` home (a dashboard/overview or the primary
collection) and it OVERWRITES the placeholder when `implement_views` writes `index`. The chat is not
lost — the assistant dock is on every page automatically, so the conversation relocates into a
floating modal. Do not plan a `chat`-only landing, and do not treat the placeholder as existing work
to converge with; `listProjectDir('database')` being empty is the real signal this is a first build.

**And an INCREMENTAL request BOUNDS your membership.** When the project already has tables/pages and the
request names a specific addition or change, plan ONLY the artifacts the request names plus what those
artifacts structurally require to work (the table a requested view must read, the endpoint a requested
form must call, a column an existing table needs for the change). Do NOT re-model, rename, or newly model
unrelated concepts in the same pass: source material that earlier builds left unmodeled is NOT an
invitation to model it now, and an existing table/page/endpoint the request does not touch is left
exactly as it is. A grow pass that ships artifacts nobody asked for is churn the user has to distrust —
scope is part of correctness.

Every user story must be SERVED by the shape you plan — trace each story to the tables that hold its
data, the endpoints that read it, and the page the user opens to do it. Substitute REAL values derived
from the material for every `<…>` (never leave a placeholder). Plan for an app the user OPENS:

- **tables** — one per KIND of record the material actually contains AND can fill with real rows. Do NOT
  list a table the sources have no rows for (a created-but-empty table is the #1 failure — decide that
  HERE, where you can see everything; downstream nodes may not drop what you list). Table names are
  snake_case identifiers (underscores) — the table writer REJECTS any other shape, so a
  hyphenated/kebab-case name minted here guarantees a downstream write failure; endpoint routes and ids
  are kebab-case. Never let the two conventions cross.
- **every parsed source needs a home — check this before you finalize the list.** `read_sources.summary`
  sometimes carries a document that doesn't fit any of the domain-specific tables you're otherwise
  planning (a one-off receipt, a stray note unrelated to the app's main subject). Its stated values still
  have to land SOMEWHERE — do not let membership-by-kind silently drop them. Do NOT mint a table shaped
  only for that one document (that is junk-table sprawl, one throwaway table per stray item); instead add
  ONE general-purpose table (e.g. `notes`, columns like a label/detail/date and a source/origin field) that
  catches ANY number of such one-off facts across the whole material. Reserve a DEDICATED table for a
  shape only once it actually recurs — a single stray document earns a row in the general table, not a
  table of its own.
- **a shared keyword or theme between two facts is NOT evidence they are the same real-world instance —
  count them separately.** When you tally how many rows a table needs, a vision/audio-described item
  (something photographed or spoken about, with its OWN distinguishing details — a color, a shape, a
  material, a marking) is a DIFFERENT record from an unrelated mention elsewhere that merely uses a
  similar word (a technique name, a category, a material name appearing in an unrelated ledger note or
  line item). Merge two facts into one row ONLY when another source explicitly ties them together — a
  matching id, order/reference number, or SKU — never because they mention the same noun. If your own
  count silently drops from N sources to fewer rows because two of them "are basically the same thing,"
  that drop is the bug: re-open your count and give the vision/audio item its own row with its own
  details, distinct from whatever unrelated fact happens to share the word.
- **endpoints** — enough to read every table a page shows, and shaped for the SECTION that reads them:
  in this builder **one section reads exactly ONE endpoint**, and that endpoint's response must carry
  every value the section shows. So plan an endpoint PER VIEW, not per table — a page with a stats
  strip and a list needs two endpoints, and a list that shows a name from another table needs that
  name as a field on its OWN endpoint. Joins and selections are the endpoint's job here, never the
  page's. **Shape the route for what identifies the record.** A collection-wide read sits at a
  param-less route (`items-list/GET`, `orders/stats/GET`). An endpoint that reads/edits/deletes ONE
  record takes that record's id as a `[param]` ROUTE segment — `items/[id]/GET`, `items/[id]/PATCH`,
  `items/[id]/DELETE` — the same `[param]` its detail page's route declares (below): the page's
  `$route.id` fills that segment, and that is what puts the id on the handler's input. Never spell a
  single-record endpoint flat (`items-detail/GET`): a flat route carries nothing that tells a caller
  an id is required, it desyncs from the `items/[id]` page that calls it, and it invites the
  second-spelling collision warned about below. **An endpoint's `route` is a FIXED contract, set once here.** The route path and the
  endpoint's `name` are ONE logical artefact: a later step that re-spells the same endpoint's route
  differently (e.g. writing the same handler to `exercise-summary/GET` in one pass and to
  `exercises/summary/GET` in the next) leaves TWO files, each `export const name` a unique-per-project
  value, so the second writer is rejected with "the name \"exercise-summary\" is already used by …".
  Pick ONE `route` for each endpoint and reuse that EXACT string everywhere downstream — never a
  different spelling, never a singular/plural variant, never a path that renames the same endpoint.
- **components** — a few REUSABLE VIEW COMPONENTS (a card, a row, a stat shape) that repeat across
  pages. These are **spec fragments — compositions of the element vocabulary with declared props** —
  never React and never TSX. COUNT them deliberately: name each shared shape the pages will reference
  by `{ use: '<Name>' }`, not per-page markup.
- **pages** — an `index` home PLUS the list/detail/dashboard views the stories call for. Multiple pages.
  A DETAIL page is ALWAYS a `[param]` route (`dogs/[id]`) reached from its list page's `rowAction` —
  never a param-less `dog-detail` route, and never a nav entry: nav holds LIST pages only.
  Each page is a SPEC: an ordered list of sections drawn from a closed menu of 8 kinds — `list`,
  `detail`, `create`, `stats`, `markdown`, `chat`, `toolbar`, `timeline`. Plan pages you can build
  from those kinds. If a story needs a surface none of them expresses, say so PLAINLY in that page's
  `purpose` ("the compare grid needs a multi-select the spec language has no way to express") — an
  honest gap is a correct answer here and gets routed elsewhere; a page forced into the wrong section
  kind is the failure this pipeline measures.

## Great UX is part of the plan, not a later polish

A build that typechecks but reads like a database admin panel has failed the user. Design for a
person, using the levers this vocabulary already gives you:

- **Task-first, not table-first.** Pages are built from the STORIES, never one-page-per-table. A
  reflexive page per table is the classic generated-app tell. Group what the user does together.
- **The landing earns its role.** `index` answers "what's the state of my world / what do I do here"
  — a `stats` strip over the primary collection, or that collection itself — never a bare table dump.
- **Smallest useful thing first.** Deliver the payoff of the stories that were actually asked for;
  a story nobody told you is not a page to invent. Scope is part of correctness (above).
- **Everything actionable is actionable.** If a row represents something the user acts on (mark done,
  pay, archive, edit), plan the endpoint that flips it (server-side — the spec has no `!`) and a
  `rowAction`/`toolbar` for it. A read-only wall is poor UX.
- **Consistency through components.** A repeated card/row shape becomes ONE reusable view component so
  the app feels of a piece, not hand-cut per page.
- **Meaning through hierarchy.** Plan `stats` for at-a-glance status and lean on `tone`/`toneMap`
  (good/bad/neutral) and `format` so numbers, money and dates read correctly — detailed in the view step.

Emit one statement:

```typescript
// CONVERGE first — see what this project already has before naming anything new.
const existingTables = listProjectDir('database').entries;   // e.g. ['sales.json', 'materials.json', …]
const existingPages = listProjectDir('views').entries;
currentTask.resolve({
  title: '<human-readable app title>',
  purpose: '<one sentence: what the user opens this app to do>',
  // BINDING membership; the plan_* nodes below detail these, never change the set.
  // For a concept an existingTables entry already covers, reuse its REAL name (strip the
  // '.json') — never a fresh, differently-spelled table for the same thing.
  tables: [ { name: '<table_slug>', purpose: '<what it stores + which stories it serves, from the source>' } ],
  // Each route encodes its HTTP method last; methods: GET|POST|PUT|PATCH|DELETE. A collection-wide
  // read is param-less ('items-list/GET'); a ONE-record endpoint carries the record's [id]
  // ('items/[id]/GET', 'items/[id]/PATCH', 'items/[id]/DELETE') — never a flat 'items-detail/GET'.
  endpoints: [
    { route: 'items-list/GET', purpose: '<what it returns or does>' },
    { route: 'items/[id]/GET', purpose: '<the one record it returns/edits>' },
  ],
  // Reusable VIEW components the pages share — a card/row/stat SHAPE, PascalCase name. Count them.
  // These are element compositions (spec fragments), never React.
  components: [ { name: '<ComponentName>', purpose: '<the repeated UI it renders>' } ],
  // Use 'index' for the home; add list/detail/dashboard pages the stories need.
  pages: [ { route: 'index', purpose: '<what the home shows + the story it serves>' } ],
});
```
