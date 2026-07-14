## Actual results — run 2026-07-13T22:25:40.280Z

**Verdict: ❌ FAIL** · 16/26 checks · 0 issue(s) found · 12.6 min wall clock

### Act I — The offer, the yes, and the build

*Expected:* turn 1 (six attachments) ends in an OFFER citing ≥2 real specifics, with NO build yield/delegate yet; a bare "Yes please." triggers ≥4 per-topic spaces + a served app; every fixture token lands in real state

| Check | Result | Actual |
|---|---|---|
| all 6 fixtures uploaded with the right kinds | ✅ | file,file,image,image,file,audio |
| turn 1 did NOT author the app yet (no writeProject* yield before consent) | ✅ | setSessionMeta, delegate, delegate, delegate, delegate, loadKnowledge, loadKnowledge, loadKnowledge, readDocument, readDocument, readDocument, readDocument, readDocument, readDocument, inspect, inspect, inspect, inspect, inspect, inspect, inspect, inspect, inspect, inspect |
| turn 1 did NOT create spaces yet (no architect/appbuilder build delegate) | ✅ | system-vision/vision, system-files/dispatch, system-files/sheet, system-files/reader |
| turn 1 READ the files (delegated to system-files and/or system-vision) | ✅ | system-vision/vision, system-files/dispatch, system-files/sheet, system-files/reader |
| the offer cites ≥2 of HER real specifics | ✅ | sibelco, keramikos, whl-0007, tenmoku, cobalt, mori, kiln, speckled, bloem |
| turn 1 OFFERS to organize it (never asked in words) | ✅ | {"type":"keyvalue","props":{"pairs":{"inventory.csv truncated":"undefined","sales-ledger.xlsx truncated":"undefined","supplier-invoice.pdf truncated":"undefined"}},"children":[]} {"type":"stack","prop |
| ≥4 per-topic spaces created (catalog/suppliers/sales/stock-ish) | ❌ | — |
| a materials/stock space exists (the future studio assistant) | ❌ | — |
| app compiles (built:true) with real JS assets | ❌ | {"built":false,"routes":0} |
| app serves ≥1 page route | ❌ | — |
| app root serves 200 HTML | ❌ | status 404, 39b |
| inventory.csv: unique token "CLAY-W12" landed in REAL STATE | ✅ | space-file |
| inventory.csv (supplier): unique token "Sibelco NL" landed in REAL STATE | ✅ | space-file |
| xlsx Materials: unique token "THERMO-K26" landed in REAL STATE | ✅ | space-file |
| xlsx Suppliers: unique token "Keramikos Amsterdam" landed in REAL STATE | ✅ | space-file |
| xlsx Sales: unique token "WHL-0007" landed in REAL STATE | ✅ | space-file |
| supplier-invoice.pdf: unique token "INV-3337" landed in REAL STATE | ✅ | space-file |
| product-photo.jpg: its vision fact (kintsugi/gold-seam/mended bowl) landed in state | ❌ | vision description grounded |
| studio-photo.jpg: its kiln-load vision fact landed in state | ❌ | kiln photo grounded |
| voice-memo.mp3: unique token "tenmoku" (normalized) landed in REAL STATE | ✅ | space-file |
| voice-memo.mp3: unique token "GLZ-TEN-07" (normalized) landed in REAL STATE | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| voice-memo.mp3: unique token "speckled buff" (normalized) landed in REAL STATE | ✅ | space-file |
| voice-memo.mp3: unique token "Kiln and Clay Rotterdam" (normalized) landed in REAL STATE | ✅ | space-file |
| voice-memo.mp3: unique token "KLN-EL-88" (normalized) landed in REAL STATE | ✅ | space-file |
| no eval/typecheck errors on THING turns in Act I | ❌ | [{"type":"typecheck_error","message":"']' expected.","statement":"// The knowledge loads returned undefined — perhaps the knowledge base path differs. Let me proceed to read all three documents direct |

### Whole-session invariants (Edges)

*Expected:* zero UNRECOVERED eval/typecheck errors on THING's own turns; the SSRF echo host never reached; routing not degraded

| Check | Result | Actual |
|---|---|---|
| zero eval/typecheck errors across the THING session (hard fail) | ❌ | 3 errors: {"events":232,"llmCalls":29,"tokens":{"in":126686,"out":17713},"errors":3,"delegates":["system-vision/vision","system-files/dispatch","system-files/sheet","system-files/reader","system-appbuilder/auto |

### Performance

| Metric | Value |
|---|---|
| Act I — ingest → offer | 170 s |
| Act I — build after "Yes please." | 50 s |
| wall clock | 12.6 min |
| total tokens (in/out) | 126686 / 17713 |
