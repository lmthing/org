# APPFORMAT_IMPROVE — the app format v2, and the plan that gets us there

Companion to [`APPFORMAT.md`](./APPFORMAT.md), which describes what exists today. This document is
the **target** and the **implementation plan**. Every failure quoted is a real one from `.issues/` or
a scenario run on disk.

**The goal:** the builder either ships an app that *works* — opens, renders real data on every route,
and every action a user can see actually lands — or it ships less of one and says so. Never a green
report over a 404.

---

## 1. The one shape behind every shipped defect

Every appbuilder defect on record is the same bug wearing different clothes: **a name or a value
authored twice, in two files, reconciled afterwards by a gate.**

| authored twice | what shipped | evidence |
|---|---|---|
| handler body ↔ its own `Input` interface | 17 typecheck errors, app 404 after a 968-second "successful" build | `.issues/viewbuilder-app-fails-its-own-typecheck.md` |
| view specs ↔ endpoints | 6 view specs, **`endpointCount: 0`** — nothing to fetch | same |
| route names ↔ route names | `create-job` *and* `jobs/create`; `job/[id]` *and* `jobs/[id]` *and* `jobs/detail` | same |
| endpoint's queried table ↔ the schema | `actual-payments-list` 500s; the table was never created | `.issues/appbuilder-completeness-endpoint-table-gap.md` |
| a page's `useApi('costs-summary')` ↔ the endpoint list | "TOTAL COST" reads **€0** over €2,707 of real data; `built:true`, page 200 | same |
| a page's render tree ↔ JSX | `{ type, props }` objects returned from `Page()` — typechecks, React #31 at runtime | same |
| a column for a fact ↔ the column already on the table | 18 columns for 7 facts, two conflicting `status` vocabularies | `.issues/second-build-duplicates-columns-on-the-same-table.md` |
| seed rows ↔ what the user said | `Boat 1 … Boat 4`; the real names were one question away | `.issues/build-invents-placeholder-rows-instead-of-asking.md` |
| the domain ↔ the word "jobs" | a branding studio's client work modelled as a **job-application tracker** | `.issues/thing-schema-domain-misread-job-tracker.md` |

Gates are detection, not prevention — and detection costs 18–28 min and ~1.7M tokens per build
(`.issues/build-cost-efficiency.md`). The view-spec bet already proved the alternative: colours became
`tone`, markup became section kinds, and a whole failure class stopped *existing* rather than being
caught. Everything below extends that bet.

### The definition of "working" this document is written against

> An app **works** iff: it **opens**; **every nav destination renders non-empty** against real data;
> **every action a user can see completes** and its effect is visible on the next render; **every
> number shown is either sourced or derived by a checked formula**; and **nothing on screen is
> fabricated**.

### Four laws

**L-I — Derive, don't author.** Anything computable from something else is generated.
**L-II — Make it unrepresentable.** Prefer a format the defect cannot be written in over a gate that finds it.
**L-III — Ship green or ship less.** The unit of shipping is a slice that passed its gates.
**L-IV — Never invent.** A value the user did not supply and the material does not contain is asked for or absent.

---

## 2. Format v2

```
<project>/
├── app.json                      # manifest: format:2, title, theme, features
├── model/<entity>.entity.json    # the DOMAIN: facts, not columns
├── api/
│   ├── <name>.query.json         # declarative endpoint — handler is GENERATED
│   └── <name>.handler.ts         # escape hatch: custom TS, same contract, same gates
├── views/
│   ├── <route>.view.json         # a page
│   └── <seg>/_layout.view.json   # a NESTED LAYOUT (any depth) — renders an `outlet`
├── components/<Name>.view.json   # ← TOP LEVEL
├── shell.view.json               # ← TOP LEVEL
├── hooks/  events/  functions/  spaces/
└── .lmthing/                     # GENERATED — never authored, never hand-edited
    ├── app.ir.json  database/*.json  api/**/<METHOD>.ts
    ├── contract.d.ts  endpoints.json  routes.json
    └── app.db  build.journal.jsonl  versions/<hash>/
```

