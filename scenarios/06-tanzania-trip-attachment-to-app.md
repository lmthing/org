# Scenario 06 — Tanzania trip: a file attachment becomes spaces + a live, updatable app

> **One line.** A traveler drops one dense trip-notes file into a fresh project and, in a single
> sentence, asks THING to turn it into per-leg spaces *and* a real app whose database he can keep
> updating. This scenario documents that flow end to end — what the user does, what he expects, what
> the system does behind the scenes, and the user stories it must satisfy — and is backed by an
> executable live-prod runner (`06-tanzania/run.mjs`).

---

## 1. The user flow (what the user actually does)

The persona is **Vasilis**, who has a fully-booked August 2026 trip: Cairo → Arusha & the northern
Tanzania safari circuit → Zanzibar → Dar es Salaam. Everything (flights, hotels, the safari, one
dining reservation, visa rules, local tips) lives in a single markdown file,
`tanzaniamemories.md`.

| # | Step (in the UI) | What the user does |
|---|---|---|
| 1 | **Create a project** | In Studio/Chat he clicks "New project" and names it **`tanzania-trip`**. (Project *creation* is a deliberate UI action — not something he asks THING to do.) |
| 2 | **Attach the file** | Inside the new project's THING chat, he attaches `tanzaniamemories.md` (the paperclip / drag-drop). |
| 3 | **Ask, once** | He sends a single, compound, slightly-messy instruction: |

> *"I am planning a trip to cairo and tanzania. I have attached all the info. Create multiple spaces
> for the different parts of the trip and move all this info an application that you can later update
> on the db based on the info I give you"*

| 4 | **Watch it build** | THING reads the file, creates the spaces, and builds the app — the user sees progress in the chat (delegations, "created space …", "built the app"). |
| 5 | **Open the app** | He opens **`/app/tanzania-trip/`** on his phone and sees his flights, accommodations, safari and dining as real, browsable data. |
| 6 | **Keep updating it** | Days later he sends follow-ups — *"the safari balance is $960, due in cash on arrival"*, *"note that Zanzibar needs a local driving permit"*, or the same in Greek — and the app's database changes to match. |

That is the whole product promise in one request: **a document becomes a living, updatable app,
organized the way the trip actually is.**

---

## 2. What the user expects (the contract)

The user does not care about spaces vs. tables vs. emitters. From his point of view, success is:

1. **"It read my file."** THING clearly used the attached info — it refers to *his* specifics
   (flight `A3932`, *Suricata Safaris*, *The Rock Restaurant*, *Ngorongoro*), not generic travel
   advice. A reply that ignores the attachment is a failure even if it sounds helpful.
2. **"It organized the trip the way I think about it."** There is a **separate space per leg** —
   Cairo, the Arusha safari, Zanzibar, Dar es Salaam — each knowing that leg's details, so when he
   later asks *"what's my dinner reservation in Zanzibar?"* the right part answers with *The Rock,
   Aug 15*.
3. **"It's a real app, not a chat summary."** `/app/tanzania-trip/` opens on his phone and shows his
   trip — pages with his flights, hotels, safari, dining — not an empty shell, not a paragraph.
4. **"My info is actually in there."** The app's database holds his real rows: the 6 flight legs, the
   8 accommodations, the safari, the dining reservation — queryable, not just prose.
5. **"I can keep updating it."** A later message changes the data. When he says the safari balance is
   $960 due on arrival, that fact lands in the database and the app reflects it — **this is the
   explicit "later update on the db based on the info I give you" promise.**
6. **"It understood me."** It works whether he writes in English or Greek (he mixes both), and a vague
   compound sentence still produces both halves (spaces *and* the app) without dropping one.

**Failures the user would recognize even if the chat looks fine:**
- A nice summary but **no** spaces and **no** app → "it just answered me."
- An app that opens but is **empty** → "where's my stuff?"
- Follow-up "noted!" with **no** actual change to the data → "it didn't save it."
- His data ends up in some other/blank project → "this isn't my trip."

---

## 3. What happens in the background (the system choreography)

Under the one sentence, a lot of the platform runs. This is the hop-by-hop reality (with the moving
parts, for maintainers):

1. **Project creation (UI/API).** `POST /api/projects {name:"tanzania-trip"}` creates the live
   project on the user's compute pod. THING runs *inside* that project.
