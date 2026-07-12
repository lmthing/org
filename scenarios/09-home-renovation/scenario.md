# Scenario 09 — Home renovation command center: quotes and receipts become a budget that watches itself

> **One line.** A couple mid-renovation dumps their quotes, receipts, budget, room photos, and a site
> voice memo into a fresh project and asks THING for a per-room tracker with a budget they can *see* —
> one that **warns them before they blow it** and grows new sections as the work moves room to room.
> This scenario exercises the full evolving-lifecycle template end to end and is backed by an
> executable live-prod runner (`09-home-renovation/run.mjs`).

**Persona.** Maria & Niko, renovating their Kallithea apartment (kitchen then bathroom). They are
drowning in quotes, receipts, contractor texts, and phone photos of every wall. They want one place
that shows what they've agreed, what they've spent, what's coming, and — critically — flags them
*before* a trade pushes them over budget. Neither is technical.

**Why this scenario exists.** The PROMISE under test is a **budget db-emitter → hook → agent alert**
inside a real app: an expense is logged, the running total crosses a threshold, and an **agent writes
an over-budget alert** naming the offending trade — with no human asking. Around that it wraps the
full lifecycle: multi-modal ingest (incl. **vision** for a before/after gallery), deep research landing
in a space's knowledge *and* as DB rows (permit rules, heating options), an agent-processed form, a
cron-driven sweep, mid-life self-evolution across **physical phases** (kitchen → bathroom → permits),
and an inbound channel. It also closes/exposes the **`ctx.spawn`-from-app-API gap** and the
**mid-life table+page addition** gap.

---

## 1. The user flow (what the user actually does)

| # | Step (in the UI) | What the user does |
|---|---|---|
| 1 | **Create a project** | They click "New project" and name it **`home-renovation`**. |
| 2 | **Attach the dump** | They attach `reno-dump.md` (quotes/budget/contractors/timeline), a **site photo** (`site-photo.png`), and — if they have one — a **voice memo** from the site. |
| 3 | **Ask, once** | sends the compound message below. |

> *"Attaching all our reno quotes, receipts, the budget, photos of every room, and a voice memo from
> the site. Build me a tracker by room with a budget I can actually see, keep the contractors and
> quotes in one place, and warn me BEFORE a trade pushes us over budget."*

| 4 | **Watch it build** | THING reads the file/photos/memo, creates per-area spaces, and builds the reno app — progress shows in chat. |
| 5 | **See it** | They open **`/app/home-renovation/`**: a budget dashboard, a timeline, a before/after gallery — real data. |
| 6 | **Log an expense** | From the app they submit a "log expense" form; an agent categorizes it against the right trade and the budget updates. |
| 7 | **Get warned** | When a trade's logged total crosses its budget line, an alert appears naming the trade — they didn't ask for it that minute. |
| 8 | **Let it sweep** | A weekly cron reconciles paid-vs-quoted and writes a status note. |
| 9 | **Life changes** | Weeks later: *"starting the bathroom next"* → the tracker grows a bathroom section. Then *"we need a building permit for the wetroom"* → a permits section (with researched local rules). |
| 10 | **Ping from the site** | They connect a channel and message *"Hansson says tiles delayed a week"* → the timeline shifts. |
| 11 | **Keep updating** | *"the load-bearing beam is +€600, log it under kitchen, ref BEAM-2026"* → the row changes. And they test a boundary: *"pay Stefanos the final €4,450"* → THING refuses and hands them a payment-due record instead. |

---

## 2. What the user expects (the contract)

In the user's terms — success is:

1. **"It read my quotes."** THING cites *their* specifics (`Q-2207-KITCH`, `Hansson Tiling`,
   `Demetriou Plumbing`, `Voutos Cabinetry`, `€11,400`, `2026-09-30`), not generic reno advice.
2. **"I can see the budget."** `/app/home-renovation/` opens and shows budget vs spent per trade, a
   timeline, and a gallery — a real dashboard, not an empty shell.
3. **"It checked the rules/options for me."** Research (permit rules, underfloor heating) produced a
   real finding NOT in their file — it landed in a space's knowledge *and* as a row.
4. **"The form worked."** They logged an expense through the app; an agent categorized it against the
   right trade and the budget updated, without them chatting.
5. **"It warned me."** When a trade's total crossed its line, an **alert row** appeared naming the
   trade — proactively.
6. **"It runs without me."** The weekly reconcile cron fired on its own and wrote a status note.
7. **"It grew room to room."** "Bathroom next" and "need a permit" each produced a **new section** — a
   new space *and* a new table *and* a new page on the already-running app.
