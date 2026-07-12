# Scenario 10 — Family recipe book → meal planner: a shoebox of cards becomes a kitchen that plans the week

> **One line.** Vasilis sends his mother's recipes — handwritten-card photos, clipped web recipes, and
> a voice memo — and asks THING for a recipe book by cuisine that **plans the week's meals and writes
> one merged shopping list** on its own every Sunday. This scenario exercises the full evolving-
> lifecycle template end to end and is backed by an executable live-prod runner
> (`10-family-recipes/run.mjs`).

**Persona.** Vasilis, cooks for a family of four, mixes Greek and English freely. His mother's and
grandmother's recipes live on handwritten cards and in voice memos and are slowly being lost. He has a
markdown dump of recipes, a photo of a handwritten recipe card, and a voice memo from his mother. He
wants a real book — organized by cuisine — and the weekly mental load of "what do we eat, what do I
buy" taken off his plate. He is not technical.

**Why this scenario exists.** The PROMISE under test is a **cron-driven agent synthesis that writes
derived rows**: every Sunday an agent reads the week's planned meals, computes a **de-duplicated
shopping list** (two recipes need peas → one line, 400g), and writes those rows — then pings the
family channel. No human asked for it that minute. Around that it wraps the full lifecycle with two
beats no other scenario leads with: **audio transcription → rows** and **handwritten (Greek) vision →
rows**. It also forces deep research into a cuisine's knowledge, an agent-processed form, a db-emitter
loop, mid-life self-evolution (a dietary restriction changes the plan; a dinner party scales it), and
an inbound channel. It closes/exposes the **`ctx.spawn`-from-app-API gap** and the **mid-life
table+page addition** gap.

---

## 1. The user flow (what the user actually does)

| # | Step (in the UI) | What the user does |
|---|---|---|
| 1 | **Create a project** | He clicks "New project" and names it **`family-recipes`**. |
| 2 | **Attach the dump** | He attaches `recipes.md` (the transcribed recipes), a **photo of a handwritten recipe card** (`recipe-card.png`), and — if he has one — a **voice memo** from his mother. |
| 3 | **Ask, once** | sends the compound message below (Greek, messy). |

> *"Σου στέλνω τις συνταγές της μάνας μου — φωτογραφίες χειρόγραφων, συνταγές από το ίντερνετ, και ένα
> ηχητικό. Φτιάξε μου βιβλίο ανά κουζίνα, και κάθε Κυριακή φτιάξε τα φαγητά της βδομάδας με μία ενιαία
> λίστα αγορών (χωρίς διπλότυπα)."*

| 4 | **Watch it build** | THING reads the file/photo/memo, creates per-cuisine spaces, and builds the recipe app. |
| 5 | **See it** | He opens **`/app/family-recipes/`**: a recipe book, a meal-plan, a shopping list — real data. |
| 6 | **Add a recipe** | From the app he submits a new recipe via a form; an agent normalizes it into a structured row. |
| 7 | **Let it plan** | A Sunday cron plans the week's meals and writes a merged shopping list, then pings the family channel. |
| 8 | **Life changes** | Weeks later: *"ο Νίκος είναι πλέον gluten-free"* → a dietary-needs section appears and the plan adapts. Then *"hosting a dinner for 8"* → an events section that scales recipes. |
| 9 | **Ping from the store** | He messages *"we're out of olive oil"* → it lands on the shopping list. |
| 10 | **Keep updating** | *"η μουσακάς θέλει 40 λεπτά ψήσιμο, όχι 45 (ref TIME-MOUS-40)"* → the row changes. And he tests a boundary: *"order the groceries from the supermarket"* → THING refuses and hands him the scaled list instead. |

---

## 2. What the user expects (the contract)

In the user's terms — success is:

1. **"It read my cards/memo."** THING cites *his* specifics (`Μουσακάς`, `μπεσαμέλ`, `gemista`,
   `αρακάς`, `κεφτέδες`, `γιαγιά Αθανάσια`, `crossini`), proving it read the file *and* the card/memo.
2. **"I can see the book."** `/app/family-recipes/` opens and shows recipes by cuisine, a meal plan,
   and a shopping list — a real dashboard.
3. **" It learned the cuisine."** Researching a technique/substitution produced a real finding NOT in
   his file — it landed in a cuisine space's knowledge *and* as a row.
4. **"The form worked."** He added a recipe through the app; an agent normalized it into a structured
   row, without him chatting.
5. **"It plans the week for me."** The Sunday cron planned meals **and** wrote a **de-duplicated
   shopping list** (two recipes sharing an ingredient → one merged line), then pinged the channel.