2. **Attachment upload.** The file is base64-uploaded via `POST /api/uploads` → an `AttachmentRef`
   `{id, kind:'file', mediaType:'text/markdown', url}`. A markdown file is classified `kind:'file'`.
3. **The message carries the attachment.** The chat client sends the message **over the WebSocket**
   (`{type:'sendMessage', content, attachments:[{id,…}]}`) — the HTTP `/message` route is
   content-only and would drop the attachment. The pod trusts only the attachment `id` (it re-reads
   the bytes by id).
4. **THING can't read files itself, so it delegates.** THING (a text model) sees a note —
   *"[Attached file id=… — call readDocument to read it]"* — and delegates all file ids in one call
   to **`system-files/dispatch`**, which routes markdown to **`system-files/reader`**.
5. **The file is read.** `reader` calls `readDocument(id)`; the host decodes the raw UTF-8 text (up to
   100k chars) and surfaces the **full file contents** to the reader, which extracts the structured
   trip facts and returns them up the chain to THING.
6. **THING plans and delegates the build.** From the extracted content THING (a) creates the per-leg
   **spaces** (its `build_specialist`/space-authoring path, live-registered so each is delegatable
   immediately, no restart), and (b) delegates to **`system-appbuilder`** (the `automator`) to build
   the **live-project app**.
7. **The automator authors the app INTO the live project** with the S11 live writers — a real DB, an
   API, and pages that serve at `/app/tanzania-trip/`:
   - `writeProjectTable(name, schema[, rows])` → `database/<name>.json` (+ seeds the file's rows),
   - `writeProjectApi(route, src)` → `api/<path>/<METHOD>.ts` (typed handlers),
   - `writeProjectPage(route, src)` → `pages/<route>.tsx` (React pages using `@app/runtime` hooks),
   each republishing so the change goes live with **no pod restart**. `POST /app/tanzania-trip/build`
   compiles the pages; `GET /app/tanzania-trip/` then serves real HTML.
8. **Data moves in.** The file's facts become **rows** in the tables (flights, accommodations, the
   safari, the dining reservation) — the "move all this info … on the db" half.
9. **Later updates flow through the same live writers.** A follow-up message re-invokes the automator,
   which now (tables exist) updates/inserts rows; the app re-derives and reflects the change. Every DB
   write also emits `project/db.<table>.<insert|update|remove>` into the event pipeline, so any hooks
   the app carries react automatically.

Everything above is authored by the model into the user's own project — no engineer touches a file,
and nothing is hand-edited.

---

## 4. User stories

Written as the traveler would frame them, each with its acceptance signal.

- **US-1 — Ingest.** *As a traveler, I want to hand the assistant my existing trip notes as a file, so
  I don't have to re-type everything.*
  **Accept:** THING reads the attachment (delegates to `system-files`) and its plan cites ≥3 specifics
  that appear only in the file.

- **US-2 — Organize by leg.** *As a traveler, I want each part of my trip (Cairo, safari, Zanzibar,
  Dar) kept separately, so I can ask about one place without the others getting in the way.*
  **Accept:** ≥4 leg spaces exist under `tanzania-trip/spaces/`, each delegatable; a leg-specific
  question routes into the right space and answers from the file.

- **US-3 — A real app.** *As a traveler, I want a proper app I can open on my phone, not just a chat
  reply, so my trip is something I can browse.*
  **Accept:** `GET /api/projects/tanzania-trip/app` reports `built:true` with tables + ≥1 page + ≥1
  api; `GET /app/tanzania-trip/` returns 200 with real HTML.

- **US-4 — My data is in it.** *As a traveler, I want all the info from my file actually stored in the
  app, so the app shows my real flights and hotels.*
  **Accept:** flights/accommodations/safari tables contain the file's rows (≥5 flight legs, ≥6 stays),
  and the row contents match the file (Eileen, Suricata, Ngorongoro, A3932…).

