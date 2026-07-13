## Actual results — run 2026-07-13T12:01:51.596Z

**Verdict: ✅ PASS** · 5/5 checks · 0 issue(s) found · 2.5 min wall clock

### setup

*Expected:* disposable prod user + family-recipes project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 10-family-recipes-mrj1htfi@lmthing.test (user-381581171747743370) |
| family-recipes project exists | ✅ | family-recipes |

### Act VIII — Remember me

*Expected:* a durable household preference routes to user-memory (remember yield/delegate); a later, unrelated turn recalls it

| Check | Result | Actual |
|---|---|---|
| the preference routed to memory (user-memory delegate or a remember/memory yield) | ✅ | memory path observed |
| a later turn recalls the stored preferences (half mint + roasted aubergines) | ✅ | {"type":"Stack","props":{"gap":2},"children":[{"type":"Heading","props":{"level":2},"children":["Για αύριο: γεμιστά + μουσακάς για τους δικούς σου"]},{"type":"Callout","props":{"variant":"warning","title":"Τα 3 βασικά πο |

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/cron/inbound/consent) | ✅ | see Acts above |

> 9 recovered error(s) inside delegated authoring — deliverables still landed (architect/automator authoring-reliability follow-up).

### Performance

| Metric | Value |
|---|---|
| recovered eval/typecheck errors across session | 9 |
| total LLM calls | 48 |
| total tokens (in/out) | 135308 / 27514 |
| delegates | 10 |
| wall clock | 2.5 min |