Changes from today and why each is load-bearing:

| change | why |
|---|---|
| **`pages/` → `views/`, JSON only** | the format loses the *place* a `.tsx` could live. React #31 and the hybrid `specCount:2 + handAuthoredPages:[4]` app become unrepresentable |
| **`components/` and `shell.view.json` top level** | a component is an app-level vocabulary item, not a page fragment; the shell is not a route. Both stop being exceptions inside the route walk |
| **nested `_layout.view.json`** | §5 |
| **`model/` replaces authored `database/`** | `database/*.json` becomes generated. You author *facts*; the schema is a projection. This is what makes a rebuild a migration instead of a second opinion |
| **no `seed/` directory** | rows are data, not format. Known rows go in through `writeProjectTable(name, schema, rows)` at creation or `db.insert` after it — the same path a running app uses. What survives is the **rule**, enforced by the planner and gate L2: a row the user did not give and the material does not contain is never written |
| **no legacy TSX path, anywhere** | one medium. `pages:write`, `writeProjectPage`, `writeProjectComponent` and `buildApp()` are deleted, not deprecated; the catalog apps are converted (§11) |

### 2.1 `model/<entity>.entity.json` — facts, not columns

```json
{
  "entity": "job",
  "title": "Job",
  "identity": "id",
  "fields": {
    "id":      { "fact": "job.id",     "type": "id" },
    "client":  { "fact": "job.client", "type": "ref", "to": "client", "required": true },
    "status":  { "fact": "job.status", "type": "enum",
                 "values": ["quoted","approved","in-progress","waiting-on-parts"],
                 "source": "asked:2026-08-02#what-states" },
    "hours":   { "fact": "job.hours",  "type": "decimal", "unit": "hour" },
    "priceMinor": { "fact": "job.price", "type": "money", "currencyField": "currency" }
  },
  "relations": { "parts": { "hasMany": "part", "via": "jobId", "description": "parts fitted" } }
}
```

- **`fact`** — a stable semantic key. A rebuild binds a new column to an existing fact or declares a
  new one; it cannot mint `job_name` beside `job_title` without the migration planner naming the
  collision. Direct fix for 18-columns-for-7-facts.
- **`values`** — **one vocabulary per fact, forever.** A second build extends it or fails.
- **`source`** — a span in the material, or an answered question id, or `derived`. No source ⇒ gate L2
  fails. This is where `saved · applied · interviewing · offered` dies in a branding studio's tracker.
- `type: "money"` is integer minor units + a currency field. Float money is not representable.

---

## 3. The assistant is always there — the builder never authors it

**Requirement: the project's THING chat must be openable on every page, with no appbuilder involvement.**

The dock stops being a shell field the model may or may not write and becomes **renderer chrome**:

- `ViewShell` resolves the assistant itself. Absent ⇒ `{ agent: 'thing' }`, the project's own agent.
- `shell.assistant` remains, but only as an **override**: name a different agent, add a greeting, or
  set `false` to suppress it (the one honest reason: a kiosk view).
- The shell renders for every app, including one with no `shell.view.json` at all — a project with no
  shell used to render bare, so a build that died before writing the shell shipped an app with no
  navigation *and* no assistant. Now the floor is: navigation derived from the route list, plus the
  dock.
- Every appbuilder prompt that told the model to author `assistant:` is deleted. The model cannot
  forget a thing it is never asked to do.

---

## 4. The full component catalogue

The vocabulary grows from 24 elements / 8 sections / 5 field kinds to **32 / 12 / 10**. Every addition
is implemented on `Prim.*` (Tamagui) with a native case, so "renders on mobile" stays true by
construction (§6).

### 4.1 Sections — 12

| kind | for |
|---|---|
| `list` | a collection (`cards` `rows` `table` `grid`) |
| `detail` | one record |
| `create` | a form — fields derived from the mutation's Input, never declared |
| `stats` | a figures strip |
| `markdown` | prose, literal or bound |
| `chat` | an inline assistant (distinct from the always-on dock) |
| `toolbar` | reveal/act buttons |
| `timeline` | a date-grouped stream |
| **`board`** | rows bucketed into columns by a field — the kanban/pipeline surface every tracker wants |
| **`calendar`** | rows placed on a month grid |
| **`chart`** | one or more plots over an endpoint's rows |
| **`outlet`** | *layouts only* — where the child route renders (§5) |

