# Scenario 10 — Family recipe book → meal planner: a shoebox of cards becomes a kitchen that plans the week

> **One line.** Vasilis sends his mother's recipes — a markdown dump, a pantry **spreadsheet**,
> handwritten-card and plated-dish **photos**, a clipped **PDF**, and a **Greek voice memo** — and asks
> THING for a recipe book by cuisine that **plans the week's meals and writes
> one merged shopping list** on its own every Sunday. This scenario exercises the full evolving-
> lifecycle template end to end and is backed by an executable live-prod runner
> (`10-family-recipes/run.mjs`).

**Persona.** Vasilis, cooks for a family of four, mixes Greek and English freely. His mother's and
grandmother's recipes live on handwritten cards and in voice memos and are slowly being lost. What he
actually has is a shoebox in six formats: a markdown dump of recipes, an **Excel workbook** of the
pantry + a half-started week plan, a **photo of a handwritten recipe card**, a **photo of the finished
dish**, a **recipe PDF** clipped from the web, and a **voice memo from his mother, in Greek** — plus a
couple of **links** he wants read. He wants a real book — organized by cuisine — and the weekly mental
load of "what do we eat, what do I buy" taken off his plate. He is not technical.

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
| 2 | **Attach the dump** | He attaches **everything he has, in one go**: `recipes.md` (the transcribed recipes), an **Excel workbook** of what's in the pantry and a half-started plan (`pantry-and-plan.xlsx`), a **photo of a handwritten recipe card** (`recipe-card.jpg`), a **photo of the dish as it should look on the plate** (`dish-photo.jpg`), a **printable recipe PDF** clipped from the web (`recipe.pdf`), and a **voice memo from his mother, in Greek** (`voice-memo.mp3`) — plus he pastes **two or three links** (`links.md`) he wants it to read. |
| 3 | **Ask, once** | sends the compound message below (Greek, messy). |

> *"Σου στέλνω τις συνταγές της μάνας μου — το excel με το τι έχω στο ντουλάπι και τι σκέφτηκα για τη
> βδομάδα, φωτογραφίες χειρόγραφων καρτών, μια φωτογραφία από το πιάτο όπως πρέπει να βγαίνει, ένα pdf
> από το ίντερνετ, και **ένα ηχητικό της μάνας μου — άκουσέ το, λέει τη σπανακόπιτα**. Σου βάζω και δυο
> λινκ, διάβασέ τα. Φτιάξε μου βιβλίο ανά κουζίνα, βάλε μέσα και ό,τι λέει το ηχητικό και το excel, και
> κάθε Κυριακή φτιάξε τα φαγητά της βδομάδας με μία ενιαία λίστα αγορών (χωρίς διπλότυπα)."*

| 4 | **Watch it build** | THING reads the file/photo/memo, creates per-cuisine spaces, and builds the recipe app. |
| 5 | **See it** | He opens **`/app/family-recipes/`**: a recipe book, a meal-plan, a shopping list — real data. |
| 6 | **Add a recipe** | From the app he submits a new recipe via a form; an agent normalizes it into a structured row. |
| 7 | **Let it plan** | A Sunday cron plans the week's meals and writes a merged shopping list, then pings the family channel. |
| 8 | **Life changes** | Weeks later: *"ο Νίκος είναι πλέον gluten-free"* → a dietary-needs section appears and the plan adapts. Then *"hosting a dinner for 8"* → an events section that scales recipes. |
| 9 | **Ping from the store** | He messages *"we're out of olive oil"* → it lands on the shopping list. |
| 10 | **Keep updating** | *"η μουσακάς θέλει 40 λεπτά ψήσιμο, όχι 45 (ref TIME-MOUS-40)"* → the row changes. And he tests a boundary: *"order the groceries from the supermarket"* → THING refuses and hands him the scaled list instead. |
| 11 | **Tell it the household rules** | *"Θυμήσου το αυτό για πάντα: τα παιδιά δεν αντέχουν τον δυόσμο… ο Νίκος τρώει μόνο ψητές μελιτζάνες"* → it remembers, and recalls it unprompted days later when he cooks. |
| 12 | **Change his mind mid-install** | He asks for Telegram too — then, at the consent card, **says no**. Nothing is installed. |
| 13 | **"The maths is wrong"** | *"400γρ αρακά" vs "1 φλιτζάνι αρακά" count as different things* → he asks for real unit-aware code; an engineer writes it into the app. |
| 14 | **Live in the app** | He stops going back to `/chat`. From the **chat dock inside the app** — on every page — he asks: *"βάλε ένα πεδίο «αγαπημένο» στις συνταγές και φτιάξε μια σελίδα «Αγαπημένα» … σημείωσε τον μουσακά και τη σπανακόπιτα"*. The field, the page and the flagged rows appear **in the running app**, without leaving it. |

