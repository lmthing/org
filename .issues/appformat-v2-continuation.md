# Continue the app-format v2 effort — W9 slice execution · W10 render probe + L2/L10/L11/L12

**Status of the plan (`APPFORMAT_IMPROVE.md`).** W1–W8 are implemented and on `main`. W7 (the
declarative query IR) is now **done** and structurally proven. W9 and W10 are **partial** — real, tested
foundations landed, but each has one clearly-identified remaining lift, described below. This issue is
the single pick-up point; read `APPFORMAT_IMPROVE.md` §7/§8/§10/§11a for the grounded detail.

---

## What is DONE (do not redo)

- **W1–W6, W8** — as before (vocabulary, always-on assistant, nested layouts, v2 layout, legacy-TSX
  removal, one-renderer/zero-project-build, the tasklist engine's `subgraph`/`checkpoint`/`forEach`
  primitives).
- **W7 — App IR + declarative API.** `libs/cli/src/app/ir/{entity,query,check,formula,invalidates}.ts`.
  `writeProjectEntity`/`writeProjectQuery` author `model/*.entity.json`/`api/*.query.json`; a GENERATED
  handler cannot disagree with its own contract (150+ tests, including full end-to-end execution of
  generated handlers against a real db through the real worker runtime). `05-plan_endpoints.md`/
  `12-implement_endpoints.md` branch on `declarative: true` — a plain list/get/aggregate/create/update/
  toggle goes through `writeProjectQuery`; a genuinely bespoke endpoint keeps the hand-written path.
  **Live-verified end-to-end (three runs)** — see "What the live runs found" below for the two real bugs
  this surfaced (both fixed, both regression-tested) and what's still open.
- **W9 (partial)** — `09b-plan_slices.ts`: a tested, deterministic slice-grouping algorithm (topological
  table-FK order → endpoint/page depth bucketing → self-contained per-slice payloads). Three
  `checkpoint: true` barriers wired into the EXISTING linear `build_live_project` DAG for real
  crash-resume value.
- **W10 (partial)** — G1 (rooted import allow-list) and G3 (tone parity) gates, both real and green
  against the live tree. A concrete bug fixed: `renderSpecAppSmoke` mounted every `[id]`-style route with
  `params: {}` (now extracts real param names + a placeholder value).

Commits (all on `main`, `sdk/org` submodule): W7 IR `1220e734`; W7 wiring+prose `f7e6de3f`; W9 partial
`cecb8f7a`; W10 partial `0215ce76`; plan_endpoints template + toggle companion fix `5a87af9b`;
**critical `writeProjectQuery` fix `470ac8dc`**.

---

## What the live runs found (30-bike-workshop, three consecutive runs) — READ before touching W7 again

**Run 1** (pre-fix): the model's own planning-turn reasoning correctly worked out which endpoints
should be declarative (it even said so in comments), but the ACTUAL `currentTask.resolve({endpoints})`
object never carried `declarative`/`kind`/etc. Zero `.query.json` files landed. Root cause:
`05-plan_endpoints.md`'s FINAL code block — the one a model anchors its output shape on — showed only
the pre-W7 shape. **Fixed** (`5a87af9b`): rewrote that template to show a declarative AND a bespoke
endpoint side by side, with an explicit "the fields ride on THIS SAME object" line above it. Also found:
the model recognized a real toggle-with-timestamp pattern (`collected`, stamp `collected_date` on
collect) as a case my Tier-1 toggle IR was too narrow to express, and correctly fell back to
hand-writing it (which then failed for unrelated reasons — see below). **Fixed** (`5a87af9b`): extended
`kind:'toggle'` with an optional `set` of `{ whenTrue, whenFalse }` companion sources (`'now'` = current
timestamp) — exactly this pattern, now declarative, with an end-to-end test proving the date is stamped
on collect and cleared on un-collect.

**Run 2** (template fix applied, toggle fix not yet applied to prompting): `declarative: true` now
appeared correctly on resolved endpoints. But the model's OWN session log shows it called
`writeProjectQuery` repeatedly and got rejected **every single time** with "an inline or invented
Output", concluded the declarative path "is not working", and abandoned it — hand-writing every
endpoint instead, which then cascaded into dozens of invented-import/type-error repair rounds (worse
than run 1, 13.7 min vs 8.5 min, two artifacts never repaired by the fix loop). **Root cause — a real
bug in W7's own wiring, not a prompting issue:** `writeProjectQuery` reused `apiHandlerTypingError`
(`lint.ts`, the SAME check `writeProjectApi` uses), whose rule requires a hand-written handler's return
type to reference `emit_types`'s GLOBAL ambient `<Pascal>Output` — but a GENERATED handler deliberately
declares its own LOCAL `Output` interface (the whole self-containment point). `emit_types` ALWAYS runs
before `implement_endpoints` in the real pipeline, so this check rejected **100% of real
`writeProjectQuery` calls**, every time, silently (my own tests never had a `types/contract.d.ts`
present, so this never surfaced before a live run). **Fixed** (`470ac8dc`): `writeProjectQuery` no
longer runs `apiHandlerTypingError` (kept `lintApiHandler` + `saveTypecheckError`, still real
defense-in-depth). A regression test with a real `types/contract.d.ts` fixture reproduces the exact
live error message and is confirmed to fail on the old code, pass on the fix.

