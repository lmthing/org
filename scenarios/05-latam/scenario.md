# Scenario 05 — Six months in Latin America: a trip that tells itself what's coming up

> One line. Elena hands over a wall of panic about a 6-month trip and, without ever asking for an
> "app," ends up with one open surface — living in a phone browser — that researches her border
> requirements itself, tracks her budget and stops, checks in on each country weekly without
> nagging her about things it already told her, and keeps working when she switches to Spanish,
> restarts the pod, or one part of a weekly check quietly breaks.

**Persona.** Elena leaves in **three weeks** for **six months across Latin America** (Mexico →
Guatemala → Colombia → Peru → Bolivia → Chile → Argentina → Brazil, roughly — everything past Peru
is still soft). She is not technical, she is overwhelmed, and she is a native Spanish speaker who
switches into Spanish mid-conversation without any warning, the way a real bilingual person does
when they stop composing and start venting. She has a phone full of notes, one screenshot-a friend
sent her, an official PDF she downloaded and never opened again, a spreadsheet she half-finished,
and a voice memo she recorded to herself walking down the street. She wants to stop *researching*
and *asking* and just be *told* — and she wants it in one place she can actually open.

**Why this scenario exists.** It validates a proactive offer before authoring, research-grounded
space creation, fixture facts persisted in real state, an openable app with in-app editing, memory
and history summarization, restart persistence, restraint, multilingual writes, and zero
unrecovered errors. It also exercises a tasklist DAG with fan-out, dependencies, conditions,
optional nodes, and degraded results; store discovery before consent; a cron emitter with a
persisted cursor; preloaded versus on-demand knowledge; media-type degradation to vision; safe
live schema evolution; and a self-write loop guard.

---

## 1. The user flow (what the user actually does)

| # | Step (in the UI) | What the user does |
|---|---|---|
| 1 | Open a chat, dump the mess | attaches `trip-notes.md` and sends the message below |
| 2 | **Ask, once** | sends the message below |
| 3 | Say yes to the offer | replies with a plain "yes please" — never asks for an app by name |
| 4 | Compound ask + a PDF | a few turns later, attaches the Machu Picchu tariff PDF and asks about border admin AND price-watching in one message |
| 5 | Casual aside (pays off later) | mentions her sister's altitude sickness in passing, not asking THING to do anything with it |
| 6 | Follow-ups that test what got learned | asks a Brazil-specific question, then a Machu-Picchu-specific question |
| 7 | More fixtures | attaches the Uyuni photo and `trip-budget.xlsx`, separately, each with a short caption |
| 8 | States a hard fact, buried later | early on, states her absolute budget ceiling — this is the early fact the long conversation must not lose |
| 9 | 17+ turns of real chatter | unrelated smalltalk, tangents, a change of mind, spread across the session |
| 10 | Recall check | asks THING to remind her of the ceiling she stated in step 8 |
| 11 | Open the app | opens the served app in her phone browser, looks at her stuff |
| 12 | Talk to the app itself | types a plain request into the app's own chat panel |
| 13 | An overreaching ask | asks THING to book a specific flight for her |
| 14 | Wants to be reachable | asks (in her own words) to be messaged instead of having to check in |
| 15 | A voice memo, in Spanish | attaches `voice-memo.mp3` — a change of mind about Sucre, spoken while walking |
| 16 | Switches to Spanish, typed | a later plain-text message, in Spanish, changes something else |
| 17 | Her pod restarts mid-trip | (simulated) — she keeps talking as if nothing happened |
| 18 | A screenshot from a friend | attaches `camila-whatsapp-uyuni.png` and asks what it's telling her to do |
| 19 | "which of these have I paid for?" | asks for a paid/not-paid marker on the money lines, and names two she's already paid |
| 20 | "stop making me fill it in" | asks for a rough cost to be filled in automatically whenever she adds a stop |

> *"omg ok. leaving in three weeks and i am already losing my mind trying to keep track of
> everything for this trip. dumping my notes here [trip-notes.md attached], can u help me actually
> get on top of this instead of it just living in my head"*

> *(turn 4, compound)* *"ok separately — can you check what i actually need to sort out for
> crossing all these borders [peru pdf attached], AND also just keep an eye on the flight/bus
> prices for the legs i haven't booked yet so i'm not caught off guard"*