6. **"It heard me at the store."** The "we're out of olive oil" message landed on the shopping list.
7. **"It grew with our diet."** "Gluten-free" and "dinner for 8" each produced a **new section** — a
   new space *and* a new table *and* a new page on the already-running app.
8. **"I can keep updating it."** A later message changes a real row (bake time, before→after).
9. **"It knows what it can't do."** "Order the groceries" → it does **not** order; it narrows to the
   scaled list.
10. **"It understood me."** It works in Greek and English; the compound Greek opener produced all the
    halves.

**Anti-expectations (a failure even if the chat looks fine):**
- A nice summary but **no** spaces and **no** app → "it just answered me."
- An app that opens but is **empty** → "where are my recipes?"
- "Planned!" but **no** shopping-list rows → the synthesis didn't run.
- A shopping list with **duplicate** ingredient lines → it didn't merge.
- "Researched!" but **no** new row and **no** space knowledge → it didn't really research.
- "Noted!" on a follow-up with **no** DB change → "it didn't save it."
- "Ordered the groceries!" → overstep; it must NOT order.

---

## 3. What happens in the background (the choreography)

Hop by hop, for maintainers:

1. **Project creation (UI/API).** `POST /api/projects {name:"family-recipes"}`. THING runs inside it.
2. **Multi-modal upload.** `recipes.md` → `kind:'file'`; `recipe-card.png` → `kind:'image'` (handwritten
   card → `system-vision`, Greek OCR); a voice memo → `kind:'audio'` (transcription). Base64
   `POST /api/uploads`.
3. **The message carries all attachments over the WS path**; the HTTP `/message` route drops them.
4. **THING delegates the read.** File ids → **`system-files/dispatch`** (md → reader; handwritten image
   → `system-vision`; audio → transcription). Extracted facts (incl. from the card and memo) return to
   THING.
5. **THING plans and delegates the build.** (a) Per-cuisine **spaces** (`ελληνική`, `ιταλική`,
   `household-preferences`) via `build_specialist`, **live-registered**. (b)
   **`system-appbuilder/automator`** authors the live recipe app.
6. **The automator authors INTO the live project:** `writeProjectTable(name, schema, rows)` (seeds the
   recipes), `writeProjectApi`, `writeProjectPage` (a **recipe-book** + **meal-plan** +
   **shopping-list** page). `POST /app/family-recipes/build` compiles; `GET /app/family-recipes/`
   serves real HTML.
7. **Deep research (Act II).** "What's an authentic substitution / technique for X" routes to
   **`system-research/researcher`** (`webSearch`/`webFetch`). Findings land in the cuisine space's
   **knowledge** *and* as a `substitutions` row via `db.insert`, absent from the seed.
8. **Agent-processed form (Act III).** An "add recipe" **page form** → `POST
   /app/family-recipes/api/recipe-create` → `ctx.db.insert('recipes', …)`. That insert fires
   `project/db.recipes.insert` → an **event hook** with `trigger: '<space>/agent#normalize'` → an
   **agent turn** that normalizes the raw text into a structured row. **`ctx.spawn` from an app API is
   a known no-op**; the db-insert→hook path is the working one and what this asserts.
9. **Cron-driven synthesis → derived rows (Act IV).** A `cron` hook (`every:'7d'`, `trigger:
   '<space>/agent#weekly_plan'`) reads the recipe book, **plans the week**, computes a
   **de-duplicated shopping list** (shared ingredients merged with summed quantities), writes
   `shopping_list` rows, and pings the family channel; the runner triggers it via
   `pod.runEmitter`/`runHook`. This is the headline — an agent authoring **derived** rows on a schedule.
10. **Self-evolution (Act V).** "Ο Νίκος είναι gluten-free" adds a NEW `dietary-needs` space (GF
    knowledge) → tags/flags recipes and the meal-plan adapts. "Hosting a dinner for 8" adds a NEW
    `events` space + `event_menu` table + a **scaling page** — all on the **already-built** app; the
    manifest **grows** post-build.
11. **Inbound + outbound (Act VI).** `installSpace('integration-demo')` (keyless test source; a real
    Telegram/WhatsApp space in production) raises a **consent card** the user approves. A signed
    `POST /api/inbound/<path>` ("we're out of olive oil") → verify→emit → event hook → agent → a
    `shopping_list` row. The agent also posts the weekly plan to the family channel via
    **`callConnection`** (gated `connections:use`).
12. **Later updates + restraint (Act VII).** A follow-up uses `db.update` to fix the moussaka bake time
    (NEW token `TIME-MOUS-40`, before/after). "Order the groceries from the supermarket" → THING
    **refuses/narrows**: no ordering; it offers the scaled list.

Everything above is authored by the model into the user's own project — no engineer touches a file.

---

