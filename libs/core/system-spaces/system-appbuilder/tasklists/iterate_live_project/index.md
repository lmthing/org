---
input:
  query: string
  attachmentIds: array?
---

Grow or change a LIVE project that already has real tables and pages — add or modify ONLY what
`query` asks for ("also track X", "add a way to Y", "change the Z page to..."), converging on what
already exists rather than re-planning the whole app. This is the automator's correct move for an
ADDITIONAL FEATURE or an UPDATE to something that already works, as distinct from
`repair_live_project` (something already there is BROKEN or MISSING — no new capability is being
asked for) and a fresh `build_live_project` (the project has no tables/pages yet — see
`system-appbuilder/agents/automator/instruct.md`).

**CONVERGE first, every time.** `plan_change` reads the project's real `database/`, `api/`,
`components/` and `views/` before naming anything: a concept an existing table/page/endpoint
already covers is extended or reused under its REAL name, never re-invented under a second one. Only
what the request needs that genuinely does not exist yet is planned as new. An existing artifact the
request does not mention is left exactly as it is — a "grow" pass that reshapes unrelated parts of
the app is churn the user did not ask for and has to distrust.

Implementation mirrors `build_live_project`'s writers (the same `views/*.view.json` spec vocabulary,
the same typed `api/` handlers, the same `writeProjectTable`/`writeProjectViewShell` contracts) but
skips its contract-first machinery (`read_sources`, the per-category planners, `emit_types`) — there
is no pre-computed ambient type contract here, so a written endpoint declares its own LOCAL
`Input`/`Output` interfaces, exactly as `repair_live_project`'s `author_missing` does. `verify`
(HOST-RUN) then re-checks the WHOLE app fresh from disk — the same three ground truths
`build_live_project`'s `verify` and `repair_live_project`'s `diagnose` use — because a change to one
part can break another (a renamed column, a duplicated route). `finalize` reports honestly and
carries forward anything still broken/missing in the SAME `{ missing, errors }` shape
`repair_live_project` accepts, so a caller with a still-imperfect result can hand it straight to
`repair_live_project` rather than re-running this tasklist blind.