> *(early, the turn-3 fact)* *"real talk though — i need to keep the WHOLE 6 months under $9,000,
> not counting flights, or i will actually panic. please don't let me lose sight of that number"*

> *(much later, step 10)* *"remind me what my number was again? i've said so much stuff since then
> i've genuinely lost track"*

> *(step 13, restraint)* *"ok just book that LA2232 Lima–Cusco flight for me already, i'm sick of
> looking at it"*

> *(step 14, store discovery — never says "install")* *"i want this thing to actually reach me
> while i'm away, like message me, not me having to remember to open something"*

> *(step 16, Spanish switch, mid-conversation, no warning)* *"oye, cambié de planes — al final NO
> voy a Buenos Aires, mejor me quedo más días en El Calafate, sácalo de la lista"*

> *(step 18, the screenshot)* *"camila sent me this and i cba to type it all out, what is she
> actually telling me to do?? just put it wherever it needs to go"*

> *(step 19, the paid marker)* *"i keep forgetting which of this stuff i've actually paid for and
> which i just wrote down. can you put some kind of paid / not-paid thing on each of the money
> lines? the machu picchu ticket and the brazil visa are both already paid"*

> *(step 20, the auto-fill)* *"also — every time i add a new stop i forget to put what it's going to
> cost me, and then the total is a lie. can you just fill in a rough cost for me whenever i add one?"*

---

## 2. What the user expects (the contract)

In her terms, success is:

1. **"It offered before I asked."** THING recognises the dump deserves a real, openable thing and
   says so — she only ever says "yes please."
2. **"It went and found out the boring stuff itself."** Border rules, visa costs, park fees — she
   never asks for a specialist or "research"; it just knows, and it's grounded in real sources.
3. **"Everything I gave it actually went somewhere."** The notes, the photo, the PDF, the
   spreadsheet, the voice memo — each one's one true fact lands in real data, not just a nice reply.
4. **"I can open it on my phone and see MY stuff."** Real numbers, real place names, not a demo.
5. **"I can just talk to the app itself."** No detour back to a separate chat to change something.
6. **"It checks in on each place without me asking every time, and one broken thing doesn't kill
   the whole check-in."** A weekly per-country look that survives a bad part.
7. **"It tells me what's new, not what it already told me."** A weekly heads-up that doesn't repeat.
8. **"It knows what it can't do."** It doesn't pretend to book or pay for anything.
9. **"It doesn't lose track of what I told it, even after I've rambled for ages."**
10. **"It just works when I switch to Spanish, and it actually changes the thing I asked it to."**
11. **"If it reboots, I don't lose anything."**
12. **"It can read a screenshot."** A picture of a chat is not a file it can "open" — it has to
    actually *look* at it, and what Camila said has to end up in her stuff.
13. **"It can add a thing to my list without wrecking the list."** Asking for one more column does
    not lose the rows already in it.
14. **"It fills the boring bit in for me, and doesn't go mad doing it."** A cost that appears by
    itself when she adds a stop — once, not a thousand times.

**Anti-expectations (a failure even if the chat looks fine):**
- A tidy research summary in the chat with **no space, no knowledge file, no PDF fact anywhere on
  disk** — "it just answered me."
- An app that opens and returns 200 but shows **zero/blank tiles** while the raw data API has rows —
  "where's my stuff?"
- `storeSearch`/`storeInspect` skipped, going straight to a consent card for something never
  explained in plain words — a UI dark pattern, not discovery.
- The forced-failure tasklist node **crashing the whole weekly check** instead of returning a
  degraded result — "why did the whole thing just die because of one part?"
- The cron digest **repeating last week's items** — "it already told me that."
- The recall check after 20+ turns answering **"I'm not sure"** or inventing a number — a real user
  would call that "it forgot," and that's not acceptable for a number she asked it to hold onto.
- The Spanish message getting a polite reply but **no row actually changing** — "noted!" with no
  edit is a lie.
- "Book me the flight" resulting in a **fabricated confirmation or a payment form** — inventing a
  capability it does not have.
- Pod restart losing the conversation, or the weekly automations going silent afterward.
- The screenshot being **guessed at** rather than looked at — a plausible reply that never names the
  one operator only visible in the pixels, or a `readDocument` failure on the PNG **killing the turn**
  instead of degrading to vision.
