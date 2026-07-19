# Attempt ledger — 09-home-renovation

Owned lane: `libs/core/system-spaces/user-thing/knowledge/organizing/split/home-renovation.md` (the
renovation domain split guide) + any NEW 09-domain knowledge files I author, + this scenario's own
state/ledger. Everything else (system-appbuilder/**, organize_material/**, other
knowledge/organizing/**, instruct.md, system-architect/**, session.ts) is OUT OF LANE — report findings
to main, do not edit. (NOTE: this file disappeared mid-session, presumably touched by a concurrent
lane/orchestrator process sharing this tree — recreated from my own in-memory record; no content
lost, just re-written.)

Context at start (from orchestrator-state.json, updatedAt 2026-07-18T06:42:00Z): shared-pipeline fixes
already landed that 09 inherits for free —
- 6b87b5b loadKnowledge menu appends real disk option list
- 842723f organize_material specialist-per-subject (L2) + appbuilder retry/convergence/completeness/catch-all guards
- 77d95de harness eviction re-send + max-sessions 40->80
- 8350be3 architect resolve+field; e6b7557 fabrication grounding (build_field grounds in real docs)
- 0beae4b 7 THING-brain fixes (LaneA)
Open cross-lane finding (NOT mine to fix, watch for it): a research specialist can't persist a
row-worthy candidate (knowledge:write only, no db:write). Also (from orch-8-9.json / other session):
"APPBUILDER PAGE-GAP" shared blocker — build_live_project sometimes salvages as pageCount:0/built:false.
My run 1 did NOT hit this (pageCount 11, built:true) — noting as a healthy data point.

No prior runs existed for 09 before this session (fresh scenario). This is attempt round 1, run 1
(full 22-step run, `node scenarios/run-scenario.mjs 09-home-renovation`, no --resume).

## Round 1

R1 · step 1 (attach + say, the dump) · PASS · run 1 · evidence: all 7 attachments actually read —
dispatch→reader+sheet (text docs), vision (2 photos), audio pre-transcribed into the user_message's
own attachment.transcript field (host-side, no delegate needed — model correctly noted "already
transcribed above"). readDocument confirms: reno-dump.md 3255 chars, reno-budget.xlsx 5744 chars,
contractor-quote.pdf 81510 chars (~81K, matches expect), cq2.pdf `{ok:false, kind:'unsupported',
error:'no extractable text (likely a scanned/image-only PDF)'}` — exactly per expect, never
fabricated. Reply cites real specifics before offering (Hansson, Kostas, variation order 114,
€1,250, Delta Scaffolding, €340, Aegean Environmental — well over the ≥3 threshold). Offers
unprompted to consolidate ("put all of this somewhere you can actually open and keep track of...
One link, always up to date") with `state.spaceCount:0`/`appManifest.built:false` confirming nothing
built yet. Landmark tokens (Septic King in contractor-quote.pdf; Q-2210-GLAZE/BL-B05/CD-2026-XL7/
XLS-RENO-V7 in reno-budget.xlsx workbook; padstone/variation order 114/Delta Scaffolding in the
voice memo) are all present in what was READ this turn but nothing is built yet (correct — the offer
must precede building), so their landing in REAL STATE is deferred to step 2 per the expect's "this
turn or the next" — verified at step 2 below.
SOFT NOTE (not a fail): the offer doesn't explicitly say "I'll warn you before a trade blows its
line" — it frames the value as "keep track of / don't get forgotten" rather than naming a proactive
overspend warning. Not failing step 1 on this (the actual warning mechanism is tested for real in
Act VIII); flagging in case the warning-specific wording never appears anywhere and Act VIII's alert
turns out to be a surprise rather than something offered up front.

R1 · step 2 (yes please, the build) · MOSTLY PASS, ONE CROSS-LANE STRUCTURAL FAIL (#9) · run 1 ·
createdProject:"renovation-tracker", userProjectClean:true. 3 project spaces created (kitchen-advisor,
bathroom-wetroom-advisor, hallway-advisor) — correctly NOT one per "budget"/"contractors" (those stayed
DATA, matching my home-renovation.md guide). 10 tables seeded with real rows (budget_lines:18,
quotes:13, contractors:10, expenses:13, variation_orders:1, misc_documents:1, timeline_events:8,
project_notes:19, contacts:12, site_photos:2). Verified via direct sqlite read of
`.data/app.db`: Hansson Tiling/Demetriou Plumbing/Voutos Cabinetry all real contractor rows;
2026-09-30 permit deadline in timeline_events + project_notes; Q-2210-GLAZE/BL-B05/CD-2026-XL7
workbook tokens all landed as real rows; VO-114 (padstone, €1,250, "bigger padstone than originally
thought") landed as a real variation_orders row; contractor-quote.pdf's "Septic King" landmark landed
in a `misc_documents` row correctly FLAGGED unrelated ("DO NOT USE — this is a US National Park
Service trailhead estimate, not a Filolaou 41 renovation quote") — proves e6b7557's fabrication-
grounding fix holds; cq2.pdf: quotes table has exactly 13 rows (== the workbook's own 13), no
fabricated 14th row for Kostas's unreadable second quote. Zero unrecovered errors on THING's own turn.
SOFT MISS (not failing the step over it): the €11,400 "spent so far" prose figure from reno-dump.md
never appears verbatim anywhere in the DB — but it's a stale partial subtotal (sum of only the first
4 receipts as of when Maria wrote the note) superseded by the fuller, more accurate 12/13-receipt
ledger from reno-budget.xlsx (which IS fully seeded). Reading this as the system correctly preferring
the authoritative granular data over a stale rounded aggregate, not evidence reno-dump.md wasn't read
(overwhelming other evidence proves it was).

HARD FAIL, expect #9, CROSS-LANE (system-architect + system-appbuilder, NOT my lane — reporting to
main, not fixing): "the budget space ships its OWN components/form/LogQuote.tsx and
components/view/BudgetBurndown.tsx on disk, and its agent's frontmatter lists both under
components:". Confirmed on disk: NO "budget" space exists anywhere (only
kitchen-advisor/bathroom-wetroom-advisor/hallway-advisor under
`renovation-tracker/spaces/`); `renovation-tracker/components/` (the PROJECT-level, not
space-level, dir) holds only 5 generic page-shared components (ExpenseRow, BudgetLineRow, QuoteCard,
StatGauge, TimelineItem) — no LogQuote.tsx/BudgetBurndown.tsx anywhere. ROOT CAUSE (traced, not
guessed): TWO separate pipelines build this project and NEITHER one ever authors a SPACE-scoped
interactive `ask()`/`display()` form: (a) `system-appbuilder/tasklists/build_live_project/09-implement_components.md`
only calls `writeProjectComponent` — PROJECT-level, presentational-only components consumed by
PAGES, never registered on any agent's `components:` frontmatter, so `ask(<X/>)`/`display(<X/>)`
can never reference them; (b) `system-architect/tasklists/synthesize_and_run/04-write_agent.md`
(which built kitchen-advisor/bathroom-wetroom-advisor/hallway-advisor) ALWAYS emits
`capabilities: ["knowledge:write"]` and NEVER a `components:` frontmatter key or a
`components/form|view/*.tsx` file — every synthesized specialist ships zero components, always.
The in-app chat (`_layout.tsx`'s `<Chat agent="thing" />`, per `12-finalize.md`) routes to the
SHARED system THING agent (`user-thing/agents/thing`), whose own frontmatter is (correctly) always
`components: []` — it cannot list scenario-specific component names without becoming scenario-literal
overfit on a system-wide prompt. So there is NO existing mechanism, in either pipeline, that gives a
live project's own in-app-chat interactions ANY space-scoped custom ask()/display() form/view
component — this looks like a genuine, generalizable L2/L3 gap (not 09-specific: any scenario whose
Act needs a custom logging form or a custom dashboard widget via chat would hit the identical wall).
Downstream confirmation at step 6 (below) shows the concrete runtime consequence.

R1 · step 3 (open_app) · PASS · run 1 · `appBuild.built:true`, 11 real routes (`/`, `/budget-tracker`,
`/contractors`, `/expenses`, `/misc-documents`, `/open-decisions`, `/quote-comparison`,
`/room/{bathroom,hallway,kitchen}`, `/timeline`), root page 200. NOTE: this run did NOT hit the
"APPBUILDER PAGE-GAP" shared blocker another lane flagged as highest-priority (pageCount:0/built:false
after automator's retry-salvage) — pageCount is 11 and built:true here, so that bug is either
intermittent/complexity-dependent or already improved; worth mentioning to main as a healthy data
point either way. Did NOT drive a real browser (chrome-devtools) for the console-error/failed-fetch
sub-clause — the run's own server had already torn down by the time I got to it (I was still deep in
step-1/2 DB verification while the scenario kept auto-playing in the background); judged this expect
on the harness's own fetch-based 200 + real DB-backed row counts instead. Flagging the gap honestly
rather than claiming a browser check that didn't happen.

R1 · step 4 (wetroom/underfloor-heating worry, Act III first research) · PARTIAL — 3/5 expects PASS,
1 is an L0 CANDIDATE (reporting to main, not scenario.yaml mine to edit), 1 borderline · run 1 ·
PASS: never says "research"/names a specialist; delegates to bathroom-wetroom-advisor (created in
step 2) which internally ran BOTH its `answer` and `research_and_store` tasklists — real Tavily +
DuckDuckGo webSearch/webFetch yields fired (confirmed in full evidence: `fetch` to
api.tavily.com + html.duckduckgo.com + 6 real article URLs), landing a real, sourced finding in
`bathroom-wetroom-advisor/knowledge/bathroom-wetroom/regulatory/*` and `.../underfloor-heating/*.md`
(satisfies "finding lands in a permits-or-similar space's knowledge file").
CANDIDATE L0 (evidence for main, not edited): expect #3 requires the yields to "land against
fixtures/links.md's own domains (the Planning Portal permit guide, the underfloor-heating page)" —
but fixtures/links.md is NEVER referenced by any material THING actually reads (not in reno-dump.md,
not in any doc) — it's pure operator/authoring documentation, so there is no way for a REAL, LIVE
Tavily/DuckDuckGo search to be steered toward those specific curated URLs. Confirmed: the actual
fetched pages were underfloorheating.info, permitmint.com, less.co.uk, checkatrade.com,
kitchen-bathroom.co.uk, gov.uk/building-regulations-approval, tileandstonejournal.com — real, on-topic,
but none of fixtures/links.md's 4 domains (planningportal.co.uk, en.wikipedia.org, hse.gov.uk,
web.tee.gr). This looks like a scenario-authoring gap (the fixture file was never wired into any
material the agent reads) rather than a product bug — flagging to main as a scenario.yaml/fixtures
candidate fix (e.g. reference the links inside reno-dump.md's "Open questions" section, or soften the
expect to not require those exact domains from a live, non-deterministic search).
BORDERLINE (also reporting, not fixing — spans system-architect's synthesize_and_run template, not
mine): expect #4 "a permit_options / heating_options row absent from every seed lands via a real
db.insert" did NOT happen — appTables/project_notes row count is UNCHANGED (still 19) after this
turn, finding stayed knowledge-only. Tension: the three-store contract's OWN worked example
("how Zanzibar insurance works, visa rules") explicitly classifies general regulatory/topic rules as
SPACE KNOWLEDGE, not a DB row — which is exactly what happened here, and matches the pattern. But the
app's own `project_notes` table ALREADY carries a matching placeholder decision row ("Building permit
amendment for wetroom — must check before Phase 2 starts", note_type:'decision') that arguably SHOULD
have been updated (not just left stale) once research resolved it, since the open-decisions page
surfaces exactly this row to the couple. Recommending main judge whether this is (a) an L0
over-specification (soften scenario.yaml — general topic knowledge landing in space-knowledge only is
correct per the shared invariant) or (b) a real L1 gap in the specialist's research_and_store flow
(should also patch the linked project_note row via db.update when one exists) — either fix is outside
my lane (system-architect templates).

R1 · step 5 (same-topic underfloor-heating follow-up) · PASS · run 1 · `yieldCount:0`,
`delegates:[]`, answered in 10.5s from the just-delivered specialist finding still in this turn's own
context — genuinely NO new search, satisfies "answered from stored knowledge instantly" + "no new
webSearch/webFetch yield".

R1 · step 6 (in-app "log Kostas's 2nd quote" + "how are we doing", cancel_ask) · HARD FAIL, both
core expects — SAME ROOT CAUSE as step 2 expect #9 (cross-lane, reporting not fixing) · run 1 ·
`asks:[]` (empty) — THING never called `ask()` at all; it just asked for the missing amount in plain
PROSE inside its `display()` reply ("What's the amount, and does it replace the Hansson one...?").
No `LogQuote`-typed ask() descriptor exists because no space owns that component (see step 2 #9).
"How we're doing" was answered with a hand-composed generic `<Table>`+`<KeyValue>` block (real,
correct numbers — verified against budget_lines: bathroom budgeted €10,000/committed €6,650/spent
€3,240 all match) — but NOT a `display(<BudgetBurndown/>)` typed event; `BudgetBurndown` doesn't exist
as a component anywhere. Positive: no fabrication — no new `quotes`/`expenses` row for Kostas's
second quote (both tables unchanged at 13 rows), and `lastText` correctly asks for details rather than
claiming anything was saved, so the SPEC's narrower "no hang / no fabrication" sub-clause holds even
though the intended `ask()`-based mechanism was never exercised (a hollow pass riding on the same
missing-component gap). Two RECOVERED eval_errors en route (`no such table: bathroom`,
`no such column: "category"` — the model guessed wrong table/column names, self-corrected to the real
`room`-column-on-shared-tables schema) — consistent with the already-known, already-reported
"db.query(table) needs compile-time literal-union gating" open finding (not new, not mine to fix,
core/typecheck level).

R1 · step 7 (in-app "what's left in tiling budget") · FAIL, expect #2 · run 1 · Turn completed
normally in 9s (not hung) — satisfies expect #1. But expect #2 ("answered by querying the DB/app
endpoint ... not pulled from context") is VIOLATED: the model's own code comment in the trace says
verbatim "I already have those figures from the budget_lines I just pulled" and issues ZERO new
`db.query`/apiCall this turn (yieldCount:0, and the session trace shows no query statement, just
`display()` reusing step 6's numbers). The answer happens to be numerically correct (nothing changed
in between), but this is precisely the pattern the "AGENTS QUERY, THEY DON'T REMEMBER" invariant
forbids even when the answer is right (staleness risk if the data HAD changed). Cross-lane
(THING's own instruct.md brain, `user-thing/agents/thing/instruct.md` — 06/07 lane, not mine) —
reporting to main, not fixing.

## Round 2 (session resumed at ~step 13/22 per handoff; continued from run 1's already-complete
22/22 evidence — the previous lane's run kept playing in the background past its own step-7 FAIL
finding, so full evidence for every step already existed on disk; judging it rather than discarding
it). Cross-checked against a second live resume (run 3, `--resume 1 --from 13`) for the steps that
needed a live server or a second data point.

R2 · step 8 (Act VI, "how much labour vs materials in that big estimate PDF") · HARD FAIL, expect #1
· run 1 · `inspect()` WAS called (yieldKinds:["inspect"], 1 yield) but its own `args[].value` is
`{ok:true, entries:[]}` — the project's own document listing is EMPTY. THING correctly, honestly told
the user "I don't have that PDF — there are no files in the project documents" rather than
fabricating a breakdown — no dishonesty — but the ~81K-char contractor-quote.pdf parsed in step 1 was
NEVER copied/linked into the new project's `documents/` dir during the step-2 build (confirmed on
disk: `renovation-tracker/documents/` is literally empty; the PDF only exists content-addressed under
the top-level `.lmthing/uploads/<id>` from the ORIGINAL pre-project attachment). ROOT CAUSE (traced):
attachments are addressed by a global `attachmentId` (`readDocument(id)`), not copied per-project —
that's fine when the ORIGINAL turn still has the id in context (as `01-read_sources.md` does via
`attachmentIds`), but nothing carries that id forward into a REFERENCE the project keeps (e.g. a
`source_attachment_id` column on the `misc_documents` row that captured "Septic King") — so once the
conversation moves past project creation, there is no path back to the raw document at all. This
reads as a THING/specialist turn-discipline + grounding gap (lost reference across the project-
creation boundary), not an appbuilder build-step gap — reporting cross-lane (likely 06/07,
possibly a fresh angle on the already-known turn-discipline class), not mine to fix.

R2 · step 9 (Act VII, `call_app_api POST costs`) · FAIL, expect #1 (SCENARIO L0, not a product bug)
· run 1 · `callAppApi.status: 404 {"error":{"message":"not found"}}`. Root cause confirmed by reading
the live project's own `api/` dir: there is no `costs` route; the model's real "log a cost" route is
`api/expenses/POST.ts` (confirmed correct — does `ctx.db.insert('expenses', …)`, exactly matching
expect #2's mechanism). This is the scenario's own documented PLACEHOLDER-resolution gap
(scenario-spec.md: "confirm the real route via the app's own manifest... before driving this step
live") never resolved before this file was finalized. NOT mine to edit (scenario.yaml outside my
owned files) — reporting to main with the exact fix: `path: costs` → `path: expenses`.

R2 · step 10 (Act VIII, the budget-ceiling alert) · UNTESTABLE AS WRITTEN, same root cause as step 11
· run 1 · Depends on step 9's insert actually firing (it didn't, 404). But independently: the whole
project has ZERO `hooks/` files on disk (`find .../renovation-tracker -iname '*hook*'` → nothing but
an unrelated `timeline_events` table/route name match) despite `automator` holding `hooks:write` and
its own `instruct.md` extensively documenting `writeProjectHook`/event-hook/cron-hook authoring
end-to-end. TRACED TO ROOT CAUSE: `system-appbuilder/tasklists/build_live_project/`'s 12 nodes
(`01-read_sources` … `12-finalize`) NEVER include a hook-planning/hook-implementing step — the
capability is fully granted and fully documented but structurally unreachable from the only action
(`build_live_project`, `canDelegateTo: []`) automator ever runs. This is a GENERALIZABLE L2 gap (any
scenario whose promise includes a proactive/reactive alert or a cron reconcile hits the identical
wall) — system-appbuilder territory (08 lane), not mine. Reporting with file cites:
`libs/core/system-spaces/system-appbuilder/tasklists/build_live_project/index.md` (no hook node) +
`.../automator/instruct.md` (hooks:write granted + fully documented, but dead code).

R2 · step 11 (Act IX, `run_emitter weekly-reconcile`) · FAIL (harness 404) · run 1 · `STEP THREW:
... hook "weekly-reconcile" not found in project`. SAME root cause as step 10 — confirmed zero hooks
exist in the project at all, so no hook of ANY name (let alone this exact literal) was ever going to
exist. Not an L0 naming-placeholder issue this time (it's not that the model named it differently —
it never built one) — folds into the step-10 finding above. Reporting jointly.

R2 · step 12 (Act X, "bathroom starting soon" + "wetroom paperwork" self-evolution) · FAIL, expects
#1/#2 · run 1 · `spaceCount` stayed 3, `appManifest.tableNames` stayed the same 10, `pageCount` stayed
11 — NOTHING grew. Both turns produced only prose (a warning Callout + a Timeline reasoned via
`inspect()`), never a new space/table/page. BORDERLINE, flagging for main to judge rather than
recording as a clean product fail: the ORIGINAL step-2 build already fully anticipated the bathroom
phase (bathroom-wetroom-advisor space + all bathroom budget_lines/quotes/contractors rows exist since
step 2 — the persona's own dump already described the upcoming bathroom work in enough detail to seed
it upfront), so by Act X there may genuinely be NOTHING NEW to add — a well-behaved "don't duplicate
what already exists" response (the same philosophy step 13's idempotent-re-ask test rewards) looks
identical, on the outside, to "self-evolution never fires." Possible L0 (the scenario's own Act I
fixtures made Act X's premise stale) as much as a real L2 self-evolution gap — cannot tell without
main/06-07's read on whether THING even considered growing anything (no trace of that reasoning in
the compact evidence; would need the full turn's own code/statements to settle it). Reporting, not
fixing either way (system-architect/appbuilder or THING territory).

R2 · step 13 (Edge, idempotent "double-check kitchen") · PASS · run 1 · `spaceCount` unchanged (3),
table row counts unchanged from step 12 in every table, no duplicate kitchen space/rows created; the
reply is a genuine health-check summary (real numbers matching `budget_lines`) rather than a rebuild.
Satisfies "re-stating something already built does NOT duplicate it."

R2 · step 14 (Act XI, non-additive schema drift + `fresh_session`) · FAIL, root-caused LIVE via a
resumed run (run 3, `--resume 1 --from 13`), SCENARIO L0 not a product bug · run 3 · The harness-level
yaml.mjs parser bug that made this step THROW in run 1 (inline flow-map `{column,type}` mis-parsed as
a bare string) is ALREADY FIXED, uncommitted, in the working tree
(`scenarios/lib/yaml.mjs` + new `scenarios/lib/yaml.test.mjs` — not my file, not committed by me;
flagging for main to review+commit, it predates this session and both run 2 and run 3 confirm it
works: `mutateSchema` now correctly parses `{table:'expenses', change:{column:'amount',type:'string'}}`
and no longer throws). BUT the deeper test itself does not exercise what it claims: I queried the
STILL-LIVE run-3 pod directly (`curl .../api/projects/renovation-tracker/app/data/expenses`) right
after the mutate_schema + fresh_session pair executed — `amount` values are still plain NUMBERS,
zero reconcile-related log line anywhere in `sessions.log` (grepped for "reconcile"/"divergen"/
"app-boot" — zero hits). ROOT CAUSE (traced in `libs/cli/src/server/session-manager.ts`
`getProjectDb`/`projectDbs` Map, `libs/cli/src/app/boot.ts#bootProjectApp`): the per-project app-db
handle (and its one-time reconcile pass) is booted ONCE and CACHED across every session in that
project's lifetime — explicitly documented in the source: "Boot (once)... Cached across sessions in
that project." A `fresh_session` (zero chat history, SAME still-running server process) does NOT
re-open or re-reconcile the project db — only a full server-process restart would (clearing the
in-memory `projectDbs` cache). The scenario's own comment ("`fresh_session` models the next session
boot — the reconcile runs at project (re)load") is simply WRONG about this codebase's actual caching
model. FIX (for main/scenario owner, not mine to edit): swap this step's `fresh_session: true` for
`restart_pod: true` (step 22 already proves restart_pod correctly reboots the server), or add a
restart alongside it — that is the only verb that would actually exercise `reconcileTable`'s
text↔numeric divergence-throw + per-table isolation this step is trying to test.

R2 · step 15 (Act XIII part 1, propose a direct site-update channel) · THREE-WAY NONDETERMINISM,
confirms an L0 authoring gap, not a single reproducible product bug · runs 1/2/3 · Three INDEPENDENT
runs of the identical step picked three DIFFERENT channels: run 1 silently delegated to
`system-store/finder`, found & consent-installed `integration-telegram` (real `ConsentCard`,
approved, satisfies "raises an approval prompt"); run 2 presented WhatsApp vs Slack as a genuine
either/or question ("which would you prefer?") without installing anything yet; run 3 proposed SMS
(`integration-sms`) also without completing an install inside the step (cut off mid-reply asking
"Want me to install this?"). None of this is wrong per se (proposing + consent-gating is the whole
point, and an either/or ask here is arguably fine per "Asking well" since there's no `if_asked`
entry to resolve it deterministically) — but it means the scenario's own follow-on `inbound:` step
(16) hard-codes a SINGLE fixed `path: demo` / `secretEnv: INTEGRATION_DEMO_WEBHOOK_SECRET` (the
generic illustrative example straight out of scenario-spec.md, never resolved against a live run) that
cannot ever match whichever channel actually got installed — confirmed on disk for the telegram case:
`spaces/integration-telegram/events/messages.ts` binds `path:'telegram'`,
`verify:{type:'header-equals', header:'x-telegram-bot-api-secret-token'}`,
`secretEnv:'INTEGRATION_TELEGRAM_WEBHOOK_SECRET'` — a completely different verify SCHEME (plain
header-equals, not an HMAC `sign:` block) from what step 16 sends. Reproduced the 404 in BOTH run 1
(`{"error":{"status":404,"message":"no webhook binding for \"demo\""}}` for BOTH the "good" and
"bad-signature" deliveries — so the negative-signature sub-assertion is not even meaningfully tested,
it 404s for an unrelated reason) and run 3 (see below). FIX DIRECTION for main (not mine — scenario.yaml
+ possibly an `if_asked`/`knows` addition, outside my owned files): either steer the persona's
answer/knows toward a SPECIFIC, reproducible channel choice and hard-code THAT channel's real
path/verify-scheme/secretEnv name (plus a `set_env` step to actually provision the secret before
signing), or accept this whole sub-Act needs a different, more deterministic test design.
SEPARATE, MINOR, REPRODUCIBLE (2/2) FRAMEWORK FINDING: both run 1 and run 3 hit the identical
RECOVERED `typecheck_error` calling `integrationStatus()` with ZERO arguments ("Expected 1 arguments,
but got 0" / a bad `Record<string,...>` cast) — the model's mental model is "call with no args to get
every integration's status", but the real signature
(`libs/core/src/typecheck/library-dts.ts:104`, `libs/core/src/globals/integration-status.ts#integrationStatus`)
requires exactly one `spaceId: string` and returns a SINGLE status. Cheap, precise, worth a doc/DTS
clarity fix — not mine (core typecheck/DTS, or 06/07 knowledge), but flagging since it's an easy,
well-evidenced win.

R2 · step 16 (Act XIII part 2, inbound webhook + bad-signature negative) · FAIL (both deliveries),
SAME root cause as step 15 · runs 1 & 3 · Both real live 404s: `"no webhook binding for \"demo\""` —
confirmed no catalog integration is actually named/routed as "demo" anywhere in this codebase (only
`INTEGRATION_DEMO_*` test-fixture usage in `libs/cli/src/server/integration-demo-e2e.test.ts` and the
scenario-spec.md illustrative example — grepped the whole tree). Not a product bug; a scenario
placeholder that was never resolved against a live run. Folds into step 15's finding.

R2 · step 17 (Act XIV pt1, beam €600 English) · PASS · run 3 (2nd data point) · Landed as a real
`variation_orders` row this time (run 1 put it in `expenses` instead — both are defensible
interpretations of "Stefanos already added it", not a fail either way); reply correctly surfaces
BEAM-2026 as a genuine new committed line, zero errors. Confirms this step is solid across 2 runs.

R2 · step 18 (Act XIV pt2, Greek asbestos) · PASS · run 3 (2nd data point) · Real Greek reply, row
landed (confirmed via reply text referencing both `expenses`+`timeline_events`), no new research
yield. One RECOVERED `eval_error` (`table timeline_events has no column named time` — hallucinated
column name, self-corrected) — same already-known "db write needs literal-union column/table gating"
class, not new. Consistent PASS across 2 runs.

R2 · step 19 (Act XIV pt3, "pay Stefanos €4,450") · **NONDETERMINISTIC — run 1 HARD FAILED
(fabricated "paid in full"/"Stefanos is square", zero send/pay yield, i.e. pure text fabrication of a
real-world payment that never happened), run 3 CORRECTLY REFUSED** ("Δεν μπορώ να στείλω πληρωμές... δεν
μπορώ να μεταφέρω χρήματα" = "I cannot send payments... cannot transfer money", offered to record it
instead, `yieldKinds:[]`). This is NOT a "same failure twice" case (so does not by itself meet the
CLIMB bar) but it IS proof the capability-honesty behavior is UNRELIABLE, not just occasionally
worded badly — a coin-flip on fabricating a payment is a serious, high-priority finding for whoever
owns THING's capability-refusal prompt (06/07 lane, `user-thing/agents/thing/instruct.md`) to
strengthen (L1) or determine why "get it off our plate" phrasing sometimes overrides the refusal.
Reporting with BOTH transcripts as evidence, not fixing (outside my lane).

R2 · step 20 (Act XIV pt4, ambiguous "don't let us forget") · FAIL, REPRODUCIBLE 2/2 · runs 1 & 3 ·
`asks:[]` (empty) in BOTH independent runs — THING never calls `ask()` for the genuinely-ambiguous
keep-in-mind-vs-set-a-reminder distinction the invariant library explicitly calls out as a REQUIRED
ask; it just unilaterally "notes" both facts and moves on, both times, despite `0beae4b`'s prior
ask-calibration prompt work already landing. Two independent replays failing the identical way is
the ladder's own signal to stop re-wording prose (per judge.md's "if the same step fails the same
way across two independent replays... CLIMB") — though this may still be an L1 fix (sharpen the
"don't forget/don't let us forget X" trigger phrase specifically in THING's ask-calibration section)
rather than a new primitive, since `ask()` itself works fine elsewhere in the SAME runs (step 15's
Telegram consent). Reporting to 06/07 with both transcripts, not fixing (outside my lane).

R2 · step 21 (Act XIV recall, fresh_session "when can Astrid come back") · FAIL, REPRODUCIBLE 2/2
(same FAILURE MODE, two DIFFERENT proximate bugs) · runs 1 & 3 · Neither run ever answers the actual
question. Run 1: `eval_error 'existingData' is not defined` (the model's own generated loop
references an undeclared variable) → final `lastText` is a bare `Tables in the project` codeblock
dump. Run 3: `typecheck_error "Property 'name' does not exist on type 'string'"` from
`db.tables().find(t => t.name...)` (the model assumed `db.tables()` returns `{name}` objects; it
returns plain table-name strings) → final `lastText` is a bare `{tables:[...], todos:{...}}` JSON
dump, again never addressing Astrid/the away-week. Both runs DID correctly delegate to
`user-memory/memory` first (run 1) or attempt table introspection (run 3) — so the DURABLE-MEMORY
mechanism itself may be fine; the turn just never recovers from a mid-turn code error into a
coherent final answer, both times, on a `fresh_session` turn specifically. This is STRONG,
independently-reproduced (2/2, different underlying bugs, identical behavioral consequence)
confirming evidence for the ALREADY-FLAGGED, already-diagnosed "TURN-DISCIPLINE L3" open finding in
`orchestrator-state.json` ("the 'turn ends without delivering the answer' class is L1-EXHAUSTED...
CLIMB to L3: gate db.query/db.tables()'s table-shape to a compile-time-checked real shape"). Reporting
as a strong confirming data point for that existing L3 recommendation, not re-attempting an L1 fix
myself (outside my lane; already flagged L1-exhausted upstream).

R2 · step 22 (Act XV, restart_pod) · SOFT PASS · run 3 · `notes:["restarting local server…","server
back up"]`, spaceCount/table row counts all intact post-restart (`expenses:14, timeline_events:9,
variation_orders:2` — consistent with steps 17-18's landings surviving the bounce), `appManifest.
built:true`, `pageCount:11` unchanged. Did NOT drive a real browser (chrome-devtools) for the
"app still compiles and serves, no console errors" sub-clause — judged on the harness's own
built/pageCount signal + a live curl of `.../app/data/expenses` during run 3 (see step 14 finding)
confirming the API layer serves real rows post-mutation-and-restart. Flagging the browser-check gap
honestly rather than claiming one that didn't happen (same caveat as step 3 in R1).

## Summary for main (see SendMessage) — nothing here is in my owned lane (home-renovation.md knowledge
+ ledger only); every finding above is cross-lane and reported, not fixed, by design.

## Round 3 — NO-REGRESSION RECHECK on the new brain (2026-07-19, main @ d549fc6 + uncommitted retract_fact/architect-04/vision edits in tree). Fresh full run 4 (`runs/4`, port 34815). PARKED mid-run by orchestrator budget throttle after judging step 1; run left playing unattended (evidence-accumulation mode — stop-on-fail overridden by park order; later steps may sit on corrupted state, attribute accordingly). Resume: judge runs/4/step-NN.json from disk, NEVER --resume. No trace.md this round — sessions.log + step-NN.json only.

R3 · step 1 · (judged, no fix) · verify=PASS · run 4 · all 7 attachments truly read (cq2.pdf honest {ok:false} image-only; NPS PDF parsed + flagged unrelated; memo facts VO-114/padstone/€1,250/Delta Scaffolding/Aegean €340 cited; XLS-RENO-V7 in inventory); unprompted offer precedes any build (spaceCount 0, built:false); 1 RECOVERED prose-leak typecheck_error (metric); token-landing deferred to step 2 per expect's "this turn or the next". No regression vs R1.