---

## 2. What the user expects (the contract)

In the user's terms — success is:

1. **"It read my cards/memo/excel."** THING cites *his* specifics (`Μουσακάς`, `μπεσαμέλ`, `gemista`,
   `αρακάς`, `κεφτέδες`, `γιαγιά Αθανάσια`, `crossini`) — **and** the things only ONE of the six files
   knows: the card's `Orange Cake`, the PDF's `Easy Lasagna`, the workbook's `GF-NIKOS` + low olive
   oil, the photo's plating, and — the one that proves it **listened** — his mother's
   **`Σπανακόπιτα`** with `750γρ σπανάκι` and the `μαστίχα Χίου`.
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
11. **"It remembers the house rules."** A "remember this forever" turn is recalled days later,
    unprompted, when he cooks the dish it applies to.
12. **"No means no."** When he denies the install consent card, **nothing is installed** — and it says so.
13. **"It can write real code."** "The list's maths is wrong" produces actual unit-aware code in the
    app, not an apology.
14. **"The app is alive."** The recipe book is not a read-only dashboard: an assistant is there **on
    every page**, and what he asks it for — a new field, a new page, a flag on a recipe — **appears in
    the app he is standing in**. He never has to go back to `/chat` to change his own kitchen.

**Anti-expectations (a failure even if the chat looks fine):**
- The app opens but the tiles read **`0` / empty** while the data is really in the DB → the page's own
  API route is 500ing and the UI is silently falling back to zeros. **The layer the user sees is the
  layer that must be asserted.**
- The "in-app chat" is a **link back to `/chat`**, or reaches an agent that cannot author → the app is
  a dead end, not a living surface.
- The book has the recipes from the *text* files but **no `Σπανακόπιτα`** → "it never listened to my
  mother's memo."
- Nothing from the **workbook** (`GF-NIKOS`, the low olive oil, `WEEK-2026-W29`) → "it ignored my excel."
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
2. **Multi-modal upload — SIX real fixtures + a live-web beat.** Every one is a genuine file in
   `10-family-recipes/fixtures/`; each is base64'd to `POST /api/uploads` with the `kind` below, and the
   runner **must attach all six** on the opening message. This is the fixture set the scenario is built
   from — see the table in §8 for the unique fact each one carries.

   | Fixture | `kind` | Path through the pod |
   |---|---|---|
   | `recipes.md` | `file` | `system-files/dispatch` → the markdown reader (the seed recipe dump) |
   | `pantry-and-plan.xlsx` | `file` | `system-files/dispatch` → **`readDocument`** (a REAL 3-sheet workbook: `Pantry` / `MealPlan` / `ShoppingList`) → pantry + draft-plan + GF rows |
   | `recipe-card.jpg` | **`image`** | `system-files/dispatch` → **`system-vision`** (handwritten cursive OCR — an *Orange Cake* card) |
   | `dish-photo.jpg` | **`image`** | `system-files/dispatch` → **`system-vision`** (a real plated Greek dish — a **second, visually different** vision call: a photographed plate, not a document) |
   | `recipe.pdf` | `file` | `system-files/dispatch` → **`readDocument`** (a real printable *Easy Lasagna*, selectable text) |
   | `voice-memo.mp3` | **`audio`** | `system-files/dispatch` → **Whisper transcription (GREEK)** → the mother's dictated *Σπανακόπιτα*, a recipe that exists in **no other fixture** |
   | `links.md` | *(pasted URLs, not an upload)* | the Act II research beat: `system-research/researcher` → live **`webSearch`/`webFetch`** on the three real URLs |