`board`, `calendar` and `chart` reuse the existing collection machinery (`query` `from` `input`
`param` `limit` `item` `rowAction` `rowActions` `poll` `empty`), so sourcing rules, polling and empty
states are the same facts in the same words.

### 4.2 Elements — 32

Existing 24: `row col grid spacer divider surface` · `heading text caption markdown` ·
`badge statcard meter keyvalue table timeline rating` · `image icon` · `banner empty` ·
`button link field`.

New 8:

| element | props | why |
|---|---|---|
| `tabs` | `items:[{label,icon?,children}]`, `initial?` | in-page switching without client state the language doesn't have |
| `accordion` | `items:[{label,caption?,children}]`, `multiple?` | long forms/FAQs/detail stacks on a phone |
| `avatar` | `src?`, `name?` (initials fallback), `size?` | people appear in every tracker; the audit cut it at 0 demand and five apps then hand-rolled one |
| `code` | `text`, `language?` | agent output, ids, snippets — currently forced through `markdown` |
| `quote` | `text`, `cite?` | testimonials, extracted passages, model rationales |
| `chart` | `kind:'bar'\|'line'\|'area'\|'donut'`, `data`, `x`, `y`, `series?`, `height?` | the one thing a dashboard cannot fake; drawn in SVG primitives so it works natively |
| `calendar` | `items`, `date`, `title`, `month?`, `action?` | dates as a grid, not a list |
| `steps` | `items:[{label,caption?}]`, `current` | progress through a known pipeline |

### 4.3 Field kinds — 10

`toggle rating select stepper text` plus **`date` `number` `textarea` `multiselect` `slider`**.
`field` is the inline-editable control; these five are what a row needs to be editable in place
without a modal.

### 4.4 Unchanged, on purpose

Bindings are still paths from the same eight roots; there are still no expressions; colour is still
`tone`/`toneMap`; icons are still the closed 32-name set; a `create` section still declares no fields.
Growing the *vocabulary* is not the same as loosening the *language*, and the language is what keeps a
weak model from writing something broken.

---

## 5. Routes nest, like JSX

Today a route is a flat string and every page re-declares the entity header, the sub-nav and the
breadcrumbs it shares with its siblings. Nested layouts fix that with one new section kind.

```
views/
  index.view.json                     → /
  trips.view.json                     → /trips
  trips/[tripId]/_layout.view.json    ← frame for every /trips/:tripId/*
  trips/[tripId]/index.view.json      → /trips/:tripId
  trips/[tripId]/expenses.view.json   → /trips/:tripId/expenses
```

A layout is an ordinary view spec containing exactly one `{ kind: 'outlet' }` section, written with
`writeProjectViewLayout(prefix, spec)`. The renderer composes the chain outermost → innermost and
renders the page in the innermost outlet.

Three consequences:

- **Shared data is fetched once.** A layout's `detail` section publishes under its id, and every child
  page reads it as `$data.tripHeader.name` — the layout and its children live in one runtime scope.
- **Sub-nav stops being hand-declared.** A `toolbar` in the layout is the sub-nav, and it inherits the
  route params, so it is written once per family instead of once per page.
- **Orphan routes get harder to produce.** A route under a layout prefix is reachable through it.

`ViewSpec.route` is still the flat authoring string (`trips/[tripId]/expenses`) — nesting is in the
file tree and the layout chain, not in a nested route object. One representation of a route, still.

---

## 6. Tamagui, made permanent

`libs/ui/src/view/elements.tsx` imports only `React`, `* as Prim` and the markdown element; `Prim.*`
are real Tamagui primitives with `.native.tsx` forks (`libs/ui/src/elements/primitives/box/index.tsx`);
icons are SVG primitives, not lucide; the `chat` section deliberately uses `ReplChatView` rather than
the web-only `<Chat>`; tokens are generated into a Tamagui config with a parity test. What is missing
is enforcement that survives the next commit:

