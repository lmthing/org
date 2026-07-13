## Actual results — run 2026-07-13T10:07:16.960Z

**Verdict: ✅ PASS** · 10/10 checks · 0 issue(s) found · 13.5 min wall clock

### setup

*Expected:* disposable prod user + family-recipes project + demo integration secrets loaded

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | 10-family-recipes-mrj1htfi@lmthing.test (user-381581171747743370) |
| family-recipes project exists | ✅ | family-recipes |

### Act II — Deep research → knowledge + DB

*Expected:* system-research delegated + webSearch/webFetch; a researched substitution ABSENT from the seed lands as a substitutions row; the cuisine space answers a follow-up from the researched knowledge

| Check | Result | Actual |
|---|---|---|
| delegated to system-research | ✅ | system-vision/vision · system-files/dispatch · system-files/reader · system-appbuilder/automator · system-architect/architect/synthesize_and_run · system-architect/architect/synthesize_and_run · syste |
| live web research observed (webSearch/webFetch/fetch yields) | ✅ | 12 web yields |
| a substitutions table exists | ✅ | recipes, substitutions, weekly_menus |
| a NEW researched substitution row landed (db grew, absent from the seed) | ✅ | 22668→24705 bytes |
| the substitution row names a REAL butter substitute (not a placeholder) | ✅ | substitute: ελαιόλαδο |
| the substitution row cites a REAL source URL (it actually researched) | ✅ | https://jenny.gr/cooking/ti-na-ftiaxo-simera/406523/paneykoli-mpesamel-horis-gala-kai-horis-boytyro |
| the follow-up answers FROM the saved row (names the substitute the row holds) | ✅ | named "ελαιόλαδο"? true — Έτοιμο: γράφτηκε live app βιβλίου συνταγών, seed data, weekly menu UI, shopping list UI και Κυριακάτικος αυτοματισμός. {"type":"Stack","props":{"gap":2},"childr |

> recovered: {"type":"typecheck_error","message":"'const' declarations must be initialized.","statement":"const functions: { name: string; purpose: string }"} … (architect/automator authoring-reliability follow-up)

### Whole-session invariants

*Expected:* THING's own turns clean; deliverables succeeded (recovered specialist errors noted)

| Check | Result | Actual |
|---|---|---|
| deliverables asserted directly per-Act (spaces/app/rows/hooks/cron/inbound/consent) | ✅ | see Acts above |

> 21 recovered error(s) inside delegated authoring — deliverables still landed (architect/automator authoring-reliability follow-up).

### Performance

| Metric | Value |
|---|---|
| Act II recovered errors (delegated authoring) | 10 |
| recovered eval/typecheck errors across session | 21 |
| total LLM calls | 153 |
| total tokens (in/out) | 505752 / 75110 |
| delegates | 22 |
| wall clock | 13.5 min |
