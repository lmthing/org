---
input:
  query: string
  attachmentIds: array
---

Build a complete, openable live-project app from supplied material — as a CONTRACT → BUILD → PROVE
pipeline, so no single model turn has to author a whole app at once and no file is ever written before
the types it must satisfy exist.

First read the attachments, then distil the request + material into the USER STORIES the app must
satisfy, then make a holistic, BINDING plan of the app (its tables, endpoints, reusable components, and
MULTIPLE pages) that serves every story — the binding plan keeps the PAGE LIST lightweight (route +
purpose), so no node ever holds every page's detail at once.

**The whole CONTRACT is designed before any code is written.** `plan_tables` (columns with real
TypeScript types), `plan_endpoints` (name, route, source tables, and the exact response fields WITH
TYPES), `plan_components` (typed props) and the per-page `plan_pages` (route, the endpoints it reads,
the components it renders) run as one design pass, each seeing the previous stage's contract so every
reference is made against a real name instead of an invented one. `validate_contract`, a HOST-RUN code
node, then cross-checks the whole graph while it is still cheap to fix: every page endpoint ref exists,
every endpoint table ref exists, a single-table endpoint's fields are real columns, no duplicate
name/route, every `[id]` route has a caller, every component prop is fed by some endpoint field, no
table is unread, and every automation reads/writes/reacts-to a table that actually exists. A CONDITIONAL
`plan_automations` also runs in this design pass, reading the USER STORIES: only a story whose payoff must
happen while the user is away — a weekly schedule that merges a list, a warning before a renewal lapses, a
reaction to a form submission — yields an automation (a `cron` or `event` hook), and MOST apps emit an
EMPTY list (an app satisfied by opening its pages needs none). On failure it RESUMES `plan_tables` through `onFail`, carrying `errors` — so the
redesign is told exactly which references broke rather than re-running blind. `emit_types` then writes
the validated contract into the project's own `.d.ts`, so **the types exist before the first line of
app code** and every file the model writes is typechecked against them.

Only then does implementation run, each fork receiving its own slice of the contract: write each table
(with its source-derived rows) → `reconcile_tables` (host-run) checks what actually reached disk
against the contract, reconciles column drift silently and resumes the design only if a table is
entirely missing → write each typed API → `smoke_endpoints` (host-run) INVOKES every endpoint with
valid, wrong-typed and missing-param input, because nothing else in the pipeline ever runs one and a
handler returning structurally-valid zeros passes every static check → write each reusable component →
write each page (importing the components, reading the endpoints) → write each planned automation
(`implement_automations`, a per-hook fan-out that runs ZERO times when no story needed one) as a
`hooks/<slug>.ts` — a `cron`/`event` hook whose imperative `handler` reads and writes the real tables
in deterministic Node code, so "a schedule fires code" is delivered with no agent and no LLM.

Beyond SHAPE, one gate proves the app is RIGHT: `plan_acceptance` (a design-pass thinking node) distils
the user stories and the source FIGURES into a few machine-checkable checks — a row-count floor or an
aggregate-value floor on a named endpoint, each grounded in something the brief actually states — and
`check_acceptance` (host-run) CALLS each endpoint against the seeded data and evaluates them, catching a
handler that answers a valid shape with meaningless numbers (a €0 total over a €2,707 trip). It splits
its findings by cause: an endpoint reporting the wrong value while its backing table holds the data is a
CODE fault routed to `fix` like any other; a check that failed because the data itself is short is an
upstream EXTRACTION gap the fixer cannot touch, so it is reported by `finalize`, never chased in code.

Detailing AND writing pages are both per-page host fan-outs, so a slip on one page is salvaged on its
own and can never zero the rest. Once every file is written, a HOST-RUN GATE (`verify`) compiles the
WHOLE app against the real toolchain — the project-app typecheck (a NO-DOM ambient; data only through
`@app/runtime`) then the esbuild bundle — and returns the STRUCTURED error list (exit-status ground
truth, not a self-assessment). It also runs the mechanical scans the compiler structurally cannot: an
api module querying a table that does not exist, a page naming an endpoint that was never generated, a
`[id]` route called without its param, a `{ type, props }` descriptor returned in place of JSX, and a
surface token used as a text colour. Running host-side is deliberate — as prose the model had to
re-emit the scan on every pass, and a gate that fails to execute reports nothing, which reads as
"clean". A file that parsed but does not type-check, build, or pass a scan is routed to a per-file fix
fork — one fork per offending file, reading THAT file's real errors plus the plan — and the fixer then
RESUMES the gate (`onFail`), so the compile→fix cycle loops until clean.

The final node writes the persistent chat layout, runs the ONE authoritative `buildApp()` (the sole
build-invoker — it sets `built` for every route), and reports HONESTLY: it resolves `ok` only when the
build is CLEAN and complete, and FAILS LOUDLY (carrying the residual errors and any missing page)
rather than declaring success on a partial or broken app. Nothing is ever excluded or stubbed to make
the build pass — a broken file is FIXED or the build is reported failed. Every write is its own bounded
node, so a slip on one file no longer loses the build; each writer returns `{ ok, error? }` and
validates at write time, and a returned `{ ok:false }` is read and retried, never resolved blind. Pages
use `@app/runtime` data hooks and `@lmthing/css` design tokens only.