**Run 3** (both fixes applied): `api/customers-list.query.json` landed and its GENERATED handler served
real data — confirmed in a real browser: `/app/bike-workshop/customers` shows three real seeded
customers, zero console errors, zero failed network requests. `/app/bike-workshop/` (the dashboard)
also renders correctly (real computed `Bikes in shop: 3`, `£378.19`) via a hand-written endpoint that
happened to succeed this run.

**Still open, found by run 3 — NOT a regression, pre-existing:** the collect-toggle checkbox on the
dashboard does not fire a network request when clicked (its endpoint never landed — the SAME class of
invented-import errors: `../../types/contract`, `@app/types`, `any`-typed input, missing `export const
name`, across ALL THREE runs, on the harder cross-table-lookup endpoints (`job-detail`, `dashboard`)
that Tier-1's IR does not cover and must hand-write). This exact flakiness is the ORIGINAL evidence
that motivated building W7 in the first place (quoted in APPFORMAT_IMPROVE.md §11a from the pre-W7
runs) — it has not gotten worse, W7 just doesn't reach it, because these specific endpoints need a
cross-table join / multi-table aggregate that the closed Tier-1 formula set cannot express.

**The single highest-leverage next step this evidence points at:** widen coverage past Tier 1.
Run 3's actual declarative ratio was 1-of-7 endpoints — everything else was exactly the
cross-table-lookup/grouped-aggregate class §7 already scoped as **Tier 2** ("a declarative pipeline
with a code stage" — `stages: [{ fetch }, { code: '<fn>' }, { compute }]`, where the `code` stage is a
PURE `(rows, ctx) => rows` function whose types are generated from the IR, so it cannot invent a field
even though it can do a real join). Tier 2 is specified in APPFORMAT_IMPROVE.md §7 but was NOT built
this session (only Tier 1: list/get/aggregate/create/update/toggle). Building it is the concrete way to
shrink how much of a real app still needs the fragile hand-written escape hatch.

---

## The two engine/architecture gaps found while implementing — read before continuing either

### 1. W9: `forEach`-over-`subgraph` is CONCURRENT, not sequential

The spine guarantee ("the app is openable and green after slice 0, and after every promotion") requires
processing slices ONE AT A TIME — slice 0 fully built + gated before slice 1 starts. The engine's only
fan-out primitive (`forEach` + `subgraph`, W8) runs every element via `Promise.all` — genuinely
concurrent — and a subgraph naming a tasklist already on its own call stack is a hard cycle error
(`orchestrator.ts` — `stack.includes(name)` throws), which rules out the obvious workaround (a subgraph
recursively calling itself with "the rest of the list"). So there is currently **no way to express
"process N dynamically-discovered items strictly in order, each gated before the next begins"** with
today's primitives.

Two ways to unblock this, pick one:
- **(a) New engine primitive.** A "sequential fold" node kind — like `forEach`, but processing one
  element to completion before starting the next, propagating a running accumulator. This is a REAL
  `libs/core` runtime change (`orchestrator.ts`, `tasklist-load.ts`), needs its own test coverage
  (`subgraph.test.ts`-style), and should probably be proposed/reviewed before landing, since it changes
  core tasklist semantics other spaces might come to depend on.
- **(b) Concurrency-safe slicing.** Redesign `plan_slices` so slices never depend on EACH OTHER'S writes
  landing first — i.e. a slice that needs an earlier slice's table carries a COPY of that table's spec in
  its own `tables` array (not deduplicated), relying on `writeProjectTable`/`writeProjectEntity` already
  being idempotent merges (confirmed: `writeProjectEntity` recompiles+overwrites deterministically;
  `writeProjectTable` unions columns). Then `forEach`-over-`implement_slice` is safe to run concurrently
  TODAY, no engine change needed — you lose the literal "slice 0 done before slice 1 starts" ordering,
  but gain real parallelism and each slice is still independently correct. This is the faster path; (a)
  is the more faithful one to §8's actual wording.

Either way, `09b-plan_slices.ts` needs a small change (route (b)'s "carry a copy, don't dedupe" tables
logic is currently the OPPOSITE — it dedupes via a cumulative "seen" set, exactly right for (a) but wrong
for (b)) — check which direction you're taking before touching it.

### 2. W10: the full by-path, effect-firing render probe needs jsdom in `libs/cli`

The two live host bugs (route precedence, `from`-envelope) both need TWO things a probe must do that
`renderSmokeViews`/`renderSpecAppSmoke` structurally cannot: match a REAL URL PATH through
`libs/ui/src/view/router.ts#matchRoutes` (not iterate views by name), and fire REAL `useEffect`-driven
data fetching (not `renderToStaticMarkup`, which never runs an effect). Doing this for real means
mounting the ACTUAL `ViewRenderer` with `@testing-library/react` + `jsdom` — both are `libs/ui`-only
devDependencies today; `libs/cli` (where the gate would run, since it owns `openProjectDb`/
`createApiRuntime`) has neither. Adding them needs care: `validate.ts`'s existing `renderToStaticMarkup`
path already works around a real react18(cli)/react19(ui) version split by resolving react/react-dom
FROM the renderer's own location rather than a bare import — the same care applies here, doubly, since
RTL's `render()` must share the EXACT react/react-dom instance the mounted components were created with,
or you get invalid-hook-call errors that look like a bug in the probe rather than the dependency setup.

Suggested shape once you take this on: a new `libs/cli/src/app/view-spec/render-path-smoke.ts` (or a
`.test.ts`-only harness, cheaper to start with) that spins up a scratch project exactly like the W7 IR
tests do (`openProjectDb` + `createApiRuntime`), builds a `RoutePattern[]` table from `loadProjectViews`,
resolves each real serving path via `matchRoutes`, mounts `ViewRenderer` with a `createViewClient` whose
`call` is wired to `runtime.handle(method, path, input)` DIRECTLY (in-process, no real HTTP), and asserts
via `waitFor` that real content renders for real seeded rows — the same proof shape my W7 end-to-end
tests already use for the API side, extended through the renderer.

---

## What is LEFT — ordered

### 1. W7 Tier 2 — a declarative pipeline with a code stage (**highest priority, per live evidence**)

Run 3's actual declarative ratio was 1-of-7 endpoints. Every hand-written endpoint in that run was a
cross-table lookup or a multi-table aggregate — exactly what §7 scopes as Tier 2: `stages: [{ fetch:
{where} }, { code: '<fn-name>' }, { compute: {...} }]`, where `{ code: '<name>' }` names a
`functions/<name>.ts` PURE `(rows, ctx) => rows` whose input/output types are GENERATED from the IR, so
it can do a real join/lookup but cannot invent a field the Output doesn't declare. This is net-new work
in `libs/cli/src/app/ir/query.ts` (a new `stages` field on `QueryIr`, alongside today's flat
`where`/`compute` shape) — building it is the concrete way to shrink how much of a real app still needs
the fragile hand-written escape hatch, which is where ALL of run 3's flakiness lived.

### 2. Take on ONE of the two engine/architecture gaps above, live-verify it against `30-bike-workshop`

Whichever you tackle first, the acceptance is empirical: run the live scenario (below), and for W9
confirm a killed-mid-build resume actually skips completed phases; for W10 confirm the new probe would
have caught (in a deliberately-reintroduced red fixture) the route-precedence and envelope-unwrap
classes specifically.

### 3. L2 grounding (W10)

`EntityField.source` exists in the W7 IR (§2.1) but nothing enforces "no source ⇒ fail" yet. This is a
natural, LOW-RISK extension of `validateEntityIr` (`libs/cli/src/app/ir/entity.ts`) — straightforward to
add without touching anything else.

### 4. L10/L11 (interaction probes, round-trip) and L12 (promotion)

L12 is blocked on whichever W9 direction you take (promotion needs a real "staged → validated → atomic
move" unit, which only makes sense once slices actually execute in some real order). L10/L11 are
independent and can be picked up any time — see §10 in APPFORMAT_IMPROVE.md for their exact shape. An
L10 interaction probe (does every mutation reachable from a view actually fire?) would ALSO have caught
run 3's dead collect-toggle checkbox mechanically, without needing a browser — worth prioritizing
alongside Tier 2.

---

## Two old follow-ups from the original W6 live run (still open, low priority)

- **Assistant-dock WebSocket** fails handshake in a bare test pod (`ws://…/app/<id>/api/ws`) — the one
  console error on an otherwise-clean page. Orthogonal to data rendering; likely behaves differently
  behind the real gateway.
- **`APPFORMAT.md` is stale** — still describes v1 (generated-wrapper trick, 8/24/5 vocabulary). Needs a
  v2 pass; `org/docs/` too (`pnpm docs:check` should be green before closing this issue).

---

## How to verify progress (the loop that found everything above)

```
node scenarios/run-scenario.mjs 30-bike-workshop --through 2 --keep-server --keep-project --verbose
```

Builds through the REAL space agent (from TS source — uncommitted fixes are live), serves via the
prebuilt AppHost, keeps the pod up. Open `/app/bike-workshop/` in a browser and check: real data on every
route, the collect toggle updates the dashboard, zero console errors, AND (new, for W7) look at how many
of the built endpoints are `.query.json` (declarative) vs hand-written `.ts` — that ratio is the
≥85% acceptance number this issue still owes. Run `08-small-shop`/`31-food-coop`/`32-festival` for other
domains. Do not trust a green build envelope alone for the render-probe class of bug — see gap #2 above.

Delete this issue when W9's chosen direction and W10's render probe (+ L2/L10/L11/L12) are done and
live-verified, and the two old follow-ups are closed.