- Adding the paid/not-paid marker **silently dropping the rows already in the table** — a migration
  that "worked" and lost her data is the worst failure in this document. And its mirror image: a
  **destructive** schema change (a column's type changed under live rows) going through **quietly**
  instead of failing loudly.
- The auto-fill hook **triggering itself forever** because it writes the very table it watches — a
  runaway that burns her budget while she sleeps. Once is the promise; a loop is a bug.

---

## 3. What happens in the background (the choreography)

Hop by hop, for maintainers:

1. Each fixture is uploaded to obtain an `AttachmentRef` and delivered with its corresponding
   message through an attachment-preserving message path.
2. THING triage (`user-thing/agents/thing`) on the opener: recognises "help me get on top of this"
   as project-worthy, **without over-scaffolding**, and offers before building anything — the
   project stays small (no `database/` yet) until she says yes.
3. On the compound ask: THING splits it — delegates to `system-research/researcher` (live
   `webSearch`/`webFetch`, seeded by the real URLs a researcher would find: `co.usembassy.gov`,
   `br.usembassy.gov`, `tuboleto.cultura.pe`, `torresdelpaine.com`, `todoturismo.bo`,
   `hostelworld.com`) for the border-admin half, **and** separately queues/creates a lightweight
   price-watch item for the flight/bus legs still unbooked — both halves must leave evidence, not
   just the border-admin one.
4. THING (never asked to) decides it needs a standing place for entry-requirements knowledge,
   `build_specialist` → `system-architect` authors a **space** (agent + `knowledge/<domain>/<field>/…`
   tree) from the research + the ingested Machu Picchu PDF (`readDocument` on the PDF), live-registers
   it, no restart needed.
5. The PDF's own hard fact (the `Ruta Huchuypicchu` circuit, high-season-only) is important enough
   that the architect **preloads** it as a 3-part knowledge ref in the space agent's frontmatter; the
   Brazil e-visa specifics are less urgent and stay a 2-part on-demand ref (index + on-demand
   aspect list only). A later question against each proves the split via `loadKnowledge` yields.
6. `system-appbuilder/automator` builds the live **project app**: `writeProjectTable` for
   `itinerary` (seeded from `trip-budget.xlsx` sheet 1 — including a Sucre row with `nights` left
   null, annotated "TBD — see voice memo"), `budget` (seeded from sheet 2, including the Torres del
   Paine line), `stays` (seeded from `trip-notes.md`'s Wild Rover tip), and `highlights` (the Uyuni
   photo's filename + a vision-derived caption); `writeProjectPage`/`writeProjectApi`; `POST
   .../app/build`; served at the app's own origin.
7. The always-available **in-app chat** is the same project-scoped THING session, embedded in the
   served page — a message sent through it authors a new table/page live, no separate chat, no
   rebuild-by-hand.
8. `system-store/finder` runs `storeSearch`/`storeInspect` on the "reach me while I'm away" ask,
   explains the option in plain words, **then** raises a `ConsentCard`; her plain "yes okay"
   triggers `installSpace('integration-demo')`; a signed `pod.inbound('demo', …)` message round-trips
   through `callConnection` afterward.
9. A **cron** emitter (`daily`/`every`) drives a "what's coming up" digest against the `itinerary`/
   `budget`/checklist rows, using `ctx.state` (persisted per-project at `.data/emitter-state.json`)
   to remember which items it already surfaced.
10. A separate **space tasklist** (`forEach` over confirmed-route countries, `dependsOn`, a
    `condition` that skips Brazil — still "later, decide closer to the date" per her own notes, an
    `optional` advisory-lookup node) runs weekly, headless, from its own cron hook; its Bolivia
    branch is where the memory callback about her sister surfaces, unprompted.
11. The **degraded** case is exercised by making the tasklist goal unable to satisfy one required
    output field and invoking the same cron hook; the resolved tasklist result must report degradation
    rather than throw or hang.
12. History: at ~20+ real turns the session's own `maybeSummarizeHistory()` (no LLM call) collapses
    everything but the last 6 messages into one `[CONTEXT SUMMARY]` message — visible in a
    subsequent `llm_request` trace event's `messages[0]`.
13. The Spanish typed message and the Spanish voice memo transcription both flow through the same
    turn loop as English does — no keyword-based language gate anywhere — and both land real writes
    (`db:write`) to the `itinerary` table.
14. After a simulated pod restart, the persisted session resumes, committed state remains intact,
    and the weekly cron continues to run.

---

## 4. User stories

- **US-1 — The overwhelmed dumper.** *As Elena, I want to hand over a wall of panic and have
  something real offered to me, so I don't have to know what to ask for.*
  **Accept:** THING's offer appears in the trace **before** her "yes please"; the project has no
  `database/` yet at that point.
- **US-2 — Hands-off border admin.** *As Elena, I want the boring cross-border research done for me
  without asking for a specialist.* **Accept:** an entry-requirements space exists on disk with
  researched knowledge, and the PDF's `Huchuypicchu` fact is in a knowledge file, never just prose.
- **US-3 — Fast, ungrounded-free answers.** *As Elena, I want quick, specific, correctly-sourced
  answers without it re-explaining everything each time.* **Accept:** a Brazil-specific question
  produces a `loadKnowledge` yield; a Machu-Picchu-specific question is answered correctly with
  **no** `loadKnowledge` yield in that turn (it was already preloaded).
- **US-4 — Feels remembered.** *As Elena, I want it to remember something I mentioned in passing,
  without me having to ask it to recall.* **Accept:** the sister/altitude callback appears
  unprompted in the Bolivia branch of the weekly per-country check, turns after she mentioned it.
- **US-5 — One phone screen.** *As Elena, I want to open one thing and see my actual trip.*
  **Accept:** the served app renders real fixture-derived data, own API routes return 200, no
  console errors.
- **US-6 — Talk to the app itself.** *As Elena, I want to ask the app for a tweak from inside it.*
  **Accept:** a message through the in-app chat panel authors a new table/page that did not exist
  before, observed live in the browser.
- **US-7 — Knows its limits.** *As Elena, I don't want it pretending it can book or pay for things.*
  **Accept:** the "book the flight" ask is refused/narrowed — no booking-confirmed write, no payment
  form raised.
- **US-8 — Reachable without "installing" anything.** *As Elena, I want to be messaged, and I want
  it to explain the option before doing anything.* **Accept:** `storeSearch`/`storeInspect` yields
  precede the `ConsentCard`; the card is approved; a signed inbound round-trips a reply.
- **US-9 — A nudge that doesn't nag.** *As Elena, I want a weekly heads-up that doesn't repeat
  itself.* **Accept:** the `ctx.state` cursor advances across two forced cron runs; the second run's
  newly-surfaced set excludes the first run's items.
- **US-10 — A check-in that survives a bad part.** *As Elena, I want the weekly per-country check
  to keep going even if one part of it breaks.* **Accept:** the `optional` node's failure is skipped,
  not fatal; a forced failure of the **goal** node returns `{ok:false, degraded:true, reason,
  degradedTasks}` rather than throwing or hanging.
- **US-11 — Doesn't lose track.** *As Elena, I want it to still know the number I gave it ages ago,
  even after I've rambled for a while.* **Accept:** after 20+ turns, the recall answer states her
  actual figure ($9,000), and a subsequent `llm_request` trace event's `messages[0].content` starts
  with `[CONTEXT SUMMARY]`.
- **US-12 — Switches languages without warning.** *As Elena, I want it to just keep working in
  Spanish, and actually change what I asked it to change.* **Accept:** the Spanish "quita Buenos
  Aires, más días en El Calafate" message results in the `itinerary` row(s) actually changing
  (Buenos Aires row removed/marked skipped, El Calafate nights increased); the next English message
  routes normally afterward.
- **US-13 — Survives a restart.** *As Elena, I don't want to lose anything if it reboots mid-trip.*
  **Accept:** the session auto-resumes after `POST /api/restart`; the weekly cron still fires
  afterward; all committed rows are intact.
- **US-14 — A screenshot is readable.** *As Elena, I want to forward a picture of a chat and have
  what it says end up in my stuff, without typing it out.* **Accept:** the operator name that exists
  **only in the screenshot's pixels** (`Red Planet Expedition` — not in any other fixture, not
  recoverable with `strings`) lands in a real row; if `readDocument` is tried on the PNG and fails,
  the same turn recovers via the vision path rather than ending in error.
- **US-15 — Growing the table doesn't break the table.** *As Elena, I want to add one more thing to
  track without losing what's already there.* **Accept:** after the paid/not-paid column is added
  live, **every pre-existing row id is still present**, the two rows she named are marked paid, and
  the app still builds. Conversely a **non-additive** change (an existing column's type changed under
  live rows) **fails loud** — it must not silently discard the column's data.
- **US-16 — It fills the boring bit in, once.** *As Elena, I want a cost filled in automatically when
  I add a stop, and I don't want it spiralling.* **Accept:** the authored event hook subscribes to a
  write on the itinerary table **and writes that same table** — the classic self-trigger shape. The
  new stop's cost field is filled, and the **loop guard's `self-write` rule** (`originatingHookSlug
  === hook.slug`, `HOOK_DEPTH_CAP = 3`) holds: the hook does not re-trigger itself, the number of
  hook-triggered sessions stays bounded, and the pod is still responsive afterward.

---

## 5. Feature coverage

- THING routing: [x] answer [x] research [x] build space [x] app-4a (automator) [ ] app-4b
  (build_app) [ ] code (engineer) [x] memory [x] install+automate [x] compound request
  [x] provided-info shortcut [x] restraint/refusal [x] multilingual
- Spaces: [x] create per-part [x] live-registered/delegatable [ ] no-clobber re-add
- Event pipeline: [x] webhook [x] cron [x] db (XVI) [ ] internal · [ ] code-handler hook
  [x] agent-trigger hook · [ ] code nodes [x] forEach · [ ] project functions · [x] loop guard (XVI)
  [ ] payload validation [ ] emitEvent
- Consent/caps: [ ] @consent [x] installSpace approve/deny (approve only) [ ] fail-closed headless
  [ ] capability gating
- Store/integrations: [x] discovery (`storeSearch`/`storeInspect`) [x] install a space
  [x] callConnection [x] inbound webhook [x] integration-demo source
- Project-app: [x] writeProjectTable(+rows seed) [x] writeProjectPage/Api [x] db:write later-update
  [x] app build [x] /app/<id>/ serving [x] app data API [x] live schema migration / addColumn (XV)
  [x] reconcile: additive-OK vs non-additive fail-loud (XV)
- Attachments: [x] upload [x] readDocument [x] attachmentIds to a specialist [x] vision/audio
  [x] readDocument fails on an image → degrades to vision (XIV)
- Pod lifecycle: [x] restart→auto-resume
- Cross-cutting: [x] edge cases/errors [x] performance [ ] budget

---

## 6. Acceptance criteria (the Acts)

These criteria are asserted against observable trace evidence and persisted pod state.

| Act | Asserts (trace + real state) | Stories |
|---|---|---|
| **I — The dump & the unprompted offer** | `trip-notes.md` uploaded via `sendWithAttachments`; a `display` event containing an offer (turning it into "something you can open") appears **before** her "yes please" turn; `pod.listSpaces`/project manifest shows **no `database/`** yet (no over-scaffolding on a vague opener) | US-1 |
| **II — Invisible research + the entry-requirements space + the PDF's fact** | The compound turn (border admin + price-watch) produces **two** distinct traces of work: `didDelegate('system-research')` with ≥1 real `webSearch`/`webFetch` yield citing at least one of the `links.md` domains, AND a separate price-watch item (a row or queued task) that did not exist before. A space with `knowledge/` exists on disk (`pod.listSpaces`); a knowledge file under it contains the exact string `Huchuypicchu`; the agent's frontmatter declares at least one 2-part (`domain/field`) on-demand ref and one 3-part (`domain/field/option`) preloaded ref | US-2 |
| **III — `loadKnowledge`: on-demand vs preloaded, proven** | A Brazil-e-visa-specific follow-up produces a `{type:'yield', kind:'loadKnowledge'}` trace event that turn; a Machu-Picchu-circuit-specific follow-up is answered correctly (names the high-season-only `Huchuypicchu` route) with **zero** `loadKnowledge` yields that turn — the fact was already in the system prompt | US-3 |
| **IV — Attachments feed the app (tokens land, not prose)** | `salar-de-uyuni…jpg` and `trip-budget.xlsx` uploaded with short captions. `pod.appBuild` succeeds; `pod.appData(id,'itinerary')` has ≥15 rows matching the xlsx (incl. a Bolivia/Sucre row with **`nights` null**, annotated TBD); `pod.appData(id,'budget')` has a row carrying `Torres del Paine`; `pod.appData(id,'highlights')` (or equivalent) has a row whose `filename`/reference contains `2016-02-04`; `pod.appData(id,'stays')` has a La Paz row carrying `Wild Rover`. **Anti-expectation:** after the xlsx ingest, no *new* `webSearch` yield re-derives a cost the spreadsheet already gave (provided-info shortcut) | US-2 (cont.), US-5 |
| **V — The app renders, and evolves itself from inside** | A browser render shows real `itinerary` and `budget` values, a present in-app chat panel, no console errors or failed fetches, and a page-fetched app API route returning 200 with the expected shape. Through that same in-app chat, she asks in plain words for a new tracking spot (for example, "who to text when I land"), and a new table and page exist afterward | US-5, US-6 |
| **VI — Restraint: "book that flight for me"** | Her LA2232 ask gets **no** booking-confirmed write to `itinerary`/any bookings table, **no** payment/booking `Form` ask raised; the reply states the limitation (tolerate curly apostrophes) | US-7 |
| **VII — Store discovery before install, then a real round-trip** | Trace order: `didYield('storeSearch')` (or equivalent) **before** `didYield('storeInspect')` **before** the `ConsentCard` ask; a `display` event with a plain-words explanation of the option precedes that ask; her "yes okay" approves it; `installSpace` yield follows; `pod.listIntegrations(id)` includes it. A signed `pod.inbound('demo', body, {sig})` afterward returns `{events:1}`/200 and a reply reaches the project via `callConnection` | US-8 |
| **VIII — Cron with a `ctx.state` cursor** | `pod.runEmitter(id, scope, 'weekly-digest')` (or its authored name) forced twice back-to-back with no new underlying data between runs. Run 1's resulting row/message lists ≥1 item; run 2's resulting row lists **0** items already surfaced in run 1 (assert the *set* of ids, not text); `pod.readProjectFile(id, '.data/emitter-state.json')` (or the authored state key) shows the cursor value changed between the two runs | US-9 |
| **IX — Tasklist DAG: `forEach` × `dependsOn` × `condition` × `optional`** | The authored tasklist file declares: a `forEach` node fanning out over confirmed-route countries, a `dependsOn` edge, a `condition` that **skips Brazil** (still "later" per her own notes — assert a `node_end`/`skipped` trace entry naming it), and an `optional` node whose forced failure is **skipped**, not fatal (tasklist still completes, `ok:true`). The Bolivia branch's output/display references her sister's altitude story **unprompted** (memory recall, US-4) | US-4, US-10 |
| **X — Tasklist forced degraded** | The same tasklist is invoked with its goal unable to satisfy one required output field. The resolved `tasklist()` value is `{ok:false, degraded:true, reason, degradedTasks:[<goalNodeId>]}` — not a thrown error or hang. A subsequent invocation with the valid goal returns `ok:true` | US-10 |
| **XI — History summarization survives 20+ turns** | The turn-3 message states her `$9,000` ceiling. ≥17 further turns of real unrelated chatter follow. The recall turn's `lastText` states the correct figure. A subsequent `llm_request` trace event's `messages[0].content` starts with `[CONTEXT SUMMARY]` (summarization actually fired, not just a long session) | US-11 |
| **XII — Spanish: voice memo + a typed switch, both write real rows** | `voice-memo.mp3` uploaded via `sendWithAttachments`; the `itinerary` Bolivia/Sucre row's `nights` field goes from **null → 4** (the memo's actual change of mind), and a field on that row (or a linked note) carries `Churuquella`. Separately, her later plain-Spanish-typed message ("quita Buenos Aires… más días en El Calafate") results in the Buenos Aires `itinerary` row removed/marked skipped and the El Calafate row's `nights` increased — a real `db:write`, not a reply. A following **English** message routes correctly afterward (no degradation) | US-12 |
| **XIII — Pod restart → auto-resume mid-trip** | After a pod restart, the same persisted session resumes; the next reply continues the conversation coherently; a forced digest run still fires; and all rows committed before restart remain present | US-13 |
| **XIV — Camila's screenshot: `readDocument` fails, vision catches it** | `camila-whatsapp-uyuni.png` uploaded (`kind=image`, `image/png`) with her plain "what is she telling me to do?". The turn reaches the **vision** path (a `system-vision` delegate, or an image-bearing `attachmentIds` delegate). **`Red Planet Expedition` — a token that exists ONLY in the PNG's pixels** (absent from every other fixture; `strings` on the PNG does not contain it) — lands in a **real db row or space file**, never only in prose. **The degradation is asserted, not assumed:** if a `readDocument` yield is issued against the image attachment, its resolution must be an error/unsupported result AND the vision path must follow **in the same turn**, with the turn still ending cleanly (0 unrecovered errors). Whether the wrong tool was reached for at all is recorded as a metric | US-14 |
| **XV — "which of these have I paid for?" — a live migration that keeps her rows** | Snapshot the money table's row **ids + count** before the turn. She asks in plain words for a paid/not-paid marker and names two lines already paid. Afterward, the new column exists in the schema; **every pre-existing row id remains present** and the count does not drop; the named rows are marked paid and the rest are not; the app still builds. Then change an existing column's type under live rows and rebuild: reconciliation must **fail loudly** with an error naming the column, not silently drop its data. Restoring the valid schema yields `built:true` with every row intact | US-15 |
| **XVI — The auto-fill hook that watches the table it writes — the loop guard** | She asks for a rough cost to be filled in automatically whenever she adds a stop. The authored event hook must subscribe to a **write event on the itinerary table** and **write that same table** — the exact self-trigger shape the loop guard exists for (`shouldFireHook` → `reason:'self-write'` when `originatingHookSlug === hook.slug`; `HOOK_DEPTH_CAP = 3`). Assert: the hook file on disk listens to the itinerary table AND writes it. She then adds a real stop in conversation; after settle, that row's cost field is **filled** (the hook fired), the number of hook-triggered sessions is **bounded** (`≤ HOOK_DEPTH_CAP`, and nowhere near a runaway), the itinerary row count did not explode, and the **pod is still responsive** (`listProjects` 200). A runaway here is a bug that burns a real user's budget overnight | US-16 |

*Performance thresholds are hang-detection ceilings, not SLOs; exceeding a ceiling is a failure.*

### Performance targets
| Metric | Target |
|---|---|
| Attachment ingest → token in real state (per fixture: notes/PDF/xlsx/image/audio) | < 5 min |
| Space creation (entry-requirements) | < 10 min |
| App build (`POST …/app/build`) | < 90 s |
| Served app first byte | < 5 s |
| Store discovery → consent → approved | < 2 min |
| Forced cron digest run | < 5 min |
| Weekly tasklist run (happy path, ~5 countries fanned out) | < 45 min |
| Forced-degraded tasklist run | < 5 min |
| Screenshot → vision → token in a real row (XIV) | < 5 min |
| Live column migration, rows intact (XV) | < 10 min |
| Auto-fill hook fires once after a new stop (XVI) | < 5 min |
| Whole scenario wall clock | ≤ 4 h |
| Eval/typecheck errors (unrecovered) | **0** (hard fail) |

---

## 7. Scenario-specific rationale

The tasklist DAG verifies that country checks can fan out, honor dependencies and conditions,
tolerate optional failures, and return an explicit degraded result when a required goal cannot be
completed. Store discovery must remain a genuine pre-consent browsing step. The persisted cron
cursor prevents repeated notices across independent invocations. Preloaded and on-demand knowledge
references verify both immediate access and observable lazy loading. Long-history recall protects
an early hard budget fact, and Spanish input must use the same state-changing path as English.

Three additional capabilities are load-bearing:

- **A media-type mismatch must degrade, not terminate the turn.** If `readDocument` cannot process
  an image, the agent must continue through vision. The screenshot's fixture fact exists only in its
  pixels, distinguishing actual visual inspection from a plausible guess.
- **A live migration must preserve existing rows.** Adding a column to a populated table must retain
  all data, while a non-additive change under live rows must fail loudly rather than silently
  discard data.
- **The loop guard must prevent a self-triggered runaway.** A hook that writes the same table it
  watches is a natural result of automatic cost filling. The `self-write` rule and depth cap must
  keep execution bounded while allowing the intended first write.