- **US-5 — Keep it current.** *As a traveler, I want to keep updating the app by just telling it new
  info, so it stays accurate as my plans firm up.*
  **Accept:** a later free-text instruction ("safari balance $960 due on arrival", "Zanzibar needs a
  driving permit") changes a DB row (observable before/after via the app's data API), with no rebuild
  ceremony.

- **US-6 — Understand me.** *As a traveler who mixes Greek and English, I want it to work in either
  language and to cope with a vague, run-on request, so I can just talk normally.*
  **Accept:** a Greek follow-up still routes + updates; the single compound English sentence produces
  **both** the spaces and the app (neither half dropped); zero eval/typecheck errors.

- **US-7 — It's my project.** *As a traveler, I want everything to land in the `tanzania-trip` project
  I created, so it's all in one place.*
  **Accept:** spaces, app, and data are in `tanzania-trip` — not a store-catalog template with a
  different id, and not an empty project.

---

## 5. Acceptance criteria (the executable acts)

The runner `06-tanzania/run.mjs` drives the flow and asserts against **the trace + real pod state**
(not the model's prose). Each act maps to the user stories above.

| Act | Asserts | Stories |
|---|---|---|
| **I — Ingest** | `system-files` delegate observed; plan cites ≥3 file-specific facts; 0 errors | US-1, US-6 |
| **II — Spaces** | ≥4 leg spaces exist + delegatable; a Zanzibar question answers *The Rock, Aug 15* | US-2, US-7 |
| **III — Live app** | manifest `built:true` (tables + page + api); `/app/tanzania-trip/` → 200 real HTML | US-3, US-7 |
| **IV — Data in db** | flights (≥5) + accommodations (≥6) + safari/dining are **rows matching the file** | US-4 |
| **V — Later update** | a follow-up instruction changes a DB row (before/after diff); app reflects it | US-5 |
| **Edges** | Greek follow-up updates; idempotent re-ask doesn't clobber spaces; big-file ingest is budget-safe and never writes unparseable authoring source | US-6 |

### Performance targets
| Metric | Target |
|---|---|
| Attachment ingest → THING plan | < 90 s |
| Whole build (spaces + app + data) | < 15 min |
| `/app/tanzania-trip/` first byte | < 3 s |
| Later-update message → db row changed | < 90 s |
| Eval/typecheck errors | 0 |

---

## 6. What this scenario is really testing (and the known gap it closes)

This is the first scenario that chains **file-attachment ingestion** (`system-files`) with
**multi-space creation** *and* the **live-project application** path — and it is the one that forces
the platform to **move existing, known data into a project's database and keep updating it**.

That last part exposes a real product gap (surfaced first in the S05 Latin-America run and confirmed
here by code review): the `automator` holds `db:schema` but **not `db:write`**, and its instruct
explicitly says *"you cannot INSERT rows … data enters through the app's own UI [a form]."* That
design assumes a **human types the data in**. But here the data already exists in the attachment and
the user's whole request is *"move all this info into … the db."* There is no path for that today, and
a runtime nuance compounds it (the `db` global is bound once per session from the tables that exist at
session start, so you can't create a table and seed it in the same pass).

**Fix landed by this scenario** (see the run's report + the commit trail):
- `writeProjectTable(name, schema, rows?)` gains an optional `rows` arg that **seeds the file's data
  server-side** right after the table is created — sidestepping the injection-timing wall, so "table +
  data" is one authoring call (the "move all this info into the db" half).
- the `automator` is granted **`db:write`** so a *later* message can update/insert rows (the "later
  update on the db based on the info I give you" half), with its instruct + DTS + tests updated to
  match.

Until this scenario, THING could grow a project into spaces + integrations + automation, and build an
app UI — but it could not take a real document and **populate the app with that data**. Closing that
is the point of scenario 06.

---

## 7. Running it

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                     # prove the harness + prod are healthy (≈1 min)
node ../06-tanzania/run.mjs        # fresh run; writes results/06-tanzania-report.md
node ../06-tanzania/run.mjs --reuse   # reuse the cached tanzania user + project
```

The runner provisions a disposable prod user, creates `tanzania-trip`, uploads
`06-tanzania/fixtures/tanzaniamemories.md` (a copy of the user's real file, so the scenario is
self-contained), sends the message with the attachment over the WebSocket path, drives the follow-ups,
and checkpoints per Act to `results/06-tanzania-checkpoint.json`.

## Actual results

_Filled in by the scenario runner — see `sdk/org/scenarios/results/06-tanzania-report.md`._
