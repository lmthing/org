## Actual results — run 2026-07-13T20:51:41.003Z

**Verdict: ❌ FAIL** · 3/9 checks · 0 issue(s) found · 0.2 min wall clock

### Act XIV — he opens it on his phone and sees HIS trip

*Expected:* the served app's own API routes return 200 with real fixture-derived data (the layer the page actually fetches — a page can render zeros while the raw data API is fine), and the HTML shell is real; the browser pass (chrome-devtools) is recorded in the report

| Check | Result | Actual |
|---|---|---|
| the app declares ≥1 of its OWN GET routes (what its pages fetch) | ✅ | /cost-list, /field-notes-list, /itinerary-list, /park-fees-list, /photos-list |
| the app's own route GET /tanzania-trip/api/cost-list → 200 with real JSON (the layer the PAGE fetches) | ❌ | status 200: HTML SHELL — the app API is not served at this URL |
| the app's own route GET /tanzania-trip/api/field-notes-list → 200 with real JSON (the layer the PAGE fetches) | ❌ | status 200: HTML SHELL — the app API is not served at this URL |
| the app's own route GET /tanzania-trip/api/itinerary-list → 200 with real JSON (the layer the PAGE fetches) | ❌ | status 200: HTML SHELL — the app API is not served at this URL |
| the app's own route GET /tanzania-trip/api/park-fees-list → 200 with real JSON (the layer the PAGE fetches) | ❌ | status 200: HTML SHELL — the app API is not served at this URL |
| the app's own route GET /tanzania-trip/api/photos-list → 200 with real JSON (the layer the PAGE fetches) | ❌ | status 200: HTML SHELL — the app API is not served at this URL |
| the served page is real HTML (200 + a mounted root) | ✅ | status 200, 2832 bytes |
| the served shell's own bundle RESOLVES as a BROWSER resolves it (a 404 here = a blank app) | ❌ | /assets/index-C6zkfNfK.js → /assets/index-C6zkfNfK.js → 404 · /assets/index-ChXjxEkU.css → /assets/index-ChXjxEkU.css → 404 |

### Whole-session invariants

*Expected:* zero UNRECOVERED eval/typecheck errors across the whole session (recovered ones are the retry surface — a metric, not a failure)

| Check | Result | Actual |
|---|---|---|
| 0 unrecovered eval/typecheck errors across the session | ✅ | none |

### Performance

| Metric | Value |
|---|---|
| recovered eval/typecheck errors (retry surface) | 0 |
| LLM calls | 0 |
| delegates | 0 |
| wall clock | 0.2 min |
| total tokens (in/out) | 0 / 0 |