| gate | asserts |
|---|---|
| **G1 rooted import allow-list** | the graph rooted at `libs/ui/src/view/index.ts` imports only `react`, the primitives, the theme and its own siblings — no `react-dom`, no lucide, no DOM global, no raw host tag |
| **G2 exhaustive native coverage** | every `ELEMENT_KINDS`, `SECTION_KINDS`, `FIELD_KINDS`, `LIST_LAYOUTS` and `ICON_NAMES` entry is mounted by a case in the native suite. A new element with no native case is **red** |
| **G3 tone parity** | every `TONES` value resolves to a real theme token on both targets |
| **G4 golden cross-target render** | a fixture corpus renders on web (jsdom) and native (react-test-renderer) with matching semantic trees |

---

## 7. The API: declarative first, with a real escape hatch

Most endpoints are projections, not programs. Make those data and the handler cannot disagree with its
own contract. The rest keep TypeScript — but on the IR's terms.

**Tier 1 — pure declarative** (`api/<name>.query.json`). Kinds: `list` `get` `aggregate` `create`
`update` `toggle`.

```json
{
  "name": "jobs-list", "kind": "list", "entity": "job",
  "where":  [{ "field": "status", "op": "in", "input": "status", "default": ["quoted","approved"] }],
  "order":  [{ "field": "createdAt", "dir": "desc" }],
  "limit":  { "input": "limit", "default": 50, "max": 200 },
  "include":[{ "relation": "client", "fields": ["name"], "as": "clientName" }],
  "compute":{
    "partsTotalMinor":  { "sum": "$parts.priceMinor" },
    "labourTotalMinor": { "mul": ["$hours", { "ref": "settings.labourRateMinor" }] },
    "totalMinor":       { "add": ["$labourTotalMinor", "$partsTotalMinor"] }
  },
  "shape": "items"
}
```

`compute` is a **closed formula AST** — `add sub mul div min max round coalesce count sum avg first
diffDays` over field refs, relation paths and constants. Typed, host-evaluated, pushed into SQL where
possible.

**Tier 2 — a declarative pipeline with a code stage.** When the shape is right but one step is real
logic, keep the declaration and drop into TS for that step only:

```json
{
  "name": "route-plan", "kind": "list", "entity": "stop",
  "stages": [
    { "fetch": { "where": [{ "field": "day", "op": "=", "input": "day" }] } },
    { "code": "optimise-order" },
    { "compute": { "legMinutes": { "diffMinutes": ["$arriveAt", "$departAt"] } } }
  ],
  "shape": "items"
}
```

`{ "code": "optimise-order" }` names `functions/optimise-order.ts`, a **pure** `(rows, ctx) => rows`
whose input and output types are generated from the IR. It cannot invent a field: anything it returns
that the Output does not declare is dropped, and anything the Output declares that it never sets is a
gate finding. So a custom step gets arbitrary logic *without* getting the ability to break the
contract.

**Tier 3 — a full custom handler** (`api/<name>.handler.ts`) for the genuinely bespoke case. It
declares its Output as an IR projection and faces every gate today's handlers face. The **escape rate
is a ratchet metric** (§12): a climbing rate means the IR is missing a kind, which is a design bug, not
a licence.

What stops being possible: handler ↔ Input disagreement, endpoint querying a missing table, a view
binding a field the endpoint never returns, a toggle that never flips (`kind:"toggle"` generates the
server-side flip), a forgotten `invalidates` (derived from write-set ∩ read-set), an FK rendering as a
raw UUID box (`x-options` derived from `type:"ref"`), and a dropped arithmetic term.

---

## 8. The planning phase

The evidence says planning is where apps are won or lost: the studio misread, the invented boats and
the six-specs-three-screens route sprawl are all planning failures that no downstream gate can undo.
Planning becomes five explicit stages, each with a machine-checkable output.