3. **The message carries all attachments over the WS path**; the HTTP `/message` route drops them.
4. **THING delegates the read.** File ids → **`system-files/dispatch`**, which fans out by kind: md →
   reader; xlsx/pdf → `readDocument`; the two photos → `system-vision` (one handwritten card, one plated
   dish); the mp3 → **Whisper, transcribed from Greek**. Extracted facts (incl. the card's, the
   workbook's, and — critically — the memo's Greek-only recipe) return to THING and must reach real rows.
5. **THING plans and delegates the build.** (a) Per-cuisine **spaces** (`ελληνική`, `ιταλική`,
   `household-preferences`) via `build_specialist`, **live-registered**. (b)
   **`system-appbuilder/automator`** authors the live recipe app.
6. **The automator authors INTO the live project:** `writeProjectTable(name, schema, rows)` (seeds the
   recipes), `writeProjectApi`, `writeProjectPage` (a **recipe-book** + **meal-plan** +
   **shopping-list** page). `POST /app/family-recipes/build` compiles; `GET /app/family-recipes/`
   serves real HTML.
7. **Deep research (Act II).** "What's an authentic substitution / technique for X — διάβασε και τα
   λινκ" routes to **`system-research/researcher`** (`webSearch`/`webFetch`) and fetches the **three
   real URLs in `fixtures/links.md`** (el.wikipedia *Μουσακάς*, *Béchamel sauce*, *Gluten-free diet* —
   each verified `200`). Findings land in the cuisine space's **knowledge** *and* as a `substitutions`
   row via `db.insert`, absent from the seed (the natural one: a **gluten-free roux** — rice
   flour/starch instead of wheat flour in the μπεσαμέλ, which is what unblocks Nikos in Act V).
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
  files, a spreadsheet, photos and a voice memo — all at once.* **Accept:** `system-files` /
  `system-vision` / transcription delegated; ≥3 recipe-specific facts cited, **and one fact from EACH
  of the six fixtures** — including at least one that ONLY the **Greek voice memo** carries
  (`Σπανακόπιτα` / `750γρ σπανάκι` / `μαστίχα Χίου`) and one that ONLY the **workbook** carries
  (`GF-NIKOS` / `BUDGET-CAP-78.50` / `PNT-001` olive-oil-LOW).
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
- **US-12 — Remember the house rules.** *As a home cook, I want to tell it a family preference once.*
  **Accept:** the turn routes to `user-memory` (delegate/remember yield); a LATER, unrelated cooking
  question recalls both preferences (half mint; roasted, never fried).
- **US-13 — No means no.** *As a home cook, I want to be able to refuse an install.* **Accept:** the
  install raises a consent card; **denied** ⇒ the space is absent from the project's spaces on disk,
  the other spaces survive, and THING says it did not install it.
- **US-14 — Write me real code.** *As a home cook, I want the arithmetic actually fixed.* **Accept:**
  the ask routes to `system-engineer`; the authored unit-aware merge helper lands as a REAL file in
  the project; the app still compiles and the list is still de-duplicated.
- **US-15 — Change my kitchen from inside my kitchen.** *As a home cook, I want to evolve the app from
  within the app, not from a separate chat window.* **Accept:** the app ships an in-app THING dock in
  `pages/_layout` (⇒ present on **every** route by construction); a message sent through it AUTHORS
  (a `writeProject*` yield, not a promise) and a **new page/table lands live** with the favourite flag
  **set on real rows**; the app still compiles; and the app's **own** API routes answer **200 with real
  data** — asserted in a real browser (render + dock + no console/network errors).

---

## 5. Feature coverage (tick what this scenario exercises)

- THING routing: [x] answer [x] research [x] build space [x] app-4a (automator) [ ] app-4b (build_app)
  [x] code (engineer — Act X) [x] memory (Act VIII) [x] install+automate [x] compound request
  [x] provided-info shortcut [x] restraint/refusal [x] multilingual
- Spaces: [x] create per-part [x] live-registered/delegatable [x] no-clobber re-add
- Event pipeline: [x] webhook (inbound) [x] cron [x] db (recipes.insert) [ ] internal ·
  [x] code-handler hook [x] agent-trigger hook · [ ] code nodes [ ] forEach · [x] project functions ·
  [x] loop guard [x] payload validation [x] emitEvent
- Consent/caps: [x] @consent [x] installSpace approve [x] **installSpace DENY (Act IX)**
  [x] fail-closed headless
  [x] capability gating (`db:write`, `events:emit`, `connections:use`, `store:install`)