8. **"It heard me from the site."** The channel message about the tile delay shifted the timeline.
9. **"I can keep updating it."** A later message changes a real row (the beam cost, before→after).
10. **"It knows what it can't do."** "Pay Stefanos €4,450" → it does **not** pay; it narrows to a
    payment-due record for them to authorize.
11. **"It understood me."** A Greek follow-up still updates a row; the compound opener produced all the
    halves.

**Anti-expectations (a failure even if the chat looks fine):**
- A nice summary but **no** spaces and **no** app → "it just answered me."
- An app that opens but is **empty** → "where's my budget?"
- "Researched!" but **no** new row and **no** space knowledge → it didn't really research.
- "Logged!" with **no** agent turn and **no** budget change → the form is a dead end.
- Over budget with **no** alert → it didn't watch.
- "Noted!" on a follow-up with **no** DB change → "it didn't save it."
- "Paid Stefanos!" → overstep; it must NOT pay.

---

## 3. What happens in the background (the choreography)

Hop by hop, for maintainers:

1. **Project creation (UI/API).** `POST /api/projects {name:"home-renovation"}`. THING runs inside it.
2. **Multi-modal upload.** `reno-dump.md` → `kind:'file'`; `site-photo.png` → `kind:'image'` (→ a
   gallery/before row via `system-vision`); a voice memo → `kind:'audio'`. Base64 `POST /api/uploads`.
3. **The message carries all attachments over the WS path**; the HTTP `/message` route drops them.
4. **THING delegates the read.** File ids → **`system-files/dispatch`** (md → reader; image →
   `system-vision`; audio → transcription). Extracted facts return to THING.
5. **THING plans and delegates the build.** (a) Per-area **spaces** (`kitchen`, `budget`,
   `contractors`, `bathroom`) via `build_specialist`, **live-registered**. (b)
   **`system-appbuilder/automator`** authors the live reno app.
6. **The automator authors INTO the live project:** `writeProjectTable(name, schema, rows)` (seeds the
   file's rows — quotes, expenses, contractors, milestones), `writeProjectApi`, `writeProjectPage` (a
   **budget dashboard** + **timeline** + **before/after gallery** page). `POST
   /app/home-renovation/build` compiles; `GET /app/home-renovation/` serves real HTML.
7. **Deep research (Act II).** "Do we need a permit amendment for the wetroom? / best underfloor
   heating" routes to **`system-research/researcher`** (`webSearch`/`webFetch`). Findings land in a
   `permits` space's **knowledge** *and* as a `permit_options`/`heating_options` row via `db.insert`,
   absent from the seed.
8. **Agent-processed form + budget db-emitter→alert (Acts III–IV).** A "log expense" **page form** →
   `POST /app/home-renovation/api/expense-create` → `ctx.db.insert('expenses', …)`. That insert fires
   the synthetic `project/db.expenses.insert` **db emitter** → an **event hook** with `trigger:
   '<space>/agent#budget_check'` → an **agent turn** that compares the trade's running total to its
   budget line and, when crossed, writes an **alert row** naming the trade. **`ctx.spawn` from an app
   API is a known no-op**; the db-insert→hook path is the working one and what this asserts.
9. **Cron-driven agent turn (Act IVb).** A `cron` hook (`every:'7d'`, `trigger:
   '<space>/agent#weekly_reconcile'`) reconciles paid-vs-quoted across trades and writes a status
   note; the runner triggers it via `pod.runEmitter`/`runHook`.
10. **Self-evolution (Act V).** "Starting the bathroom next" reuses `budget`/`contractors` and adds a
    NEW `bathroom` space + `bathroom_tasks` table + page. "We need a building permit" adds a NEW
    `permits` space (researched knowledge) + `permit_tasks` table + a **compliance-checklist page** —
    all on the **already-built** app; `writeProjectTable` on a later turn, `db` rebound, recompile. The
    manifest **grows** post-build.
11. **Inbound + outbound (Act VI).** `installSpace('integration-demo')` raises a **consent card** the
    user approves. A signed `POST /api/inbound/<path>` ("Hansson says tiles delayed a week") →
    verify→emit → event hook → agent → a timeline/milestone update. The agent also emails the
    contractor the revised schedule via **`callConnection`** (drafted/parked, gated `connections:use`).
12. **Later updates + restraint (Act VII).** A follow-up uses `db.update` to log the beam cost (NEW
    token `BEAM-2026`, before/after). "Pay Stefanos €4,450" → THING **refuses/narrows**: no payment;
    it offers a payment-due record.

Everything above is authored by the model into the user's own project — no engineer touches a file.

---

## 4. User stories