| stage | produces | checked by |
|---|---|---|
| **P1 Intake** | source extract + a **gap list** (facts unknowable from the material that block the domain) | every later claim must cite a span or an answer id |
| **P2 Clarify** | answers — bounded questions when interactive; a structured gap list returned to THING when autonomous (a delegate has no `ask()`) | unanswered gaps become "unseeded", never invented |
| **P3 Domain** | the fact model: entities, facts, one vocabulary per enum, relations, identity | **grounding gate**: every entity name and enum value traces to a span or an answer |
| **P4 Migration** | for an existing app, a diff (`add-fact` `extend-enum` `rename` `no-op`) instead of a design | fact-key collision detection; enum single-vocabulary |
| **P5 Slice plan** | ordered vertical slices; slice 0 is the **spine** (shell + index + one entity list + create) | dependency order; every story assigned; every slice independently shippable |

Then per slice: `model Δ → queries → views → gates → promote`, with the app openable after slice 0 and
after every promotion.

> **The spine guarantee: from the moment slice 0 promotes, the app is openable and green, and every
> later promotion leaves it openable and green.**

That is the "always working" property, and it survives budget exhaustion, a pod recycle and a model
failure — the worst outcome becomes *fewer features*, never *a broken app*.

### 8.1 Tasklist engine features this needs  ✅ **DONE** (W8)

The planning/slicing flow above is not expressible in today's tasklist engine. Two node kinds — plus
`forEach` extended to work over one of them — cover all three needs, each independently useful:

| feature | what it is | why the flow needs it |
|---|---|---|
| **`kind:'subgraph'`** | a node (`subgraph: <name>` frontmatter) that runs a named sub-tasklist recursively via the same `runTasklist`, seeded exactly like a code node, and unwraps its `TaskEnvelope.data` as its own output; degradation folds up re-labelled `<id>/<inner>`, and a call-stack guard fails a cycle loudly | a slice is a small DAG (`model → queries → views → gates`); today it would be inlined N times |
| **`forEach` over a subgraph** | the existing host-driven fan-out applied to a subgraph node — fan a whole sub-DAG out over a runtime-produced array (`item`/`index` seeded into each sub-run). This *is* the "dynamic" fan-out: the array is whatever an upstream node produced this run | slices are discovered in P5, not known when the tasklist is authored |
| **`kind:'checkpoint'`** | a barrier node (`checkpoint: true`) that runs no fork and hands the host a `CheckpointSnapshot` (`{tasklist, id, done[], outputs}`) via an injected `onCheckpoint`; `runTasklist({resume})` replays it, marking those tasks done so a crashed run skips past them. Core keeps NO filesystem — persistence is the host's, exactly like `codeNodeCtxFactory` | rollback and resume-after-crash need a durable "last green" marker |

Absent these, a slice pipeline degenerates into a single huge node — exactly the context blow-up §9
exists to prevent. Shape and semantics are pinned by `libs/core/src/tasklist/subgraph.test.ts` (subgraph
unwrap, dynamic fan-out, degrade fold-up, checkpoint snapshot + resume, cycle/target/mutual-exclusion
validation). The one deliberately-deferred piece is the host's on-disk checkpoint *journal* (a thin
`onCheckpoint` → JSONL adapter), wired where it is consumed in W9.

---

## 9. Context discipline

Every generation node is given **the minimum slice of truth it needs and nothing else**, because a
node that reads the whole app is both expensive and worse at its job (`.issues/build-cost-efficiency.md`:
~1.7M tokens per build; the 63-node fix-pass that produced the React-#31 page was a context-degradation
failure).

| rule | mechanism |
|---|---|
| a node sees only its **slice's** contract, never the whole app | slice inputs are projected from the IR, not passed wholesale |
| a repair fork sees **one artifact + its findings**, not the build | findings carry `owner` + artifact path; the fork's prompt is assembled from those two |
| gates return **findings, not transcripts** | already true for code nodes; extended to every gate |
| generated artifacts are **never re-read by a model** | `generate --check` is a byte comparison, not a review |
| the plan is a **graph, not prose** | P3–P5 emit structured objects; downstream nodes read fields, not paragraphs |
| knowledge is **loaded on demand**, one aspect per decision | already the space's pattern; the expanded vocabulary is split so a node loads only the kinds it is writing |