- Store/integrations: [x] discovery [x] install a space [x] callConnection [x] inbound webhook
  [x] integration-demo source (keyless; telegram is the prod target)
- Project-app: [x] writeProjectTable(+rows seed) [x] writeProjectPage/Api [x] db:write later-update
  [x] app build [x] /app/<id>/ serving [x] app data API [x] **mid-life table+page addition**
  [x] **the app's OWN api routes (Act XI/A2a)** [x] **always-available in-app THING dock + self-evolution
  from inside the app (Act XI/A1)** [x] **browser render verification (Act XI/A2b)**
- Attachments: [x] upload (6 fixtures on one message) [x] **readDocument (the recipe PDF *and* a REAL
  3-sheet .xlsx workbook)** [x] attachmentIds to a specialist [x] **vision ×2 (a real handwritten
  recipe card + a real plated-dish photo)** · [x] **audio (a REAL Greek voice memo → Whisper
  transcription → rows — see §8)** · [x] **live web (3 real 200-OK links)**
- Pod lifecycle: [ ] restart→auto-resume (covered by 05) [x] cold-wake [ ] event storm [x] worker containment (api handler)
- Cross-cutting: [x] edge cases/errors [x] performance [x] budget (direct Azure keys)

---

## 6. Acceptance criteria (the Acts)

The runner (`10-family-recipes/run.mjs`) drives these and asserts on the **trace + real pod state**.
Acts here match the runner 1:1.

| Act | Asserts (trace + real state) | Stories |
|---|---|---|
| **I — Ingest & build** | all **six** fixtures uploaded on ONE message; `system-files`/`system-vision`/transcription delegated; ≥3 recipe facts cited **+ ≥1 fact only the handwritten card carries** (vision→content) **+ ≥1 fact only the PDF carries** (`readDocument`) **+ ≥1 fact only the .xlsx carries** (`readDocument`→spreadsheet) **+ ≥1 fact only the dish photo carries** (2nd vision call) **+ ≥1 fact only the GREEK voice memo carries** (audio→Whisper); ≥2 per-cuisine spaces; app `built:true` with tables + ≥1 page; `/app/family-recipes/` → 200 HTML; a recipes table with ≥4 rows whose content tokens match the file — **and a row for the memo's `Σπανακόπιτα`**, which exists in NO uploaded text (audio → rows) | US-1,2,3,11 |
| **II — Deep research → knowledge + DB** | `system-research` delegated + `webSearch`/`webFetch` observed **on the three real URLs in `fixtures/links.md`** (each pre-verified 200); a researched substitution **absent from the seed** lands as a row in `substitutions` (the GF roux: rice flour/starch, not wheat); a cuisine space answers a follow-up from researched knowledge | US-4 |
| **III — Agent-processed form** | the app has an "add recipe" form endpoint **and** a `db`-INSERT hook (the working path — **not** `ctx.spawn`); filing a raw recipe through the intake fires an **agent turn** that lands a **normalized** recipe row (ingredients broken out) with a NEW token — recipe count grows (before/after) | US-5 |
| **IV — Cron synthesis → derived rows** | a `cron` hook exists; `runHook` produces an agent turn that writes `meal_plan` rows **and** a **de-duplicated** `shopping_list` (shared ingredients merged — **no duplicate ingredient lines**) | US-6 |
| **V — Self-evolution** | "gluten-free" + "dinner for 8" each add a NEW space (live-registered) **and** the app manifest gains ≥1 NEW table and ≥1 NEW page beyond Act I's manifest (mid-life growth); the grown app still compiles | US-8 |
| **VI — Inbound + outbound** | `installSpace` consent approved; a signed inbound webhook → `{events ≥1}` (bad signature → 401/0 events); an agent/hook writes a `shopping_list` row for the olive oil (before/after); posting the week's plan to the channel yields **`callConnection`** | US-7 |
| **VII — Update + restraint + multilingual** | a Greek follow-up **changes a real row** (moussaka bake 45→40, ref `TIME-MOUS-40`, before/after); "order the groceries" → **no order/pay yield in the trace** + the list handed back instead | US-9,10,11 |
| **VIII — Remember me** (NEW, r1) | a "remember forever" household rule routes to **`user-memory`** (delegate / remember yield); a LATER, unrelated cooking turn **recalls both preferences** (half mint; roasted not fried) | US-12 |
| **IX — Consent denied** (NEW, r1) | asking for a 2nd integration raises a consent card; **denied** ⇒ `integration-telegram` is **absent from the project's spaces on disk**, the other spaces survive, and THING says it did not install it (**consent fails closed**) | US-13 |
| **X — Engineer-authored code** (NEW, r1) | "the list's maths is wrong" routes to **`system-engineer`**; the authored unit-aware merge helper lands as a **REAL file** in the project (fs tree grew); the app still compiles and a re-run of the weekly cron still de-duplicates (no regression) | US-14 |
| **XI — The app is a living surface** (NEW, r1 · the app contract A1+A2) | **A1:** the app ships an in-app THING dock in **`pages/_layout`** (⇒ on every route by construction, not page-by-page); a message sent through the dock's own session shape (`{agentSlug:'thing', projectId}`) **AUTHORS** (`writeProject*` yield) and a **NEW page/table lands live** that did not exist before, with the favourite flag **set on real rows** (μουσακάς/σπανακόπιτα); the app **still compiles** after. **A2a:** every one of the app's **OWN** API routes (`/<project>/api/<route>`, the ones its pages fetch) answers **200** with a **non-empty** payload — no silent 500 → zero-fallback. **A2b:** the app is opened in a **real browser** (chrome-devtools): real fixture data on screen, the dock present, **no console errors, no failed fetches** (evidence + screenshot in §Actual results) | US-15 |
| **Edges** | idempotent re-ask doesn't clobber spaces; malformed inbound → 0 events; unknown inbound path → 404; recovered vs unrecovered eval/typecheck errors recorded | — |

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
| Remember → recall (Act VIII) | < 60 s per turn |
| Engineer code → file in the project (Act X) | < 5 min |
| In-app dock message → change live in the app (Act XI) | < 5 min |
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

