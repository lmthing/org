## Actual results — run 2026-07-13T06:30:04.013Z

**Verdict: ✅ PASS** · 6/6 checks · 0 issue(s) found · 0.3 min wall clock

### setup

*Expected:* disposable prod user + home-renovation project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 09-home-renovation-mriqobyu@lmthing.test (user-381550684492818058) |
| home-renovation project exists | ✅ | home-renovation |

### Act X — Event storm

*Expected:* a burst of signed inbound webhooks is all accepted (event loop not starved); a normal turn still completes right after

| Check | Result | Actual |
|---|---|---|
| event storm: all 15 signed webhooks processed without loss (burst + spaced retry; loop not starved) | ✅ | 15/15 processed (burst 15, rest re-delivered) |
| pod still responsive after the storm (projects list OK) | ✅ | responsive |
| a normal THING turn still completes right after the storm (loop not starved) | ✅ | 22 chars, 0 recovered error(s) |

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/inbound/alert) | ✅ | see Acts above |

> 3 recovered error(s) inside delegated authoring — deliverables still landed (architect/automator authoring-reliability follow-up).

### Performance

| Metric | Value |
|---|---|
| event storm burst accepted (concurrent) | 15/15 |
| event storm wall clock | 1.5 s for 15 concurrent inbounds |
| recovered eval/typecheck errors across session | 3 |
| total LLM calls | 35 |
| total tokens (in/out) | 10115 / 144 |
| delegates | 5 |
| wall clock | 0.3 min |