- **US-1 — Ingest multi-modal.** *As a homeowner, I want to hand over quotes, photos, and a voice
  memo.* **Accept:** `system-files`/`system-vision` delegated; ≥3 file-specific facts cited.
- **US-2 — See the budget.** *As a homeowner, I want a real app, not a chat reply.*
  **Accept:** app `built:true` with tables + ≥1 dashboard page; `/app/home-renovation/` → 200 HTML.
- **US-3 — My data is in it.** *As a homeowner, I want my quotes/expenses/contractors stored.*
  **Accept:** those tables hold the file's rows, contents matching the file.
- **US-4 — It researches for me.** *As a homeowner, I want permit rules / heating options checked.*
  **Accept:** `system-research` delegated, `webSearch`/`webFetch` observed; a researched row absent
  from the seed lands in an options table + a space's knowledge.
- **US-5 — The form is alive.** *As a homeowner, I want to log an expense through the app.* **Accept:**
  a `POST` to the form API fires an agent turn and an expense row + budget change land (before/after
  with a NEW token).
- **US-6 — It warns me.** *As a homeowner, I want it to flag a trade before it blows the budget.*
  **Accept:** when a trade's logged total crosses its line, a db emitter → hook → agent writes an
  **alert row** naming the trade.
- **US-7 — It runs without me.** *As a homeowner, I want the weekly reconcile to fire on its own.*
  **Accept:** triggering the cron emitter produces an agent turn that writes a status row/note.
- **US-8 — It grows room to room.** *As a homeowner, I want new phases to add sections.* **Accept:**
  "bathroom" and "permit" each add a NEW space + NEW table + NEW page to the running app (manifest
  grows after the initial build).
- **US-9 — It hears me from the site.** *As a homeowner, I want to ping the tracker from a channel.*
  **Accept:** install consent approved; a signed inbound webhook → agent → a timeline update.
- **US-10 — Keep it current.** *As a homeowner, I want to update it by just telling it.*
  **Accept:** a follow-up changes a real row (beam cost, before/after).
- **US-11 — It knows its limits.** *As a homeowner, I want it to not pay money for me.* **Accept:**
  "pay Stefanos €4,450" → no payment (trace clean); a payment-due record offered.
- **US-12 — Understand me.** *As a homeowner who mixes Greek, I want it to work in either language.*
  **Accept:** a Greek follow-up updates a row; the compound opener produced all halves.

---

## 5. Feature coverage (tick what this scenario exercises)

- THING routing: [x] answer [x] research [x] build space [x] app-4a (automator) [ ] app-4b (build_app)
  [ ] code (engineer) [ ] memory [x] install+automate [x] compound request [x] provided-info shortcut
  [x] restraint/refusal [x] multilingual
- Spaces: [x] create per-part [x] live-registered/delegatable [x] no-clobber re-add
- Event pipeline: [x] webhook (inbound) [x] cron [x] db (expenses.insert) [ ] internal ·
  [x] code-handler hook [x] agent-trigger hook · [ ] code nodes [ ] forEach · [x] project functions ·
  [x] loop guard [x] payload validation [x] emitEvent
- Consent/caps: [x] @consent [x] installSpace approve [x] fail-closed headless
  [x] capability gating (`db:write`, `events:emit`, `connections:use`, `store:install`)
- Store/integrations: [x] discovery [x] install a space [x] callConnection [x] inbound webhook
  [x] integration-demo source (keyless; telegram is the prod target)
- Project-app: [x] writeProjectTable(+rows seed) [x] writeProjectPage/Api [x] db:write later-update
  [x] app build [x] /app/<id>/ serving [x] app data API [x] **mid-life table+page addition**
- Attachments: [x] upload [x] readDocument [x] attachmentIds to a specialist [x] vision/audio
- Pod lifecycle: [ ] restart→auto-resume (covered by 05) [x] cold-wake [ ] event storm [x] worker containment (api handler)
- Cross-cutting: [x] edge cases/errors [x] performance [x] budget (direct Azure keys)

---

## 6. Acceptance criteria (the Acts)

The runner (`09-home-renovation/run.mjs`) drives these and asserts on the **trace + real pod state**.
Acts here match the runner 1:1.

