## Actual results — run 2026-07-13T02:32:22.513Z

**Verdict: ✅ PASS** · 6/6 checks · 0 issue(s) found · 0.5 min wall clock

### setup

*Expected:* disposable prod user + ceramics-shop project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 08-small-shop-mrignasd@lmthing.test (user-381522424413316746) |
| ceramics-shop project exists | ✅ | ceramics-shop |

### Edges

*Expected:* idempotent re-ask does not clobber spaces; malformed inbound → 0 events; unknown path → 404

| Check | Result | Actual |
|---|---|---|
| idempotent re-ask does not clobber spaces (count did not drop) | ✅ | 8→8 |
| malformed inbound → rejected / 0 events | ✅ | status 401 {"error":{"status":401,"message":"signature verification failed"}} |
| unknown inbound path → 404 | ✅ | status 404 |

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/inbound/reorder) | ✅ | see Acts above |

> 12 recovered error(s) inside delegated authoring — deliverables still landed (architect/automator authoring-reliability follow-up).

### Performance

| Metric | Value |
|---|---|
| recovered eval/typecheck errors across session | 12 |
| total LLM calls | 72 |
| total tokens (in/out) | 412063 / 6627 |
| delegates | 10 |
| wall clock | 0.5 min |