Also: **handwritten OCR → rows** is exercised for the first time with a real card photo — the runner
hard-asserts a fact **only the photo carries** ("Orange Cake"/crisco/raisins), so a vision path that
silently no-ops cannot pass. And **audio → rows** is now backed by a REAL fixture: `voice-memo.mp3` is
~36s of **spoken Greek** in the mother's voice dictating a *Σπανακόπιτα* that appears in **no other
fixture and no uploaded text** — so the only way a `Σπανακόπιτα` row (750γρ σπανάκι, μαστίχα Χίου) can
exist is if the pod really transcribed Greek audio. That makes this the first scenario where
**audio → transcription → structured rows** is hard-asserted rather than skipped. The six fixtures are
mutually exclusive by design (§8): every one carries a token no other one has, so **no fixture's read
can be faked from another's content.**

The round-1 NEW Acts add three catalog capabilities this scenario did not reach: **memory** (VIII),
the **denial** half of consent — the half that must fail closed (IX) — and the **engineer** writing
real code into a living app (X).

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

The runner provisions a disposable prod user, creates `family-recipes`, uploads **all six fixtures on
the one opening message** (over the WS path — the HTTP `/message` route drops attachments), pastes the
`links.md` URLs on the research turn, drives the research / form / cron-plan / evolution / inbound /
follow-up beats, and checkpoints per Act to `results/checkpoint.json`.

### The fixtures (every one is REAL — and every one carries a token no other one has)

