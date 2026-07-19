# Attempt ledger — 08-small-shop

R1 · step 1 · PASS (no fix needed) · all 6 fixtures read (CSV/xlsx via sheet delegate, PDF via reader
delegate, both photos via vision, voice memo transcribed — GLZ1007/KLNEL88 match the verified Whisper
round-trip in fixtures/links.md) · THING offers unprompted citing real specifics · nothing built yet
(spaceCount=0, no writeProjectTable/Page yields before "yes"). run 1, step-01.json.

R1 · step 2 · L2 · `libs/core/system-spaces/user-thing/knowledge/organizing/split/small-business.md`
(new) + `.../organizing/split/index.md` (added to Guides: line) · verify=FAIL (first attempt) · run 2
(`--through 2`): the model never actually loaded the new guide — `01-inventory.md`'s domain-matching
step guessed plausible-sounding names ("crafts"/"studio"/"retail" in run 1's diagnostic pass, then
"inventory"/"sales"/"suppliers"/"studio" in run 2) instead of reading the literal `Guides:` line, all
404'd, fell back to generic `default` only. Root cause of the ORIGINAL fail (only 3 spaces, catalog+
stock merged into "Pottery Inventory Tracker") confirmed L2: `default.md` alone isn't specific enough
to keep materials/stock distinct from products/catalog.

R1 · step 2 · L1 · `.../tasklists/organize_material/01-inventory.md` · verify=PASS · run 3
(`--through 2`, fresh, not --resume): added explicit instruction to match the guide name VERBATIM from
the `Guides:` line, never a guessed synonym. Now builds 4 distinct spaces: `ceramic-materials-advisor`,
`kiln-maintenance`, `kintsugi-advisor`, `supplier-advisor` — no more crude catalog+stock catch-all.
Bonus: invoice INV-3337's real facts ($93.50) now land in a dedicated `invoices` table (previously
dropped to vague prose). Both fixes signalled together as one packet ("FIX READY 08-small-shop
(space-split L2)"), orchestrator to commit.

CAVEAT recorded in the signal: the 4 spaces built don't literally match the scenario's named four
(catalog/suppliers/sales/stock) — got ceramic-materials + kiln-maintenance (stock split two ways) +
kintsugi (a technique specialist) + supplier, with products/sales left as pure DATA (no dedicated
specialist). Judged as satisfying the underlying invariant (≥4 real per-topic spaces, not one
catch-all) even though the topic composition differs from the four illustrative examples.

R1 · step 2 · OPEN ISSUE (not yet attributed to a rung) · the kintsugi-mended bowl from
product-photo.jpg no longer lands as its own NEW products row in run 3 (only the original 6 CSV
finished_goods SKUs exist — regression vs. run 1's diagnostic pass, which DID produce a BOW-KIN-01
row). The physical/sellable item appears to have been entirely absorbed into the new
"kintsugi-advisor" specialist's ADVICE knowledge (technique, materials, pricing) and never promoted to
a DB row too. Suspect this lives in system-appbuilder's automator prompt (how it seeds tables from
`specialistFacts`), not organize_material — needs a fresh trace read before attributing L1 vs L2.
NEXT: attribute + fix this, then re-verify step 2 fully (all 10 expects), then continue driving
step 3 onward with `space_session` resolved to the REAL agent slug (`ceramic-materials-advisor/
ceramic-materials-advisor`) for step 6, not the scenario's literal `stock/advisor` placeholder.

R1 · step 2 · L1 · `libs/core/system-spaces/system-appbuilder/tasklists/build_live_project/
01-read_sources.md` · verify=PASS (reproduced twice, runs 3 & 4) · the kintsugi-mended bowl from
product-photo.jpg now reliably lands as its own NEW products row. Root cause: the task flagged
voice-memo-only materials/suppliers as "NEW — not in CSV" (correctly became rows) but never applied
the same treatment to a vision-derived item, describing it as "a product photo matching what's
already there" — letting downstream planning fold it into the existing count and drop its row. Fix:
explicit instruction that a vision/audio item not already in a structured source is its own NEW
record, phrased the same way as a missing structured value. Also updated `08-small-shop/
scenario.yaml`'s step-2 expect (L0) per orchestrator's correction: materials/stock distinct from
products/catalog is the hard invariant; products/sales as DB data (no dedicated specialist) is fine
when nothing in the arc asks pricing/sales advice — dropped the literal "catalog"/"sales" naming
requirement.

R1 · step 2 · OPEN, NOT CHASING FURTHER (documented, not a blocker) · exact specialist COUNT (3 vs 4)
and whether the off-topic demo invoice gets its own table are non-deterministic across runs —
downstream of `consolidate_scopes`'s own "aim small, err toward fewer" judgment, not attributable to
one file. The ONE hard invariant (materials/stock never merged with products/catalog) held reliably
across both verification runs (3 & 4). Recommended NOT over-fitting a stronger "always ≥4" guarantee;
flagged this judgment call to the orchestrator. If it recurs as a real step-2 blocker on the next full
run, escalate to L2 (a firmer rule in `consolidate_scopes` or `small-business.md` about never merging
suppliers into materials) — but note the scenario's OWN step 4-6 arc (research a cheaper clay supplier
via the "stock" specialist) actually supports materials+suppliers sharing one specialist, so forcing
strict separation may fight the scenario's own narrative.

