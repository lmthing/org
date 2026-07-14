## Actual results — run 2026-07-14T07:12:24.860Z

**Verdict: ❌ FAIL** · 18/26 checks · 0 issue(s) found · 10.3 min wall clock

### Act I — Notice, don't ask; propose; a plain yes builds it

*Expected:* before "yes please": no spaces + no tables (nothing built); turn 1 poses an OFFER citing ≥3 file facts; all 7 attachments classify (file×4/image×2/audio×1); system-files+system-vision delegated; the memo/workbook/PDF spoken-only tokens land in real state; cq2.pdf resolves {ok:false,unsupported}; after "yes please": ≥3 spaces, app built:true with tables+≥1 page, ≥1 seeded table

| Check | Result | Actual |
|---|---|---|
| BEFORE the dump: no spaces exist | ✅ | 0 spaces |
| BEFORE the dump: no app tables exist | ✅ | 0 tables |
| all 7 fixtures uploaded with the right kinds (file×4, image×2, audio×1) | ✅ | file,file,image,image,file,file,audio |
| cq2.pdf upload observed as unsupported/failed extraction (not a guessed total) | ✅ | {"id":"b2bdd24a-ee9f-4a5b-a83d-000768071687","kind":"file","mediaType":"application/pdf","filename":"cq2.pdf","url":"/api/uploads/b2bdd24a-ee9f-4a5b-a83d-000768071687"} |
| turn 1 did NOT author the app yet (no writeProject* before consent) | ✅ | setSessionMeta, delegate, delegate, delegate, delegate, loadKnowledge, loadKnowledge, loadKnowledge, readDocument, readDocument, readDocument, readDocument, readDocument, readDocument, readDocument, readDocument, inspect, inspect |
| turn 1 did NOT build spaces yet (no architect/appbuilder delegate) | ✅ | system-vision/vision, system-files/dispatch, system-files/reader, system-files/sheet |
| turn 1 READ the files (system-files and/or system-vision) | ✅ | system-vision/vision, system-files/dispatch, system-files/reader, system-files/sheet |
| the offer cites ≥3 of their real file facts | ✅ | q-2207-kitch, hansson, demetriou, voutos, 11,400, 2026-09-30, kallithea |
| turn 1 OFFERS to build/watch something (never asked in words) | ✅ | ## file summaries for filolaou 41 renovation  ### 1. reno-dump.md (markdown seed document) **what it is:** the master renovation brief for maria & niko's kitchen + bathroom renovation at filolaou 41, kallithea, athens. renovation starts **2 |
| ≥3 per-topic spaces created | ✅ | bathroom-reno-advisor, hallway-works, kitchen-renovation-advisor |
| app compiles (built:true) with real JS assets | ❌ | {"built":false,"routes":0} |
| app serves ≥1 page route | ❌ | — |
| app manifest has ≥1 table | ✅ | 7 tables |
| ≥1 table seeded with rows | ✅ | decisions:1, milestones:3, variations:1 |
| reno-dump.md (quote ref): unique token "Q-2207-KITCH" landed in REAL STATE | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| reno-dump.md (contractor): unique token "Hansson Tiling" landed in REAL STATE | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| reno-budget.xlsx (spreadsheet-only): unique token "Q-2210-GLAZE" (normalized) landed in REAL STATE | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| contractor-quote.pdf (landmark): unique token "Septic King" landed in REAL STATE | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| voice-memo.mp3 (spoken-only): unique token "padstone" (normalized) landed in REAL STATE | ✅ | db(row) |
| voice-memo.mp3 (spoken-only): unique token "variation order 114" (normalized) landed in REAL STATE | ✅ | space-file |
| voice-memo.mp3 (spoken-only): unique token "Delta Scaffolding" (normalized) landed in REAL STATE | ✅ | db(row) |
| voice-memo.mp3 (spoken-only): unique token "Aegean Environmental" (normalized) landed in REAL STATE | ✅ | db(row) |
| ≥1 spoken-only memo fact reached real state (audio → whisper → row/knowledge) | ✅ | padstone, variation order 114, Delta Scaffolding, Aegean Environmental |
| site-photo.jpg + bathroom-photo.jpg vision facts landed (gallery/notes) | ✅ | vision descriptions grounded |
| no eval/typecheck errors on THING turns in Act I | ❌ | [{"type":"typecheck_error","message":"Conversion of type 'Promise<any>' to type 'string' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.; Conver |

### Whole-session invariants (Edges)

*Expected:* zero UNRECOVERED eval/typecheck errors on THING's own turns (hard fail); idempotent re-ask doesn't clobber spaces; malformed inbound → 0 events

| Check | Result | Actual |
|---|---|---|
| zero eval/typecheck errors across the THING session (hard fail) | ❌ | 20 errors: {"events":1510,"llmCalls":142,"tokens":{"in":550652,"out":26684},"errors":20,"delegates":["system-vision/vision","system-files/dispatch","system-files/reader","system-files/sheet","system-architect/ar |

### Performance

| Metric | Value |
|---|---|
| Act I — ingest → offer (turn 1) | 107 s |
| Act I — build after "yes please" | 446 s |
| wall clock | 10.3 min |
| total tokens (in/out) | 550652 / 26684 |
