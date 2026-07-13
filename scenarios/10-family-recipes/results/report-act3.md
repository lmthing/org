## Actual results — run 2026-07-13T10:27:54.854Z

**Verdict: ❌ FAIL** · 8/9 checks · 0 issue(s) found · 6.7 min wall clock

### setup

*Expected:* disposable prod user + family-recipes project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 10-family-recipes-mrj1htfi@lmthing.test (user-381581171747743370) |
| family-recipes project exists | ✅ | family-recipes |

### Act III — Agent-processed recipe form

*Expected:* the app has an "add recipe" form + a db-INSERT hook (NOT ctx.spawn); submitting a raw recipe fires an agent turn that normalizes it into a structured row (NEW token, before/after)

| Check | Result | Actual |
|---|---|---|
| a db-INSERT hook wires the recipe-intake → normalize path (not ctx.spawn) | ✅ | {"slug":"normalize-recipe-intake","type":"event","on":{"event":"project/db.recipe_intake.insert"},"pending":false} |
| the "add recipe" form endpoint exists on the app | ✅ | endpoints: GET /recipe-get, POST /recipe-intake-create, POST /recipe-save, GET /recipes-list, GET /weekly-menu-current, POST /weekly-menu-generate, POST /weekly-menu-save |
| the raw recipe was filed through the intake (NEW token / dish present) | ✅ | REV-INTAKE-7742 / ρεβίθια present after |
| the db changed after the submission (not a no-op) | ✅ | db changed |
| an AGENT normalized it into a structured recipe row (ingredients broken out) | ❌ | {"id":"5bf19ee3-3e1b-4f0e-a0ad-be7db98f5b53","title":"Ρεβίθια στο φούρνο (ref REV-INTAKE-7742)","raw_text":"500γρ ρεβίθια από το βράδυ μουλιασμένα, 2 κρεμμύδια, χυμό από 1 λεμόνι, ελαιόλαδο, ρίγανη, 2 ώρες στους 180°C σε |
| the recipe count grew (a real new row, before/after) | ✅ | 0 → 1 recipe rows |

> browser POST /app/family-recipes/api//recipe-intake-create → 405 (the public chat host serves /app/* as the web SPA; the app's own API lives on the app host — the reachable db.insert→hook path is asserted below)

> before: 0 recipe rows, contains NEW token? false

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/cron/inbound/consent) | ✅ | see Acts above |

> 11 recovered error(s) inside delegated authoring — deliverables still landed (architect/automator authoring-reliability follow-up).

### Performance

| Metric | Value |
|---|---|
| recovered eval/typecheck errors across session | 11 |
| total LLM calls | 54 |
| total tokens (in/out) | 264095 / 31622 |
| delegates | 9 |
| wall clock | 6.7 min |
