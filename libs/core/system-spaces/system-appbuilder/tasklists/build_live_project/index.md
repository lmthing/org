---
input:
  query: string
  attachmentIds: array
---

Build a complete, openable live-project app from supplied material — as a PLAN → per-item BUILD
pipeline, so no single model turn has to author a whole app at once. First read the attachments, then
distil the request + material into the USER STORIES the app must satisfy, then make a holistic,
BINDING plan of the app (its tables, endpoints, reusable components, and MULTIPLE pages) that serves
every story — the binding plan keeps the PAGE LIST lightweight (route + purpose), so no node ever holds
every page's detail at once. From there each category is a `plan → implement` pair that the host fans out
one file at a time, each planner threaded with the stories + the binding plan + the artifacts already
built upstream: plan the tables → write each table (with its source-derived rows), plan the endpoints
(grounded in the real written tables) → write each typed API, plan the components → write each reusable
component, then — PER PAGE — detail that one page against the real endpoints/components → write it (it
imports the components and reads the endpoints). Detailing AND writing pages are both per-page host
fan-outs, so a slip on one page is salvaged on its own and can never zero the rest. Once every file is
written, a HOST-RUN GATE (`verify`, a code node) compiles the WHOLE app against the real toolchain — the
project-app typecheck (a NO-DOM ambient; data only through `@app/runtime`) then the esbuild bundle — and
returns the STRUCTURED error list (exit-status ground truth, not a self-assessment). It also runs the
mechanical scans the compiler structurally cannot: an api module querying a table that does not exist, a
page naming an endpoint that was never generated, a `[id]` route called without its param, a `{ type,
props }` descriptor returned in place of JSX, and a surface token used as a text colour. Running host-side
is deliberate — as prose the model had to re-emit the scan on every pass, and a gate that fails to execute
reports nothing, which reads as "clean". A file that parsed but does not type-check, build, or pass a scan
is routed to a per-file fix fork — one fork per offending file, reading THAT file's real errors plus the
plan — and the fixer then RESUMES the gate (`onFail`), so the compile→fix cycle loops until clean. The
final node writes the persistent chat layout, runs the ONE authoritative `buildApp()` (the sole
build-invoker — it sets `built` for every route), and reports HONESTLY: it resolves `ok` only when the build
is CLEAN and complete, and FAILS LOUDLY (carrying the residual errors and any missing page) rather than
declaring success on a partial or broken app. Nothing is ever excluded or stubbed to make the build pass — a
broken file is FIXED or the build is reported failed. Every write is its own bounded node, so a slip on one
file no longer loses the build; each writer returns `{ ok, error? }` and validates at write time, and a
returned `{ ok:false }` is read and retried, never resolved blind. Pages use `@app/runtime` data hooks and
`@lmthing/css` design tokens only.