Budget per node is asserted, not hoped: a node whose assembled context exceeds its budget fails the
build with a "context too large" finding naming the node — a design bug surfaced immediately instead
of a degraded model turn three hours in.

---

## 10. The gate ladder

| # | invariant | mechanism | kills |
|---|---|---|---|
| **L0** | format — schemas; `views/` and `components/` accept `*.view.json` only; no `.tsx` in the UI tree | write-time + tree lint | hybrid apps; React #31 |
| **L1** | IR totality — every reference resolves | `compile()` | endpoint→table 500s; `useApi` to nowhere; orphan routes |
| **L2** | grounding — every entity, enum value and written row traces to source or an answer | `check()` | `Boat 1…4`; the job-application enum |
| **L3** | derivation — `generate --check` byte-identical | generator | hand-edited generated files |
| **L4** | typecheck — custom handlers, code stages and hooks only | `tsc` | the 17-error contract mismatch |
| **L5** | execution — every endpoint invoked: valid, wrong-typed, missing param, literal `"undefined"` | smoke, per slice | 500s |
| **L6** | semantics — every stated arithmetic rule has a check with its worked value; a rule with no check **fails** | acceptance | £70.49 where £182.99 was right |
| **L7** | render (web) — every view mounted against live responses: non-empty, coverage ≥ threshold, zero always-null bindings | render smoke | the structurally-perfect blank page |
| **L8** | render (native) — same views under `react-test-renderer`; no loose strings; icons draw; real `ScrollView`s; semantic tree ≡ web | metro harness | silent native divergence |
| **L9** | reachability — every route reachable, every endpoint read, every entity read *and* written, no dead component | `check()` | 6 specs / 0 endpoints |
| **L10** | interaction — every mutation reachable from a view; every `rowAction` target exists; **every toggle proved to flip**; every form field renderable | generated probes | dead toggles; raw-UUID FK boxes |
| **L11** | round-trip — submit each create form's synthesized payload, assert the row appears in the list the app renders | generated probe | the form that "works" and shows nothing |
| **L12** | promotion — staged → validated → atomic move → journal → snapshot | transaction | half-applied builds |

---

## 11. THE IMPLEMENTATION PLAN

Ordered by dependency. Each workstream lands with its tests and is independently shippable.

### W1 — Vocabulary expansion  ✅ **DONE**

| file | change |
|---|---|
| `libs/cli/src/app/view-spec/schema.ts` | `SECTION_KINDS` +`board` +`calendar` +`chart` +`outlet` (cap 8→12); `ELEMENT_KINDS` +`tabs` +`accordion` +`avatar` +`code` +`quote` +`chart` +`calendar` +`steps` (24→32); `FIELD_KINDS` +`date` +`number` +`textarea` +`multiselect` +`slider` (5→10); interfaces, `ELEMENT_DEFS`, `SECTION_DEFS`, unions, coverage assertions |
| `libs/ui/src/view/types.ts` | mirror the new types |
| `libs/ui/src/view/elements.tsx` | render the 8 new elements on `Prim.*` |
| `libs/ui/src/view/charts.tsx` *(new)* | SVG chart primitives (bar/line/area/donut) — native-safe |
| `libs/ui/src/view/sections/board.tsx`, `calendar.tsx`, `chart.tsx` *(new)* | the 3 new sections |
| `libs/ui/src/view/sections/index.tsx` | dispatch |
| `libs/ui/src/view/controls.tsx` | the 5 new field kinds |
| `libs/cli/src/app/view-spec/validate.ts` | binding sites for the new props |
| tests | `schema.test.ts` counts; `render.test.tsx` cases; `metro/suites/view.tsx` native cases |

**Acceptance:** every new kind has a schema branch, a renderer case, a web test and a native test;
`pnpm test libs/cli/src/app/view-spec libs/ui/src/view` green; `pnpm test:native` green.

### W2 — Always-on assistant  ✅ **DONE**

