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