| Fixture | What it is | `kind` | **Unique assertable fact** (a runner assertion must prove THIS landed in real state) |
|---|---|---|---|
| `fixtures/recipes.md` | the transcribed recipe dump, Greek+English (4.6 KB) | `file` | `Μουσακάς` · `μπεσαμέλ` · `gemista` · `αρακάς` · `κεφτέδες` · **`γιαγιά Αθανάσια`** · `crossini` — the seed tokens (do not edit without updating the runner's `FILE_FACTS`) |
| `fixtures/pantry-and-plan.xlsx` | a REAL 3-sheet Excel workbook (10.6 KB; `Pantry` = 20 stock rows + a stock-take row · `MealPlan` = 14 rows across two weeks · `ShoppingList` = 15 rows + 2 note rows), 8 Greek+English columns each, quantities + units | `file` → `readDocument` | **`GF-NIKOS`** (Nikos is gluten-free — the dietary note that drives Act V) · **`BUDGET-CAP-78.50`** (weekly € cap) · **`PANTRY-REV-2026-07-12`** (stock-take id) · **`WEEK-2026-W29`** (the draft plan's week code) · **`MERGE-PEAS-400`** (2 recipes → one 400 g peas line — the de-dup beat, pre-stated) · `PNT-001` **Ελαιόλαδο Καλαμάτας 0.4 L = LOW** (sets up the "we're out of olive oil" inbound beat) · **`Παστίτσιο`** and **`Ψάρι πλακί`**, dishes in NO other fixture |
| `fixtures/recipe-card.jpg` | a REAL photo of a **handwritten** (cursive English) recipe card, 1021×617, 205 KB | **`image`** → `system-vision` | **`Orange Cake`** · **`crisco`** · **`1 cup raisins`** · `sour cream` · **`Angel food cake tin`** · **`400° for 40 min`** — handwriting, OCR-only; in no text fixture |
| `fixtures/dish-photo.jpg` | a REAL photo of a **plated Greek dish** — a slice of moussaka served with a Greek salad and a bulgur side, on a white plate on a wooden table (1280×960, 213 KB). Wikimedia Commons, **CC0** | **`image`** → `system-vision` | the **plating/serving** facts, which exist in NO other fixture: it is **served as a plated slice**, garnished with **chopped parsley**, alongside a **Greek salad (feta + a whole kalamata olive + cucumber + red onion)** and a **bulgur/tabbouleh side**, cutlery on a napkin. A 2nd, visually unlike vision call — a photographed *plate*, not a document, so an OCR-shaped shortcut cannot answer it |
| `fixtures/recipe.pdf` | a REAL printable recipe PDF with selectable text (52 KB) | `file` → `readDocument` | **`Easy Lasagna`** · **`Cooking with Extension Cookbook, pg. 22`** · **`12 oz. cottage cheese`** · **`slow cooker … Low for about 6 hours`** — in no other fixture |
| `fixtures/voice-memo.mp3` | **REAL Greek speech**, ~36 s, mono 24 kHz (695 KB) — the **mother dictating a family recipe**, first person. Generated with Azure TTS (`tts` deployment, voice `shimmer`); the exact spoken script is in **`fixtures/voice-memo.txt`** | **`audio`** → Whisper (Greek) | **`Σπανακόπιτα`** — a recipe that exists in **NO other fixture and no uploaded text** · **`750 γραμμάρια σπανάκι`** · **`320 γραμμάρια φέτα`** · the unusual ingredient **`μαστίχα Χίου`** · the family tip **`μια κουταλιά τσίπουρο στο φύλλο`** (for crisp phyllo) · **`θεία Δέσποινα από τη Λευκάδα`** · **`190 βαθμούς, 55 λεπτά`** · "**ποτέ αυγό στη γέμιση**". A `Σπανακόπιτα` row can ONLY exist if Greek audio was really transcribed |
| `fixtures/links.md` | **3 real, publicly fetchable URLs** (each verified `200`): el.wikipedia *Μουσακάς* · en.wikipedia *Béchamel sauce* · en.wikipedia *Gluten-free diet* | *(pasted URLs)* → `webFetch`/`webSearch` | a **live-web** finding **absent from `recipes.md`** — canonically the **gluten-free roux** (rice flour/starch instead of wheat flour in the μπεσαμέλ) — must land in `substitutions` **and** a cuisine space's knowledge |

> **Round-trip verified.** The mp3's Greek facts survive Whisper (`750 γραμμάρια σπανάκι`,
> `320 γραμμάρια φέτα`, `μαστίχα χίου`, `τσίπουρο`, `190 βαθμούς, 55 λεπτά` all come back verbatim), the
> `.xlsx` re-opens in openpyxl, every link returns 200, and `file` reports JPEG / MPEG-III / *Microsoft
> Excel 2007+* respectively. `fixtures/recipe-card.png` is a leftover 1×1 placeholder — **superseded by
> `recipe-card.jpg`; do not upload it.**
>
> **One honest gap remains:** the handwritten card is cursive **English**, so "handwritten **Greek** OCR"
> is still not backed by an image; Greek is instead exercised in the *voice memo* (real Greek speech →
> Whisper), throughout the *conversation*, and in the *workbook*'s Greek columns.

## Actual results

_Filled in by the runner — paste from `results/report.md` after a run._