`libs/ui/src/view/shell.tsx` resolves the dock (default `{agent:'thing'}`, `false` suppresses);
`schema.ts#ShellSpec.assistant` accepts `false`; `ViewRenderer` renders the shell even when the app has
no `shell.view.json`; every appbuilder prompt that mentions authoring `assistant:` is deleted.
**Acceptance:** a spec app with no shell renders nav + dock; a test asserts the dock is present on a
page whose shell omits `assistant`.

### W3 — Nested layouts  ✅ **DONE**

`outlet` section; `writeProjectViewLayout(prefix, spec)`; `files.ts` discovers
`views/**/_layout.view.json`; `wrapper.ts` and `routes/app-views.ts` carry layouts; `ViewRenderer`
composes the chain; `validate.ts` enforces exactly-one-outlet in a layout and none in a page.
**Acceptance:** a two-level layout chain renders parent frame + child page, and a child reads
`$data.<layoutSectionId>.…`.

### W4 — Format v2 layout  ✅ **DONE** (v1 still read)

`components/` and `shell.view.json` at top level; `views/` as the page dir; `app.json` with
`format: 2`; writers, `files.ts`, `app-views.ts` and the loaders read v2 **and** v1 so existing
projects keep serving.
**Acceptance:** a v1 project still serves; a new project is written as v2; `pnpm test libs/cli/src/app` green.

### W5 — Legacy TSX removal  ✅ **DONE**

