## Actual results — run 2026-07-13T12:04:51.135Z

**Verdict: ❌ FAIL** · 8/9 checks · 0 issue(s) found · 2.9 min wall clock

### setup

*Expected:* disposable prod user + family-recipes project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 10-family-recipes-v2-mrj4x19y@lmthing.test (user-381590816767895178) |
| family-recipes project exists | ✅ | family-recipes |

### Act IV — Cron synthesis → derived rows

*Expected:* a cron hook exists; running it produces an agent turn that writes meal_plan rows AND a DE-DUPLICATED shopping_list (shared ingredients merged — no duplicate ingredient lines)

| Check | Result | Actual |
|---|---|---|
| a cron hook exists for the project (the Sunday planner) | ✅ | {"slug":"sunday-generate-weekly-meals","type":"cron","every":"7d","lastRunAt":1783943402239,"lastFiredAt":1783943402239,"pending":false} |
| the cron handler does NOT gate on the wall-clock weekday (schedule is declared) | ✅ | declared: type: 'cron',   every: '7d',   handler: async ({ db  |
| cron hook run accepted | ✅ | status 200 |
| the weekly run wrote a MEAL PLAN for the week (no human in the loop) | ✅ | weekly_meal_plans: 2 → 2 rows |
| it derived ONE merged SHOPPING LIST from that plan | ✅ | shopping_lists[1] (list column): 57 → 57 items |
| the shopping list is DE-DUPLICATED (shared ingredients merged into one line) | ❌ | DUPLICATE ingredient lines: item×57 |

> shopping list sample: ["{\"item\":\"Wine\",\"quantity\":\"1 spoonful\",\"note\":\"in the meat sauce, from mother’s audio note\"}","{\"item\":\"Rice\",\"quantity\":\"as needed\"}"]

> the weekly channel ping (callConnection) is asserted in Act VI — no channel is installed yet at this point

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/cron/inbound/consent) | ✅ | see Acts above |

### Performance

| Metric | Value |
|---|---|
| Act IV cron trigger → derived rows | 169 s |
| recovered eval/typecheck errors across session | 0 |
| total LLM calls | 0 |
| total tokens (in/out) | 0 / 0 |
| delegates | 0 |
| wall clock | 2.9 min |
