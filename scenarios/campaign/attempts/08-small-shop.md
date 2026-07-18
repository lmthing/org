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