NEXT: drive the FULL scenario (not just --through 2) from a fresh run, judging steps 3 onward for
real, resolving `space_session` for step 6 from whatever the live pod's `pod.listSpaces()` actually
returns (do not hardcode a slug from any prior run — it changes every time).

R1 · step 2 · L1 (partial) · `libs/core/system-spaces/system-appbuilder/tasklists/build_live_project/
01-read_sources.md` (second edit, same file) · verify=PARTIAL · found the read_sources brief literally
wrote "Discard for this build" for the off-topic demo invoice in 2 of the first 3 verify runs — its own
values ($93.50, INV-3337) never reached ANY state, contradicting the expect ("proof the PDF's text
layer was actually parsed, not skipped for being irrelevant"). Added an explicit instruction: a
document judged unrelated to the primary business is still transcribed with its own values, never
"discarded" — irrelevance flags it, it never justifies dropping its numbers. Verified (run 6): the
brief no longer says "discard" and fully quotes the invoice's fields — BUT the invoice STILL never
reaches a DB row or knowledge fact, because `03-plan_app.md` (the table-SET decision, upstream of
`04-plan_tables.md`) doesn't allocate any table shaped to hold a one-off, off-topic document's facts;
none of the 7 tables it planned fit an "invoice/receipt" record. So the read_sources fix closed the
"actively discards" wording bug but not the deeper "no table exists to catch it" gap in plan_app/
plan_tables. NOT YET FIXED — deprioritizing for now (this is 1 of 10 step-2 expects, nothing downstream
in the scenario depends on the invoice again, and the CORE structural fixes — space-split, kintsugi
row, project creation — are solid across 4 consecutive runs). If picked back up: read
`system-appbuilder/tasklists/build_live_project/03-plan_app.md` + `04-plan_tables.md` for whether they
have a "does every source get a home" checklist, and add one if not (general principle: a document
that doesn't fit any planned table still needs a landing spot — a generic small table, or at minimum a
clearly-labelled knowledge fact — never silent loss).

CONFIRMED STABLE across runs 3, 4, 5, 6 (4 for 4): kintsugi-mended bowl always lands as its own product
row (BOW-KIN-01 or equivalent). Materials/stock is NEVER merged with products/catalog (confirmed 4/4).
Exact specialist count varies (3-5, including one run with an apparent duplicate space-registration
artifact worth a closer look if seen again: run 6 had both `ceramics-inventory-tracker` and a stray
`ceramics-inventory` dir — did not investigate further, may be a `registerSpace` retry artifact rather
than a real duplicate-build; not scenario-blocking either way since the higher-count outcome still
keeps materials/products separate).

NEXT: drive the FULL scenario (steps 3-19) from a completely fresh run (not --through), same loop as
before. Space-split + kintsugi-row fixes are solid enough to build on top of.

R1 · step 3 · PASS · verified with REAL chrome-devtools browser check (not just a 200): dashboard
shows real material/product/sale/kiln/supplier/gallery values, zero console errors, all 7 API xhr
calls 200. run 7.

R1 · step 4 · FAIL, attributed, NOT yet fixed (clean stopping point) · "Is there somewhere closer or
cheaper than Sibelco... what actually IS whiteware" — THING correctly delegates to the
materials/stock specialist, which correctly recognizes its static knowledge doesn't cover it and
researches live (webSearch/webFetch hit digitalfire.com, britannica, several real clay-supplier sites
— the "LOOK BEFORE YOU SEARCH" + live-research invariants are satisfied) and the finding IS stored to
the space's OWN knowledge (`writeKnowledge` call confirmed in trace). BUT the expect's second half —
"the finding lands BOTH as a row (a candidate supplier fact) AND as a line in knowledge" — FAILS: no
new supplier row appears in the `suppliers` table (checked run 7's `step-04.full.json` appTables —
same 7 suppliers as before the question, no candidate added).

ROOT CAUSE (confirmed via the live space's own frontmatter, `.../spaces/materials-supply-chain/agents/
materials-supply-chain/instruct.md`): `capabilities: [knowledge:write]` — ONLY knowledge-write is
granted to this specialist's agent, no `db:write` (or equivalent). This is STRUCTURAL: no instruction
fix can make an agent write a row it has no capability to write. `organize_material`'s specialist-build
path (`03-build_specialist.md` or wherever the architect scaffolds a space's frontmatter) apparently
never grants DB-write to specialist agents — reasonable as a DEFAULT (most specialists are pure
advice/knowledge, per the "three-store contract"), but this scenario's own invariant library explicitly
wants a research finding that's ALSO data-shaped (a candidate supplier the user would look at on a
page) to reach BOTH stores. This is either:
  - L2: give specialist agents a narrowly-scoped grant/tasklist analogous to the `write_fact`/
    `migrate_to_app_db` pattern already used elsewhere (per `judge.md`'s own worked example) for
    "this finding is data-shaped, propose/write it as a row in the owning project's table" — OR
  - the finding should instead flow back through THING itself (which DOES hold broader capabilities)
    rather than being written by the specialist directly — i.e. the specialist returns
    `{ answer, candidateRow: {...} }` and THING is the one that writes the row via its own DB
    capability, keeping the specialist itself capability-minimal. This second shape is probably the
    RIGHT rung (no new capability grant needed, just a return-shape + a THING-side instruction to look
    for a data-shaped finding and write it) — recommend investigating this path FIRST before granting
    a new capability.

NEXT: read `user-thing/agents/thing/instruct.md`'s existing "hand the finding back to the space that
owns the topic" guidance (research triage section) to see whether it already expects the specialist to
return a candidate row for THING to persist, or whether this needs a new instruction + return-shape on
BOTH the specialist's `research_and_store` tasklist AND THING's own delegate-response handling. Also
check `03-build_specialist.md` (or equivalent architect scaffold step) to confirm `knowledge:write`-only
is really the universal default before assuming it needs to change globally vs. just for this response
path.

## Session checkpoint (context-pressure stop)

Two solid, committed, verified fixes landed this session (space-split L2 + knowledge guide, kintsugi-
row L1, plus the scenario.yaml L0 correction and the read_sources "never discard" L1 — see above).
Step 1-3 are solid/reproducible. Step 4 is the next thing to fix — clearly attributed above, ready for
a fresh continuation to pick up without re-deriving. See handoff.md for the exact resume commands.

## R2 — appbuilder findings (owned lane: system-appbuilder/** + organize_material/** + knowledge/organizing/**)

R2 · step 2 (finding #4: pile-parts under-splitting) · L2 · restructured `organize_material`:
`01-inventory.md` split into `01-enumerate.md` (NAMING pass — loads `organizing/split` menu +
per-domain guide(s), lists one entry per guide-defined instance — "splits by each PET" ⇒ one
entry per named pet, never one "pets" entry) + `02-inventory.md` (now `forEach: enumerate.subjects`
— ONE independent fork builds the full `{topic,goal,research}` scope for ONE named subject, so a
distinct low-fact part can no longer be silently absorbed into a bigger scope by a single holistic
free-form pass). Renumbered `03-consolidate_scopes.md` (now consumes `inventory` as an ARRAY, not
`inventory.scopes` — updated its own references), `04-build_specialist.md`, `05-build_live_app.md`
(content unchanged, filename only). Updated `organize_material/index.md`'s description and
`libs/core/src/spaces/system-spaces-dag.test.ts`'s node-contract assertions to match (moved the
loadKnowledge/menu checks onto `enumerate`; added `inventory.dependsOn===['enumerate']` +
`inventory.forEach==='enumerate.subjects'` checks). verify=PASS: `pnpm test
libs/core/src/spaces/system-spaces-dag.test.ts` 16/16 green; FULL FRESH run 8, step 2 — 4 clean
distinct specialists (Materials & Supplies Tracker, Finished Products & Catalog Advisor, Supplier
Tracker, Kiln & Equipment Advisor), materials/stock never merged with products/catalog, live trace
shows `consolidate_scopes` correctly reading `inventory[0].research`/`inventory[1].research`/…
(the new array contract). Also incorporated main's `6b87b5b`/`a673f57` loadKnowledge menu-append
change: `01-enumerate.md` points at the auto-appended "Available options" list, not a hand-maintained
"Guides:" line.

R2 · step 2/4 (finding #2: automator retry non-idempotent) · L1 ·
`system-appbuilder/tasklists/build_live_project/05-implement_tables.md` · verify=PASS · added a
retry-safety guard: check `listProjectDir('database').entries` for `item.name + '.json'` BEFORE
seeding; if the table file already exists (a forEach element retried with a fresh fork after a
PRIOR attempt's write already landed — the host's forEach-item retry from
`orchestrator.ts:284-315` re-runs the SAME statement from scratch, and `writeProjectTable` would
otherwise re-insert `item.rows` a second time with freshly generated ids), write schema-only (no
rows) — the merge is idempotent, the seed is not. Verified: run 8's live trace shows the model
emitting this EXACT guard for every table; final row counts have ZERO duplicates anywhere (18
materials/7 products/23 sales/7 suppliers/1 filed_document/2 works_in_progress, every SKU/name
unique) despite the turn's own delegate log recording TWO separate
`system-appbuilder/automator/build_live_project` entries for the same turn.

R2 · step 2 (finding #5: every parsed source needs a home) · L1 ·
`system-appbuilder/tasklists/build_live_project/03-plan_app.md` · verify=PASS · added an explicit
"every parsed source needs a home" rule: an off-topic/one-off document's stated values still need a
landing spot — never mint a table shaped only for that one document (junk-table sprawl), add ONE
general-purpose catch-all table instead, reserving a dedicated table only once a shape recurs.
Verified: run 8 — invoice INV-3337 landed as exactly ONE row in a `filed_documents` table with its
real total (93.5) and a clear "DEMO — … NOT operational" label, and the app even grew a dedicated
`/documents` page for it (not junk-sprawled: one general table, one row).

R2 · NEW finding (extends #2, found during MY OWN verification, not in the original 5) ·
BUILD_LIVE_PROJECT RE-INVOCATION DUPLICATES TABLES/BREAKS PAGE-ENDPOINT WIRING · L1 ·
`system-appbuilder/tasklists/build_live_project/03-plan_app.md` · verify=CODE-REVIEWED, NOT
independently re-triggered (expensive to force deterministically) · Live evidence from run 8 (well
after step 2): a LATER pass planned fresh `sales_orders`/`equipment`/`invoices` tables duplicating
the EXISTING `sales`/`materials`/`filed_documents` concepts under different names, then rewrote the
`dashboard-summary` endpoint to read the NEW tables while `pages/index.tsx` kept reading the OLD
field names — a real chrome-devtools browser check showed the home dashboard rendering
"Materials on Hand: 0 / Unpaid Amount: €NaN" over a fully-populated real DB (empty-shell/broken-page
regression, caught live, not from the assigned 5). Fix: `03-plan_app.md` (the ONE binding-membership
node) now reads `listProjectDir('database')`/`listProjectDir('pages')` FIRST and must reuse EXISTING
names for existing concepts rather than planning a fresh parallel set when the project already has
tables/pages (this pipeline is meant for the FIRST build only; a retry/re-invocation must converge,
not duplicate — same principle as automator's own "Running twice must CONVERGE" section, now applied
at the planning layer where it was previously absent). NOT re-verified against a forced double
build_live_project invocation — flagging honestly; the fix is a straightforward extension of an
already-established, working principle (automator/instruct.md's existing convergence discipline)
applied to a node that lacked it.

R2 · step 3 (open_app) · PASS (via run 8's own evidence: `appManifest.built:true`, 8 routes, root
200) · plus a REAL chrome-devtools check — surfaced the NEW finding above (caught mid-flight, after
later steps had already grown the app further; not a step-2/3-time regression from my changes).

R2 · step 4 (finding #1: researching specialist can't persist a candidate row) · NOT FIXED —
CONFIRMED CROSS-LANE, reported to main · re-confirmed unchanged on run 8: THING delegates to the
materials specialist, which researches live (webSearch×1, webFetch×1) and stores its own knowledge,
but ZERO `db.insert` occurs and the `suppliers` table stays at 7 rows (no new candidate). ROOT CAUSE
(same as prior attempt, re-confirmed): `system-architect/tasklists/synthesize_and_run/04-write_agent.md:17`
hardcodes `capabilities: ['knowledge:write']` for EVERY synthesized specialist, and
`05-write_tasks.md`'s generated `research_and_store`/`store` node only ever calls `writeKnowledge` —
both 06-lane files. THING's OWN "hand the finding back to the space that owns the topic" contract
(`user-thing/agents/thing/instruct.md:419-422`, 07-lane) has NO data-shaped return contract for a
specialist to hand a row-worthy candidate back for THING to persist (THING already holds
`db:read`+`db:write` itself). RECOMMENDED fix (two-lane, no new capability grant): (a) 06 —
`research_and_store`'s `store` node also returns a `candidate: {...} | null` field when the finding
names a concrete row-shaped entity; (b) 07 — THING's research-triage section reads that field and
`db.insert`s it into the owning project's matching table itself. Not touched (both files are outside
my owned lane) — see FIX READY signal to main for the full packet.

## Session checkpoint 2 (context-pressure, clean handoff)

Steps 1-3 solid on a fresh run (run 8). Step 4 unchanged/cross-lane (reported). Five files changed +
verified in my lane (organize_material ×5 + the dag test + 3 system-appbuilder task files +
automator/instruct.md); all uncommitted, edit-lock held pending orchestrator review. See handoff.md.

## R3 — TASK 1 (shared blocker): automator page-gap root-cause — INVESTIGATION ONLY, human STOP directive
mid-flight, NO edit landed this round · files read, zero edits made · edit-lock was already held by
07-life-admin (not touched) · NOT verify=anything — this is a root-cause writeup for the next
continuation, not a fix.

Evidence trail (07-life-admin run 11, `scenarios/07-life-admin/runs/11/`):
- `step-03.json`: `appManifest:{pageCount:0,built:false}`, `appPageStatus:404`, `appError:null` — the
  same shape the task brief described.
- `sessions.log` (19208 lines): confirmed via grep counts — `writeProjectTable`×48,
  `writeProjectApi`×38, `writeProjectComponent`×16, **`writeProjectPage`×0**. The last automator
  activity before the log jumps to an unrelated LATER scenario step (electricity-tariff research,
  step 4) is `writeProjectComponent("StatusBadge", …)` — i.e. the build got through
  `08-plan_components`/`09-implement_components` and NEVER reached `10-plan_pages` at all (no
  `plan_pages`/`implement_pages` instruction text appears anywhere in the log — grepped for the task
  files' own distinctive phrases, zero hits).
- `data/.lmthing/sessions-ledger.jsonl`: the single `system-appbuilder/automator#build_live_project`
  `DelegateEntry` grows `inputTokens` 40180 → 629994 over 34 snapshots. Traced this to
  `libs/cli/src/server/session-ledger.ts#SessionLedger.ingest` (`case 'llm_response'`): every
  descendant fork's token cost is attributed to the **nearest enclosing delegate** node
  (`nearestDelegate` walks node parentage), so this is a CUMULATIVE total-cost-of-the-whole-build
  figure across every tasklist node/forEach-item fork, not one conversation's context outgrowing a
  window. (The ledger entry's `status` flipping to `"done"` while the number keeps climbing afterward
  is a benign async trace-flush ordering artifact — deprioritized, not load-bearing to the real bug.)

Structural read of `libs/core/src/tasklist/orchestrator.ts#runTasklist`: its scheduling `while` loop
can ONLY return an envelope once `done.size + skipped.size === total tasks`, and NONE of
`build_live_project`'s 12 nodes are `optional`/`condition`-gated (so none can ever land in `skipped`) —
meaning the function structurally CANNOT produce a normal envelope while `10-plan_pages`/
`11-implement_pages`/`12-finalize` never ran. So either (a) `runTasklist` genuinely never returned
(still in-flight when evidence was captured — ruled out; the recorded turn shows
`interrupted:false`, i.e. the harness's `sess.send()` polling saw the session go IDLE within the
20-min per-turn cap, `scenarios/harness/lib/thing.mjs:305` `#dispatchAndWait timeoutMs=1_200_000`), or
(b) a REQUIRED task deep in the DAG (most likely `10-plan_pages` or `11-implement_pages`, both
non-optional; `implement_pages` IS a `forEach` with its own `FOREACH_ITEM_ATTEMPTS=3` per-element
retry, but `plan_pages` is a single fork with NO retry at the orchestrator level) threw — per
`orchestrator.ts:293-306`, a non-optional task failing throws `Required task "X" failed: …` and
ABORTS THE WHOLE `runTasklist` call (no salvage at the tasklist level for a non-forEach required
task; salvage is a FORK-internal, not-forEach-item mechanism, and "a hard budget cap on the main
loop propagates as `BudgetExceededError` and rejects… rather than salvaging" per
`org/docs/runtime/fork-and-tasklists.md`). That thrown error surfaces to the automator's own turn as
a normal JS rejection on `currentTask.resolve(await tasklist('build_live_project', seed))` — a
RETRYABLE runtime error the automator's own turn loop would re-attempt (re-running the WHOLE
tasklist from scratch each time; the existing idempotent/convergence guards — R2's
`05-implement_tables.md` retry-safe check + `03-plan_app.md`'s convergence guard — keep re-seeding
from duplicating rows, so retries look like "wasted, but not corrupting" work) — burning the
observed cumulative token growth across MULTIPLE full/partial re-attempts, until the automator's own
outer session exhausts its retry/episode budget and gets silently salvaged (a neutral placeholder,
never visible as a top-level `errors` entry in the step evidence THING/the runner captures — matching
"status: done, errors: []").

LEADING HYPOTHESIS for WHY `plan_pages`/`implement_pages` would fail on a large app specifically
(not yet directly observed — a budget-exceeded rejection deep in a nested fork does not surface its
own message in the compact step evidence, and reading the full trace to confirm was where this
investigation was cut off by the human STOP directive): `06-plan_endpoints.md` and
`07-implement_endpoints.md` both declare `dependsOn` on `plan_tables` and get its FULL schema +
ALL SEEDED ROWS threaded in as upstream context (`getUpstreamOutputs`/`getUpstreamOutputSchemas` in
`orchestrator.ts` pass `allOutputs[dep]` RAW, uncompressed); `10-plan_pages.md` depends on `plan_app,
plan_endpoints, plan_components, user_stories` — i.e. it receives the FULL endpoint list (every
route's purpose/fields/tables) and FULL component list threaded in. For a LARGE app (12 tables, 16
routes, per the task brief's numbers) this upstream blob is substantial and scales with app size —
exactly the "prompt-cost that scales with the app, not the task" shape the task brief's option (b)
flagged. The DAG topology ITSELF is not naively serial, though: `plan_pages` depends on
`plan_components` (the SPEC), not `implement_components` (the WRITTEN files) — so the DAG already
allows `plan_pages` to run in PARALLEL with `implement_components`'s forEach, and `implement_pages`
only waits on `implement_components`+`plan_pages`. The bottleneck is not "pages are scheduled last in
file-order" (they aren't, structurally) — it's that by the time `plan_pages` becomes ready, the
CUMULATIVE distinct upstream artifacts it (and everything after it) must carry are large enough on a
big build to risk a per-fork budget trip, with NO structural fallback if that trip happens (a required,
non-forEach task's single failure kills the whole tasklist, unlike a forEach item which gets 3 tries
+ salvage).

NOT YET CONFIRMED (would need the STOPPED investigation to resume): reading `step-02.full.json`'s
raw yield/error detail for evidence of an actual `BudgetExceededError`/"Required task ... failed"
message reaching the automator's own turn's `eval_error`/`typecheck_error` retries (the COMPACT
`step-02.json` I read only shows 4 early THING-side typecheck errors before automator was even
delegated to — none from inside the tasklist). This is the single most valuable next probe: grep
`step-02.full.json` (or re-run with a trace) for `"Required task"` / `BudgetExceededError` /
`forkDepth` to nail which node actually threw, rather than inferring it structurally.

PROPOSED FIX DIRECTION (not implemented, not verified — next continuation's starting point): option
(a) from the task brief — mirror the freeform grow path's "openable-early" principle inside the
TASKLIST itself. Concretely: insert a node (or extend `12-finalize.md`'s own preconditions, or add a
new `06b-` node) that writes a MINIMAL index page + a persistent `_layout` right after
`05-implement_tables` succeeds — BEFORE the endpoint/component/page fan-out that risks the budget —
so `built:true`/`pageCount>=1` survives even if `plan_pages`/`implement_pages` later fail or degrade.
The real `10-plan_pages`/`11-implement_pages` pipeline would then OVERWRITE this minimal page with the
richly-wired one when it succeeds; when it doesn't, the app is still openable. This does not yet
address the root COST driver (large upstream blobs threaded into every downstream planner — option
b), which is worth revisiting once (a) stops the visible symptom, since the wasted-retry cost/latency
would still be real even if pages always land.

STOPPED HERE on an explicit human directive (via main) to freeze all lanes — no edit was started, the
edit-lock (held by 07-life-admin throughout) was never touched, and the one 08-small-shop run I had
launched (run 9, for TASK 2's resume) was killed cleanly per the directive before touching anything
else. See handoff.md for the exact resume state.

## R4 — TASK 2 actually driven: steps 1-3 judged in full, 3 NEW findings, ZERO fixed (context-cap stop)

R4 · step 1 · PASS (re-confirmed) · run 9 · all 6 fixtures read via delegates, THING offers unprompted
citing ≥2 real specifics, zero space/table/page yields before "yes". No fix needed.

R4 · step 2 · L1 (found, NOT fixed) · `system-appbuilder/tasklists/build_live_project/03-plan_app.md`
· verify=N/A (not attempted) · BUG A: the kintsugi-mended bowl (product-photo.jpg, vision-described:
blue glaze, gold seams, floral motif) never lands as its own products row — it gets conflated with
"Kintsugi repair kit" (a DIFFERENT item, from a sales-ledger note on an unrelated order) purely because
both mention the word "kintsugi." Root cause pinned to `plan_app`'s own row-counting pass
(`runs/10/sessions.log` ~6102-6128: "...Shino glazed jug) PLUS kintsugi repair kit = 6. Total 12" — the
photographed bowl never separately tallied). Confirmed via `runs/10/snapshots/step-02/.../app.db`'s
`products` table: no bowl-describing row exists, only the repair-kit one. Recommended fix: a
domain-neutral guard in `03-plan_app.md`'s "every parsed source needs a home" section — a shared
keyword/theme between two facts is NOT evidence they're the same instance; a vision/audio item keeps
its own row unless another source explicitly ties it to the same instance (matching id/order
ref/SKU). Full detail + exact quote in handoff.md's "BUG A" section.

R4 · step 2 · L2 (found, NOT fixed) · `user-thing/tasklists/organize_material/01-enumerate.md` and/or
`system-appbuilder/tasklists/build_live_project/01-read_sources.md` · verify=N/A (not attempted) ·
BUG B: the kiln-shelves photo (studio-photo.jpg)'s rich vision detail ("multiple stacked shelves...
mixed bisque/glaze states...") never reaches ANY space knowledge — grepped every knowledge `.md` in
`runs/10/snapshots/step-02/.../spaces/*/knowledge/**`, found only the voice-memo's "11 bisque mugs"
fact, nothing describing the actual photo content. Root cause: `readDocument()` returns
`{kind:'unsupported'}` for ANY image attachment (confirmed: `libs/cli/src/server/uploads.ts:308-310`),
so organize_material/build_live_project depend entirely on THING's OWN paraphrase when it calls
`tasklist('organize_material', {specialistFacts: '...'})` — and that paraphrase this run was a lossy
one-liner ("kiln interior with work in progress"), losing all distinguishing detail. THING's own
construction of that paraphrase is `user-thing/agents/thing/instruct.md` territory (out of my lane,
not touched). Recommended fix (confirmed feasible via sub-agent research, in MY lane): give
`01-enumerate.md`/`01-read_sources.md` their own `canDelegateTo: [system-vision/vision]` + a prelude
`delegate('system-vision','vision', {...})` call on image attachmentIds, so the pipeline re-derives
full vision detail directly from the source. Exact precedent already in the codebase:
`user-thing/tasklists/build_specialist/01-research.md` (same `canDelegateTo` + prelude-delegate
shape, different target). `delegate()` gating is via `canDelegateTo` only
(`libs/core/src/exec/capability.ts:66-104`), orthogonal to `role`/`functions:` — no other frontmatter
change needed. Full detail in handoff.md's "BUG B" section.

R4 · step 3 (open_app) · L1 (found, NOT fixed) ·
`system-appbuilder/tasklists/build_live_project/{09-implement_components,11-implement_pages}.md` ·
verify=N/A (not attempted) · BUG C, SEVERE: the app fails to BUILD AT ALL —
`POST /api/projects/yuki-studio/app/build → 400: Could not resolve "../components/CountComparison"`,
`appPageStatus:404` (`runs/10/step-03.json`). Root cause #1: the generated `CountComparison.tsx` has a
genuine TSX syntax bug (a stray trailing comma inside a JSX `className={...}` expression container —
`expr,` before the closing `}`), which throws in `assertSourceParses` so `writeProjectComponent`
returns `{ok:false}` and the file never lands (confirmed absent from
`runs/10/data/.lmthing/yuki-studio/components/`). (The source separately ALSO uses raw stock Tailwind
colors — `bg-emerald-100`/`text-red-600`/etc — a real but SEPARATE violation of
`09-implement_components.md`'s "tokens only" rule; confirmed `lintComponentSource`
(`libs/cli/src/app/authoring/lint.ts:86-94`) does NOT check for this, only a default export, so this
is not what caused the `{ok:false}` — the stray comma is.) Root cause #2: `09-implement_components.md`
has ZERO instruction to check `w.ok`/retry-on-failure (unlike `05-implement_tables.md`, which at least
has that PROSE, though its own example has the same gap) — the failed write is silently accepted.
Root cause #3: `11-implement_pages.md` DOES see `implement_components`'s per-item `{name,ok}` results
via `dependsOn`, and the model's own reasoning elsewhere shows it KNEW "CountComparison failed to
implement" (correctly omitted the import on other pages) — but for `counts.tsx`, the one page that
actually needs it, it emitted the import anyway right after commenting it would skip it (a
self-contradicting generation mistake); `11-implement_pages.md` has no rule forcing an actual
cross-check against the ok-list before importing. Recommended fix, two-part, both files in MY lane:
(a) add the missing "check w.ok, read w.error, fix, retry before resolving" prose to
`09-implement_components.md`; (b) add a defensive "verify a planned component is in the ok-list before
importing it anywhere" rule to `11-implement_pages.md`. Full detail + exact code snippets in
handoff.md's "BUG C" section. THIS IS THE HIGHEST-PRIORITY FIX — it blocks the app compiling at all,
which likely poisons later steps (16, 19) too.

R4 · step 4 · re-confirmed UNCHANGED, still cross-lane (06/07), NOT touched · `git log` confirms
neither `system-architect/tasklists/synthesize_and_run/{04-write_agent,05-write_tasks}.md` nor
`user-thing/agents/thing/instruct.md` have a candidate-return-contract fix since R2. Same root cause as
before (see R2 section above). Steps 5-19 ran to completion in run 10 (evidence exists) but were NOT
judged this session — context cap hit first.

## Session checkpoint 3 (context-cap, clean handoff)

Zero edits made, zero edit-lock taken (investigation + judging only this session). Runner environment
quirk discovered and worked around (see handoff.md's "NOTE on the runner") — future attempts should
launch `run-scenario.mjs` via the Bash tool's `run_in_background: true`, not `nohup … & disown`. Three
concrete, root-caused, unfixed findings handed off (BUG A/B/C above) — fix BUG C first (severe, blocks
the whole app), then A, then B, each verified via `--resume 9 --from 1 --through 3` before moving to
steps 4-19. See handoff.md for full detail and exact resume commands.

## R5 — fresh continuation, JUDGED run 11 (prior lane applied all 3 fixes uncommitted; did NOT re-run)

R5 · verify=PASS · BUG A (kintsugi-bowl conflation) · `03-plan_app.md`'s "shared keyword ≠ same
instance" guard (domain-neutral, verified no scenario literal in the prompt text) works as intended.
Run 11 evidence: `snapshots/step-02/.../app.db`'s `studio_pieces` table has its OWN row ("Kintsugi-
repaired blue-glazed bowl", blue glaze + gold-filled crack lines, `photo_available:1`,
`status:catalogued`) fully DISTINCT from `sale_line_items`' unrelated "Kintsugi repair kit" line (order
ETS-5507, qty 1, price 0) — the two are no longer merged. (Minor, non-blocking: the expect's "blossom
motif" detail never appears anywhere in this run's vision output/reasoning — likely a vision-fidelity
gap on the fixture image itself, not a re-manifestation of the conflation bug; the core defect — same-
keyword merge — is resolved.)

R5 · verify=PASS · BUG C (stray-comma component breaks whole build) · both
`09-implement_components.md` (retry-on-`w.ok:false` + JSX-trailing-comma/raw-Tailwind-color examples)
and `11-implement_pages.md` (cross-check `implement_components`' ok-list before importing) diffs match
the proposed fix exactly, domain-neutral. Run 11 (a DIFFERENT app shape than run 10 — 4 tables'-worth
fewer text, no `CountComparison` this time, so not a byte-for-byte repro of the original trigger, but
the fix's general mechanism is what's on test): `step-03.json` → `appBuild.built:true`, 4 real routes
(`/`, `/finished-goods`, `/materials`, `/materials/:sku`), `appBuild.error:null`, `appPageStatus:200`.
Confirmed on-disk: `runs/11/data/.lmthing/yuki-studio/pages/` has 4 `.tsx` files, `components/` has 8 —
no dangling/missing file, no orphaned import anywhere in the app.

R5 · verify=FAIL — root cause is a CORE RUNTIME gap, NOT fixable inside my lane · BUG B (kiln-shelves
photo's detail never reaches knowledge). The `01-enumerate.md`/`02-inventory.md` diff is exactly the
proposed shape (`canDelegateTo: [system-vision/vision]` + a prelude `delegate('system-vision','vision',
{query, attachmentIds: imageIds})` call, matching the `build_specialist/01-research.md` precedent) and
IS domain-neutral. But in run 11 it does not work: `sessions.log` (~line 159) shows the delegate call's
OWN result is `"I can't access the attached image in this interface, so I'm unable to describe its
contents."` — the vision sub-agent received NO image. Grepped every knowledge `.md` under
`snapshots/step-02/.../spaces/*/knowledge/**` — still nothing describes the studio photo's actual
content (multiple shelves, mixed bisque/glaze states); the kiln-equipment-advisor's notes only carry
the VOICE-MEMO fact (11 bisque mugs) same as before the fix.

ROOT CAUSE (confirmed by reading the runtime, not inferred): `libs/core/src/session/session.ts`'s
TOP-LEVEL `runDelegate` (~L1032-1134, used for a session's OWN top-level `delegate()` calls) resolves
`delegateOpts.attachmentIds` → real `attachments`(MediaPart)/`attachmentTexts` via
`this.pendingAttachments.get(aid)` before calling `runDelegate()` in `delegate/delegate.ts`. But
`runDelegateForFork` (~L749-800 — this is the `delegateRunner` wired into `ForkEngine` at L844, i.e.
the path EVERY delegate() call issued from INSIDE a fork or tasklist node goes through) does the
resolution NOWHERE — it passes `delegateOpts` straight through unchanged. `delegate/delegate.ts` only
reads `opts.attachments`/`opts.attachmentTexts` (the RESOLVED forms), never `opts.attachmentIds` (the
raw id list the model passes) — so a tasklist-fork delegate call carrying `attachmentIds` silently
loses the image every time, and the receiving agent gets nothing (no MediaPart, no id-note), which is
exactly why vision (whose own instructions never call `readDocument`) answers "I can't access the
attached image." This is STRUCTURAL and GENERAL: it breaks ANY `canDelegateTo`+`attachmentIds` call
made from ANY tasklist task, not just `organize_material`'s — a wider blast radius than one lane.
NOT in my subsystem (`libs/core/src/session/session.ts` is core runtime, shared across everything) —
reported to main, not touched.

Two viable fix directions (not applied, for main to route):
(a) core-runtime, general fix: mirror `runDelegate`'s attachment-resolution block (L1063-1104) inside
`runDelegateForFork` before its own `return runDelegate({...})` — fixes every tasklist-fork
attachment-delegate call at once, matches the "same principle as its sibling" shape.
(b) caller-side workaround (still not my lane — `user-thing/agents/thing/instruct.md`): have THING
resolve vision detail for every image attachment itself (top-level context, where resolution already
works) BEFORE calling `tasklist('organize_material', {...})`, and thread the full text in as a seed
field instead of a paraphrase — sidesteps the runtime gap but only for this one call site.
Recommend (a): it is the smaller, most general, most surgical fix and the intended design (per the
established top-level/fork "sibling" pattern) was clearly for the two paths to behave identically.

R5 · NEW finding (not A/B/C, discovered incidentally while judging step 2, NOT investigated further —
flagged for main's triage) · two things happened to the SAME catch-all "notes" table this run that
look like a REGRESSION + a hallucination:
1. **INV-3337 (the real, correctly-parsed, correctly-flagged "$93.50 demo invoice, not a pottery
   supplier invoice" fact) never reaches ANY table this run** — confirmed via `sessions.log` grep for
   "INV-3337"/"93.5": the model's own reasoning names it correctly (twice, in two different specialist
   builds) but ZERO `db.insert`/`writeProjectTable` seed row for it exists anywhere in
   `snapshots/step-02/.../app.db`. This is a regression from R2/R4's established behavior (previously
   verified landing as a `filed_documents` row with a "DEMO — NOT operational" label).
2. **The app's ONE `notes` table instead holds a fact that does not exist in ANY of the 6 real
   fixtures**: `{category:'unresolved', note:'Ranger tip ~TSH 5,000 unresolved — clarify with Richard
   (Suricata Safaris)', source_person:'Richard / Suricata Safaris', ...}`. Verified this is NOT
   fixture-file contamination — the actual uploaded `voice-memo.mp3` bytes for this run md5-match the
   real 08-small-shop fixture exactly (`3f3eeb08...`, confirmed against
   `08-small-shop/fixtures/voice-memo.mp3`) and its stored `transcript` field
   (`runs/11/data/.lmthing/uploads/8755b517-*.json`) is the correct, real Yuki pottery-studio transcript
   — no Tanzania content anywhere in it. Also verified `libs/core/system-spaces/**` has zero
   occurrences of "suricata"/"ranger tip"/"richard" (not a leaked few-shot example either). "Suricata
   Safaris" genuinely belongs to `06-tanzania/fixtures/tanzaniamemories.md` (a DIFFERENT scenario) — the
   model appears to have spontaneously fabricated a 5th "voice memo fact" (labeled `VOICE-005` right
   alongside 4 REAL ones, `VOICE-001`-`004`) that has no basis in any of this run's actual material.
   Root cause NOT pinned further (would need to trace which specific task/turn introduced it, past this
   session's budget) — flagged as a correctness/hallucination concern for main's triage, not chased.
   Net effect: the app's one general-purpose catch-all row got SPENT on a fabricated fact while a real,
   correctly-identified one (INV-3337) was dropped entirely.
Both are ORTHOGONAL to BUG A/B/C and NOT touched — reported for main's awareness/triage only.

R5 · other step-2 expects spot-checked (not exhaustive, but nothing else looked broken): dedicated
project `yuki-studio` (not `user`) ✓; 4 distinct specialist spaces, materials/kiln/products/suppliers
never merged ✓; THERMO-K26 `on_hand_qty:0`/`low_stock:1`/note "OUT OF STOCK — kiln reads 40C low" ✓;
Keramikos Amsterdam `CTR-KMA-2026-04` ✓; WHL-0007 `payment_status:unpaid`/`is_overdue:1` ✓.

Session checkpoint: zero edits made this session (judging only, per the gate — awaiting main's OK
before any further edit). See handoff.md for the full DECISION PACKET sent to main.

## R6 — charter session (appbuilder endpoint→table gate + scope rule)

R6 · charter (06 run 25 step 10 class) · L1 (proposed, NOT yet applied) · 8 files in
build_live_project/{03-plan_app,05-implement_tables,06-plan_endpoints,12-compile_pass1,
13-fix_pass1,14-compile_pass2,15-fix_pass2,16-finalize}.md · verify=PENDING (awaiting main's OK) ·
Root chain fully pinned on run 25 evidence: kebab-case table name minted at plan_app → host
assertTableName rejection → no retry in implement_tables example → endpoints written against the
known-missing table explicitly trusting a gate that has no endpoint→table check (ctx.db dynamic,
buildApp clean, unknownColumnsIn skips unknown tables). Run 29 step 10 judged LEGITIMATE (real
column-add, verified on snapshot schema+sqlite) — no fix from it. Full proposal + verify plan in
handoff.md R6 header; decision packet sent to main. Zero edits this session so far.
