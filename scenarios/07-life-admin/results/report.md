## Actual results — run 2026-07-13T22:26:06.742Z

**Verdict: ❌ FAIL** · 8/16 checks · 0 issue(s) found · 5.4 min wall clock

### Act II — Automatic invisible research → knowledge + a row

*Expected:* the electricity-price question (he never says "research") triggers REAL web yields; a fact absent from EVERY fixture lands as a row; a later plain question is answered from INSIDE the right specialist space — which he never named; the boiler manual grounded a knowledge file

| Check | Result | Actual |
|---|---|---|
| it actually went and LOOKED IT UP (≥1 live web yield) | ✅ | 2 web yields: fetch, fetch |
| …and it did that WITHOUT him asking for "research" | ✅ | system-files/dispatch · system-vision/vision · system-files/reader · system-files/sheet · system-appbuilder/automator · system-appbuilder/automator · system-app |
| a researched fact absent from every fixture landed as a ROW (not just prose) | ❌ | rows changed:false · supplier-in-rows:false |
| the boiler manual's own doc/model code grounded a specialist's knowledge file | ❌ | not in any space file |
| a plain follow-up is answered from the built knowledge (date + engineer) | ❌ | {"type":"Stack","props":{"gap":3},"children":[{"type":"Heading","props":{"level":2},"children":["Boiler service — I've got nothing, sorry"]},{"type":"Callout","props":{"variant":"warning","title":"Not |
| …and he never named a single space to get it | ✅ | the user said only "the boiler" — routing was THING's own |

### Act III — The table makes room for a new fact, live

*Expected:* before: the bills table has NO meter-reading column; the gas-meter message triggers a LIVE db.addColumn (an executed statement in the trace — NOT a fresh writeProjectTable that redefines the table); after: the column exists, holds 04821.6 on the gas row, and every PPC/EYDAP row seeded in Act I still holds its ORIGINAL amount/month/due

| Check | Result | Actual |
|---|---|---|
| the vault has a bills-shaped table to migrate | ✅ | bills |
| BEFORE: no meter-reading column exists on the bills table | ✅ | columns: id, utility, provider, billing_period, due_date, amount, status, notes |
| …and it already holds his seeded bills | ✅ | 7 rows |
| it migrated the LIVE table (db.addColumn / db.createTable executed), not a schema rewrite | ❌ | addColumn:false createTable:false writeProjectTable(bills):false |
| …and it did NOT redefine the whole bills table from scratch | ✅ | no table rewrite |
| AFTER: the bills table DECLARES a meter-reading column | ❌ | columns: id, utility, provider, billing_period, due_date, amount, status, notes |
| the reading 04821.6 landed on a real bills ROW | ❌ | NOT on any row |
| …on the GAS bill row specifically | ❌ | {"id":"bill-3","utility":"Natural Gas","provider":"Φυσικό Αέριο","billing_period":"Feb 2026","due_date":"2026-03-10","amount":64.55,"status":"paid","notes":""} |
| every bill seeded in Act I survived the migration UNCHANGED (amount/month/due) | ❌ | 4/7 rows byte-identical |

### Whole-session invariants

*Expected:* zero UNRECOVERED eval/typecheck errors across THING's own turns (recovered ones are the retry surface — a metric, not a failure). Act IV's DELIBERATELY forced typecheck_error is excluded: it is raised in its own probe session, is the proof the Act exists to produce, and is not a defect.

| Check | Result | Actual |
|---|---|---|
| 0 unrecovered eval/typecheck errors across the session | ✅ | none |

### Performance

| Metric | Value |
|---|---|
| Act II — research turn | 29s |
| Act III — live schema migration | 22s |
| recovered eval/typecheck errors (retry surface) | 20 |
| LLM calls | 149 |
| delegates | 27 |
| wall clock | 5.4 min |
| total tokens (in/out) | 1166767 / 47036 |