Deleted the `pages:write` capability (union, `CAPABILITY_IDS`, `BARE_ONLY`, `AppCapabilities` field), the
model-facing writers `writeProjectPage`/`writeProjectComponent` and the `buildApp()` yield global
(`globals/build-app.ts`, the `'buildApp'` yield kind, `buildAppResolver`, every threading site), their
DTS fragments (`PROJECT_PAGE_DTS`/`PROJECT_COMPONENT_DTS`/`BUILD_APP_DTS`) and injection sites, plus the
cli lint helpers (`lintPageSource`/`lintComponentSource` + their dead siblings) and the `'page'`/
`'component'` kinds of `saveTypecheckError`. Every appbuilder/architect/thing/engineer knowledge + prompt
that named a TSX writer or `pages:write` was reworded to the surviving contract (`views:write` is the sole
UI-authoring grant; a page is validated spec data — no freehand-TSX writer exists to grant). `writeProjectApi`,
the four `writeProjectView*` writers, and the host-side check (`runProjectAppCheck`/`buildProjectApp`, still
reached via a CODE node's `ctx.buildProjectApp()`) are untouched.

The catalog TSX example apps were **deleted, not migrated** (per the request) — they are not part of the
`sdk/org` build and W6 removes the per-project page build that served them.

**Acceptance met:** `pages:write` and the legacy writers exist nowhere in the code; `pnpm typecheck` (9/9)
and the full suite (**3360 passed**) are green; the surviving `views:write` path keeps its coverage
(capability, DTS-fragment, and cross-target render tests). The `org/docs` source-of-truth pass follows in
the same change.

### W6 — One renderer, zero project build

`AppHost` (renderer + router + client + theme + boundary) prebuilt into `libs/cli/dist/app-shell/`;
spec apps stop calling `buildProjectPages`; wrapper generation deleted; the pod serves shell + payload.
**Acceptance:** a spec app has zero build steps; first paint is server-injected; `BUILDER_VERSION`
no longer gates app UI.

### W7 — App IR + declarative API

`compile()` / `generate()` / `check()`; `model/*.entity.json`; `api/*.query.json` tiers 1–3; generated
handlers; derived `invalidates`, `x-options`, `param`; `generate --check`.
**Acceptance:** ≥85% of endpoints on the scenario corpus are declarative; a hand-edited generated file
is a hard error.

### W8 — Tasklist engine features  ✅ **DONE**

`kind:'subgraph'`, `forEach` over a subgraph, `kind:'checkpoint'` (§8.1). Loader parsing +
mutual-exclusion validation in `libs/core/src/spaces/tasklist-load.ts`; recursion guard, target
validation, resume pre-population and the two dispatch branches in `libs/core/src/tasklist/orchestrator.ts`
(new exports `CheckpointSnapshot`/`CheckpointHook`); tests in `libs/core/src/tasklist/subgraph.test.ts`.
**Acceptance met:** a subgraph fans out from a runtime-produced list (`mkRuns === 3`) and a checkpoint
snapshot round-trips through `resume` so the pre-checkpoint step does not re-run. Host JSONL journal
deferred to W9 (its only consumer).

### W9 — The planning + slice pipeline

Rewrite `build_live_project` as P1–P5 + per-slice subgraph + transactional promotion + owner-routed
repair; context budgets per node.
**Acceptance:** slice 0 promotes in ≤3 min; killing the run mid-build leaves an openable green app.

### W10 — Gate ladder completion

L2 grounding, L10 interaction probes, L11 round-trip, L12 promotion; G1–G4 from §6.
**Acceptance:** each gate has a red fixture and a green fixture.

---

## 11a. What is built, and what it was proven against

W1–W4 are implemented and on `main`. The evidence, in the order it was produced:

| gate | result |
|---|---|
| `pnpm typecheck` (9 packages) | clean |
| `pnpm test` (root) | **3407 passed**, 3 skipped |
| `libs/ui` vitest (jsdom) | **182 passed** — 164 existing + 18 new v2 cases |
| `pnpm test:native` (Metro + `react-test-renderer`) | **PASS**, including 6 new v2 cases and a coverage gate that fails if any element/section kind has no native case |
| live app in Chrome | see below |

**The live run.** A four-table-free, six-endpoint app (`boatyard`) was authored through the REAL
writers — `writeProjectTable`, `writeProjectApi`, `writeProjectViewComponent`, `writeProjectView`,
`writeProjectViewLayout`, `writeProjectViewShell` — served by the actual pod (`bin.js --port`), and
opened at `/app/boatyard/`:

- `/` renders the stats strip, a **bar chart** and a **donut chart** drawn from `boat-load`, and the
  **board** with all four declared columns; cards are a `{ use: 'JobCard' }` component whose
  `avatar` falls back to initials (`SR`, `RD`). Computed totals are right: 3h × £45 + £75 = **£210**.
- `/schedule` renders the **calendar** as an August 2026 month grid with each job on its own day,
  above a `timeline` of the same rows.
- `/jobs/<id>` renders the **nested layout chain**: the layout's header (`Kittiwake / Hull antifoul /
  in-progress`) and toolbar, then the child page inside the outlet. Pressing **Advance stage** on the
  CHILD updated the status shown in the LAYOUT's header — one runtime scope, invalidation crossing
  the chain.
- The **assistant dock is on every one of those pages**, and `shell.view.json` contains no
  `assistant` key at all.
- Console: **zero errors or warnings**.

The one thing the live run exposed that is worth recording: with `LMTHING_ROOT` outside the
workspace the per-project page build fails to resolve `tailwindcss/theme`. That is the per-project
esbuild machinery W6 deletes — the spec transport (`/api/apps/:id/views`) served the whole app
correctly in the same run, which is exactly the argument for W6.

## 12. Ratchets

| metric | target |
|---|---|
| endpoints declarative (not hand-written) | ≥ 85% |
| always-null bindings at ship | **0** |
| invented rows | **0** |
| enum vocabularies per fact | **1** |
| slice-0 wall clock | ≤ 3 min |
| tokens per shipped slice | ↓ from ~1.7M per build |
| gate attempts to green, per slice | ≤ 2 median |
| native cases missing for a vocabulary kind | **0** (CI red) |

## 13. Honest limits

- The query IR will not express everything; tiers 2 and 3 are permanent, and the escape rate is the
  signal to watch.
- Grounding can reject a legitimate synonym — hard for enum values and rows, advisory for prose.
- A prebuilt shell makes renderer bugs global; the golden corpus and staged rollout are the mitigation,
  and the upside is that a fix reaches every app at once.
- None of this makes the model's *modelling* correct. It makes every mechanical consequence of a
  modelling decision correct, and forces the decision to be grounded in something the user said.
