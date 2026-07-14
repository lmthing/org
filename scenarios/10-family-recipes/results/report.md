## Actual results — run 2026-07-14T13:18:29.904Z

**Verdict: ❌ FAIL** · 17/21 checks · 0 issue(s) found · 0.9 min wall clock

### Act II — the voice memo is the ONLY source of the RECIPE

*Expected:* a STATIC disjointness grep over the fixtures themselves proves μαστίχα/τσίπουρο/Δέσποινα/Λευκάδα/πράσο/άνηθο appear in the memo and in NO other fixture (the dish NAME does not count — the workbook already schedules Σπανακόπιτα and already carries 750g/320g). The mp3 upload RESPONSE carries a Whisper transcript containing them, BEFORE any chat turn. After the build, a recipes row for that dish carries ≥2 of those audio-only tokens — a row that could only exist if the audio was heard

| Check | Result | Actual |
|---|---|---|
| the xlsx cell reader really read the workbook (sanity: it contains PNT-001) | ✅ | 6411 chars of cells |
| the pdf text extraction is real (sanity: it contains Easy Lasagna) | ✅ | 3094 chars |
| every audio-only token is DISJOINT — present in NO other fixture (else the proof is worthless) | ✅ | μαστίχα, τσίπουρο, Δέσποινα, Λευκάδα, πράσο, άνηθο |
| the dish NAME is NOT audio-unique (it is in the workbook) — so it is never asserted on | ✅ | MealPlan schedules it on Saturday — a row merely named Σπανακόπιτα proves nothing |
| POST /api/uploads returned a non-empty Whisper transcript (synchronous, pre-turn) | ✅ | 486 chars: «Παιδί μου, σου λέω τη σπανακόπιτα της οικογένειας, γράψε να μην χαθεί. Θέλει 750 γραμμάρι… |
| the transcript contains Σπανακόπιτα + φέτα + μαστίχα + τσίπουρο (Greek speech really transcribed) | ✅ | heard: Σπανακόπιτα, φέτα, μαστίχα, τσίπουρο |
| a recipes row exists for the dish the memo dictated | ✅ | recipes: 11 rows |
| that row carries ≥2 AUDIO-ONLY recipe tokens (it could only exist if the memo was heard) | ✅ | μαστίχα, τσίπουρο, πράσο, άνηθο |
| voice-memo.mp3 (audio-only): unique token "μαστίχα" landed in REAL STATE (not prose) | ✅ | db:recipes |
| voice-memo.mp3 (audio-only): unique token "τσίπουρο" landed in REAL STATE (not prose) | ✅ | db:recipes |
| voice-memo.mp3 (audio-only): unique token "Δέσποινα" landed in REAL STATE (not prose) | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| voice-memo.mp3 (audio-only): unique token "Λευκάδα" landed in REAL STATE (not prose) | ❌ | NOT FOUND in any row or space file — the bytes were never read |
| voice-memo.mp3 (audio-only): unique token "πράσο" landed in REAL STATE (not prose) | ✅ | db:recipes |
| voice-memo.mp3 (audio-only): unique token "άνηθο" landed in REAL STATE (not prose) | ✅ | db:recipes |
| ≥2 audio-only facts reached real state (audio → Whisper → row/knowledge) | ✅ | μαστίχα, τσίπουρο, πράσο, άνηθο |

### Act III — readDocument on an image fails on purpose; vision produces the fact

*Expected:* a probe hands the plated-dish PHOTO over with a plain instruction to read it as if it were a scanned page. On turn.events (not the yields projection) a yield_resolved for readDocument on that attachment resolves {ok:false, kind:"unsupported", error:/vision/i} — the host guard, unconditional and by design. The self-correction then delegates to system-vision for the SAME attachment and names ≥2 plating facts (parsley / Greek salad / bulgur side). The probe writes NOTHING new — the recipes row count is unchanged

| Check | Result | Actual |
|---|---|---|
| readDocument on the image resolved {ok:false, kind:"unsupported", error:/vision/} — the host guard fired | ❌ | readDocument resolutions: [] |
| it self-corrected to system-vision for that same photo | ✅ | system-vision/vision, system-files/dispatch |
| vision named ≥2 of the plating facts (parsley / Greek salad / bulgur side) | ❌ | 0/3 plating facts in the reply |
| the probe wrote NOTHING new (recipes row count unchanged) | ✅ | 11 → 11 |
| no UNRECOVERED eval/typecheck errors in Act III | ✅ | [] |

### Edges + whole-session invariants

*Expected:* a malformed emitEvent payload is rejected BEFORE it reaches the hook (0 rows written); re-asking the opening question does not duplicate the per-cuisine spaces; zero UNRECOVERED eval/typecheck errors across the session (hard fail — recovered ones are a metric)

| Check | Result | Actual |
|---|---|---|
| zero UNRECOVERED eval/typecheck errors across the THING session (HARD) | ✅ | 0 unrecovered of 0 total |

### Performance

| Metric | Value |
|---|---|
| Act III — read the photo as a document | 52 s |
| recovered eval/typecheck slips (session) | 0 |
| wall clock | 0.9 min |
| total tokens (in/out) | 28826 / 655 |