| Act | Asserts (trace + real state) | Stories |
|---|---|---|
| **I — Ingest & build** | `system-files`/`system-vision` delegated; ≥3 file facts cited; ≥3 per-area spaces; app `built:true` with tables + ≥1 page; `/app/home-renovation/` → 200 HTML; ≥1 table seeded with file rows (content tokens match) | US-1,2,3,12 |
| **II — Deep research → knowledge + DB** | `system-research` delegated + `webSearch`/`webFetch` observed; a researched fact **absent from the seed** lands as a row in an options table; the permits/contractors space answers a follow-up from researched knowledge | US-4 |
| **III — Agent-processed form** | a `POST` to `/app/home-renovation/api/<form>` returns ≥202; an **agent turn fires** (via `db.insert`→emitter→hook, not `ctx.spawn`); an expense row with a NEW token lands + budget changes (before/after) | US-5 |
| **IV — db-emitter → budget alert** | after a trade's logged total crosses its budget line, a db emitter → hook → agent writes an **alert row** naming the trade; nothing destructive runs | US-6 |
| **V — Cron agent turn → DB** | a `cron` hook exists; `runEmitter`/`runHook` produces an agent turn that writes a reconcile/status row (before/after) | US-7 |
| **VI — Self-evolution** | "bathroom" + "permit" each add a NEW space (live-registered) **and** the app manifest gains ≥1 NEW table and ≥1 NEW page beyond Act I's manifest (mid-life growth) | US-8 |
| **VII — Inbound + outbound** | `installSpace` consent approved; a signed inbound webhook → `{events ≥1}` (bad signature → 401/0 events); an agent/hook writes a timeline/milestone update; a `callConnection` yield observed OR a drafts row | US-9 |
| **VIII — Update + restraint + multilingual** | a follow-up changes a real row (beam cost `BEAM-2026`, before/after); "pay Stefanos €4,450" → no payment (trace clean) + a payment-due record offered; a Greek follow-up updates a row | US-10,11,12 |
| **Edges** | idempotent re-ask doesn't clobber spaces; malformed inbound → 0 events; a failing automation surfaces its error; zero unrecovered eval/typecheck errors on THING's own turns | — |

### Performance targets
| Metric | Target |
|---|---|
| Ingest → THING plan | < 90 s |
| Whole build (spaces + app + seeded data) | < 15 min |
| `/app/home-renovation/` first byte | < 3 s |
| Research turn → researched row | < 3 min |
| Form POST → expense row + budget change | < 90 s |
| Over-threshold → alert row | < 2 min |
| Cron trigger → reconcile row | < 2 min |
| Later-update message → row changed | < 90 s |
| Eval/typecheck errors (unrecovered, on THING's own turns) | 0 |

---

## 7. What this scenario is really testing (and the gaps it closes/exposes)

This is the scenario that forces a **budget db-emitter → hook → agent alert** inside a real app, and
**vision** as a first-class ingest (a before/after gallery, not just file text). Three gaps are in play:

1. **db-emitter → agent deliverable (alert).** A DB change (an expense crossing a threshold) must wake
   an agent that **produces something** (an alert row naming the trade), not merely ping. US-6 is the
   headline test.
2. **Agent-processed form (the `ctx.spawn` gap).** `ctx.spawn` from an app API is a **known no-op**;
   the working path is a `db:insert` emitter → event hook with a `trigger`. US-5 asserts the working
   path and documents the gap.
3. **Mid-life self-evolution across physical phases.** No prior scenario adds a **new table + page** to
   an **already-built** app from a later turn. US-8 asserts the manifest grows after Act I — and here
   the evolution is phased (kitchen → bathroom → permits), the natural shape of a long project.

A recovered `typecheck_error`/`eval_error` inside a delegated specialist is the retry surface, not a
failure: hard-assert the **deliverable**, record recovered errors as a metric + note.

---

## 8. Running it

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                        # prove harness + prod healthy first
node ../09-home-renovation/run.mjs    # fresh; writes 09-home-renovation/results/report.md
node ../09-home-renovation/run.mjs --reuse # reuse the cached user + project
```

The runner provisions a disposable prod user, creates `home-renovation`, uploads `fixtures/reno-dump.md`
+ `fixtures/site-photo.png` (+ a voice memo if `fixtures/voice-memo.m4a` is present — audio is
otherwise skipped with a note), sends the compound message over the WS path, drives the research /
form / budget-alert / cron / evolution / inbound / follow-up beats, and checkpoints per Act to
`results/checkpoint.json`.

> **Vision/audio honesty:** the shipped `site-photo.png` is a minimal placeholder that exercises the
> image-upload + `system-vision` *delegate path* and attachment classification. To assert **OCR'd
> gallery/label rows from an image**, drop a real site photo at `fixtures/site-photo.png` (and a real
> `voice-memo.m4a` for audio transcription) before running. The runner asserts the path always, and
> the content assertion when a real artifact is present.

## Actual results

_Filled in by the runner — paste from `results/report.md` after a run._
