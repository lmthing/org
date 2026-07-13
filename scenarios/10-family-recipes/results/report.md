## Actual results — run 2026-07-13T16:56:49.249Z

**Verdict: ❌ FAIL** · 8/11 checks · 0 issue(s) found · 10.1 min wall clock

### setup

*Expected:* disposable prod user + family-recipes project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 10-family-recipes-v4-mrjf2rza@lmthing.test (user-381619445493163658) |
| family-recipes project exists | ✅ | family-recipes |

### Act XI — The app is a living surface

*Expected:* the app ships an always-available in-app THING in pages/_layout; the app's OWN api routes answer 200 with real data (not a silent zero-fallback); and a change asked for from INSIDE the app lands live

| Check | Result | Actual |
|---|---|---|
| A1 — the app ships an in-app THING dock in pages/_layout (⇒ on EVERY route) | ✅ | _layout ships <Chat agent="thing">: <Chat agent="thing" className="flex-1" /> |
| A2a — every one of the app's OWN api routes answers 200 (no silent 500 → zero-fallback) | ❌ | automation-run-logs-list:200 12b · cuisines-list:200 878b · favorites:200 3358b · meal-plan-entries-list:200 19809b · pantry-items-list:200 4342b · recipe_intake-list:200 491b · recipe-detail:400 208b · recipes-list:200 14397b |
| A2a — those routes return real DATA, not an empty shell | ✅ | 7/8 return a non-empty payload |
| A1 — the in-app turn AUTHORED (it called a project writer, it did not just reply) | ❌ | [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [ |
| A1 — a REAL change landed from inside the app (a new page/table now exists that did not before) | ❌ | {"newPages":[],"newTables":[],"pages":8,"tables":10} |
| A1 — the favourites were actually SET on real rows (μουσακάς / σπανακόπιτα) | ✅ | a truthy favourite flag is set on real rows |
| A1 — the app still compiles after the in-app change (it is live, not broken) | ✅ | {"built":true,"routes":8} |
| A2 — the entry asset the served index.html references is really SERVED (a rebuilt app is not a blank page) | ✅ | index.html → assets/entry-I3ZL5YYC.js · GET → 200 (javascript) |

> A2b — browser render (chrome-devtools) is asserted out-of-band and recorded in scenario.md §Actual results: what rendered, the dock, console/network errors, screenshot path.

> recovered: {"type":"typecheck_error","message":"Cannot find name 'parsed'.; Cannot find name 'parsed'.; Cannot find name 'parsed'.","statement":"// I have the parsed schem … (architect/automator authoring-reliability follow-up)

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/cron/inbound/consent) | ✅ | see Acts above |

### Performance

| Metric | Value |
|---|---|
| Act XI in-app turn → change live | 147 s |
| Act XI recovered errors (delegated authoring) | 5 |
| recovered eval/typecheck errors across session | 0 |
| total LLM calls | 0 |
| total tokens (in/out) | 131123 / 3381 |
| delegates | 0 |
| wall clock | 10.1 min |