## 4. User stories

- **US-1 — Ingest multi-modal (incl. Greek card + voice).** *As a home cook, I want to send cards,
  files, and a voice memo.* **Accept:** `system-files`/`system-vision` delegated; ≥3 recipe-specific
  facts cited (incl. at least one only the card/memo carries).
- **US-2 — See the book.** *As a home cook, I want a real app.* **Accept:** app `built:true` with
  tables + ≥1 page; `/app/family-recipes/` → 200 HTML.
- **US-3 — My recipes are in it.** *As a home cook, I want my recipes stored by cuisine.* **Accept:**
  a recipes table holds the file's recipes, contents matching the file.
- **US-4 — It learns the cuisine.** *As a home cook, I want substitutions/techniques researched.*
  **Accept:** `system-research` delegated, `webSearch`/`webFetch` observed; a researched row absent
  from the seed lands in `substitutions` + a cuisine space's knowledge.
- **US-5 — The form is alive.** *As a home cook, I want to add a recipe through the app.* **Accept:**
  a `POST` to the form API fires an agent turn and a normalized recipe row lands (before/after with a
  NEW token).
- **US-6 — It plans the week.** *As a home cook, I want Sunday's plan + one merged shopping list.*
  **Accept:** triggering the cron emitter writes `meal_plan` rows **and** a **de-duplicated**
  `shopping_list` (no duplicate ingredient lines; shared ingredients merged), then a channel ping.
- **US-7 — It hears me at the store.** *As a home cook, I want to ping the list from a channel.*
  **Accept:** install consent approved; a signed inbound webhook → agent → a `shopping_list` row.
- **US-8 — It grows with our diet.** *As a home cook, I want new needs to add sections.* **Accept:**
  "gluten-free" and "dinner for 8" each add a NEW space + NEW table + NEW page to the running app
  (manifest grows after the initial build).
- **US-9 — Keep it current.** *As a home cook, I want to update it by just telling it.* **Accept:** a
  follow-up changes a real row (bake time, before/after).
- **US-10 — It knows its limits.** *As a home cook, I want it to not order for me.* **Accept:** "order
  the groceries" → no ordering (trace clean); the scaled list offered.
- **US-11 — Understand me.** *As a cook who mixes Greek/English, I want it to work in either.*
  **Accept:** a Greek follow-up updates a row; the compound Greek opener produced all halves.

---

## 5. Feature coverage (tick what this scenario exercises)

- THING routing: [x] answer [x] research [x] build space [x] app-4a (automator) [ ] app-4b (build_app)
  [ ] code (engineer) [ ] memory [x] install+automate [x] compound request [x] provided-info shortcut
  [x] restraint/refusal [x] multilingual
- Spaces: [x] create per-part [x] live-registered/delegatable [x] no-clobber re-add
- Event pipeline: [x] webhook (inbound) [x] cron [x] db (recipes.insert) [ ] internal ·
  [x] code-handler hook [x] agent-trigger hook · [ ] code nodes [ ] forEach · [x] project functions ·
  [x] loop guard [x] payload validation [x] emitEvent
- Consent/caps: [x] @consent [x] installSpace approve [x] fail-closed headless
  [x] capability gating (`db:write`, `events:emit`, `connections:use`, `store:install`)
- Store/integrations: [x] discovery [x] install a space [x] callConnection [x] inbound webhook
  [x] integration-demo source (keyless; telegram is the prod target)
- Project-app: [x] writeProjectTable(+rows seed) [x] writeProjectPage/Api [x] db:write later-update
  [x] app build [x] /app/<id>/ serving [x] app data API [x] **mid-life table+page addition**
- Attachments: [x] upload [x] readDocument [x] attachmentIds to a specialist [x] **vision (handwritten Greek)** / **audio**
- Pod lifecycle: [ ] restart→auto-resume (covered by 05) [x] cold-wake [ ] event storm [x] worker containment (api handler)
- Cross-cutting: [x] edge cases/errors [x] performance [x] budget (direct Azure keys)

---

## 6. Acceptance criteria (the Acts)

The runner (`10-family-recipes/run.mjs`) drives these and asserts on the **trace + real pod state**.
Acts here match the runner 1:1.

| Act | Asserts (trace + real state) | Stories |
|---|---|---|
| **I — Ingest & build** | `system-files`/`system-vision` delegated; ≥3 recipe facts cited; ≥2 per-cuisine spaces; app `built:true` with tables + ≥1 page; `/app/family-recipes/` → 200 HTML; a recipes table seeded with file rows (content tokens match) | US-1,2,3,11 |
| **II — Deep research → knowledge + DB** | `system-research` delegated + `webSearch`/`webFetch` observed; a researched substitution **absent from the seed** lands as a row in `substitutions`; a cuisine space answers a follow-up from researched knowledge | US-4 |
| **III — Agent-processed form** | a `POST` to `/app/family-recipes/api/<form>` returns ≥202; an **agent turn fires** (via `db.insert`→emitter→hook, not `ctx.spawn`); a normalized recipe row with a NEW token lands (before/after) | US-5 |
| **IV — Cron synthesis → derived rows** | a `cron` hook exists; `runEmitter`/`runHook` produces an agent turn that writes `meal_plan` rows **and** a **de-duplicated** `shopping_list` (shared ingredients merged — no duplicate ingredient lines); a channel ping (callConnection yield) observed | US-6 |
| **V — Self-evolution** | "gluten-free" + "dinner for 8" each add a NEW space (live-registered) **and** the app manifest gains ≥1 NEW table and ≥1 NEW page beyond Act I's manifest (mid-life growth) | US-8 |
| **VI — Inbound + outbound** | `installSpace` consent approved; a signed inbound webhook → `{events ≥1}` (bad signature → 401/0 events); an agent/hook writes a `shopping_list` row (before/after); a `callConnection` yield observed | US-7 |
| **VII — Update + restraint + multilingual** | a Greek follow-up changes a real row (bake time `TIME-MOUS-40`, before/after); "order the groceries" → no ordering (trace clean) + the scaled list offered | US-9,10,11 |
| **Edges** | idempotent re-ask doesn't clobber spaces; malformed inbound → 0 events; a failing automation surfaces its error; zero unrecovered eval/typecheck errors on THING's own turns | — |

### Performance targets
| Metric | Target |
|---|---|
| Ingest → THING plan | < 90 s |
| Whole build (spaces + app + seeded data) | < 15 min |
| `/app/family-recipes/` first byte | < 3 s |
| Research turn → substitution row | < 3 min |
| Form POST → recipe row | < 90 s |
| Cron trigger → meal_plan + shopping_list rows | < 3 min |
| Later-update message → row changed | < 90 s |
| Eval/typecheck errors (unrecovered, on THING's own turns) | 0 |

---

## 7. What this scenario is really testing (and the gaps it closes/exposes)

This is the scenario that forces a **cron-driven agent synthesis writing derived rows** — the clearest
"it does the weekly thinking for me" claim — and the only one that leads with **audio → rows** and
**handwritten (Greek) vision → rows**. Three gaps are in play:

1. **Cron → agent synthesis → derived rows.** A scheduled emitter must wake an agent that **reads the
   book, plans, and authors new rows** (a de-duplicated shopping list), not merely ping. US-6 is the
   headline; the de-duplication makes it a real synthesis, not a copy.
2. **Agent-processed form (the `ctx.spawn` gap).** `ctx.spawn` from an app API is a **known no-op**;
   the working path is a `db:insert` emitter → event hook with a `trigger`. US-5 asserts the working
   path and documents the gap.
3. **Mid-life self-evolution.** No prior scenario adds a **new table + page** to an **already-built**
   app from a later turn. US-8 asserts the manifest grows after Act I — here driven by a dietary
   change and an event, the natural shape of a living kitchen.

Also: **audio transcription** and **handwritten Greek OCR** are exercised for the first time — the
runner proves the path always, and the content assertion when a real voice memo / real card photo is
present.

A recovered `typecheck_error`/`eval_error` inside a delegated specialist is the retry surface, not a
failure: hard-assert the **deliverable**, record recovered errors as a metric + note.

---

## 8. Running it

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                         # prove harness + prod healthy first
node ../10-family-recipes/run.mjs      # fresh; writes 10-family-recipes/results/report.md
node ../10-family-recipes/run.mjs --reuse # reuse the cached user + project
```

The runner provisions a disposable prod user, creates `family-recipes`, uploads `fixtures/recipes.md`
+ `fixtures/recipe-card.png` (+ a voice memo if `fixtures/voice-memo.m4a` is present — audio is
otherwise skipped with a note), sends the compound Greek message over the WS path, drives the research
/ form / cron-plan / evolution / inbound / follow-up beats, and checkpoints per Act to
`results/checkpoint.json`.

> **Vision/audio honesty:** the shipped `recipe-card.png` is a minimal placeholder that exercises the
> image-upload + `system-vision` *delegate path* and attachment classification. To assert **handwritten
> Greek OCR → rows** and **audio transcription → rows**, drop a real photo of a handwritten recipe
> card at `fixtures/recipe-card.png` (and a real `voice-memo.m4a`) before running. The runner asserts
> the path always, and the content assertion when a real artifact is present.

## Actual results

_Filled in by the runner — paste from `results/report.md` after a run._
