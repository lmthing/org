# Scenario ideas — candidates beyond 05–07

A scratchpad of live-prod scenario candidates, the selection bar they must meet, and the product
gap each one is meant to expose. The authored scenarios live in `05-latam/` through `07-life-admin/`
(see the [README](./README.md) table and [SCENARIO-FORMAT.md](./SCENARIO-FORMAT.md) for the format).
Everything below is **not yet authored** — pick one, `cp -r _template <NN-slug>`, and fill it.

## The bar every new scenario must meet — the "evolving lifecycle" template

A scenario is no longer "build a store-and-remind app" (a Notion template + Zapier could do that).
The lmthing differentiator a chatbot cannot touch is that **the agent keeps working after you close
the chat** — scheduled and inbound turns that read the DB, reason, and write back. So every candidate
below is a **full, self-evolving lifecycle** that exercises the entire feature catalog *and* these
beats:

1. **Multi-modal ingest** — file + image + audio in the opener (`system-files` read, `system-vision`
   → structured rows, audio transcription).
2. **Deep research** — a `deep_research` beat (multi-step `webSearch`/`webFetch`) whose findings land
   in a space's **knowledge** *and* as DB rows.
3. **Spaces that grow with request types** — the project starts with N spaces; as the user's requests
   change character over the lifecycle, THING creates **new** specialist spaces (knowledge-bearing,
   live-registered, no-clobber).
4. **A live app the user can SEE** — tables + API + pages, including a dashboard/visualization page.
5. **Agent-processed forms** — a page form → `POST` app API → **agent turn** → DB write.
6. **Agent updates the DB** — conversational follow-ups **and** scheduled/inbound turns.
7. **Cron-driven agent turns** — a scheduled emitter that wakes an agent to do real work and writes back.
8. **DB emitters → hooks** — a DB change fires a code-filter or agent-trigger hook that acts.
9. **Inbound messaging integration** — install (consent) a Telegram/WhatsApp space; inbound → agent → DB.
10. **Outbound via `callConnection`** — agent sends something out (draft email, post to channel).
11. **Consent + capability gating** — `installSpace` consent, `@consent`, capability gates at typecheck.
12. **Self-evolution** — new request types mid-life → new spaces + new tables + new pages + new
    integrations, **without a rebuild**.
13. **Restraint + multilingual + compound** — a messy compound opener, a non-English beat, and one
    request the agent must **refuse/narrow** (don't buy/diagnose/pay/spam).

## Candidate lifecycles

### 07 — Life-admin vault with a renewal autopilot  *(authored → `07-life-admin/scenario.md`)*
**Persona:** Dimitris, mid-40s, Athens; nobody in his family knows where anything is.
**Request:** *"Attaching all our household admin — insurance, mortgage, pensions, subscriptions,
accounts, plus a photo and a voice memo. Organize this into a vault I can see, never let me miss a
renewal, and if something's renewing tell me if there's a cheaper option."*
**Becomes:** per-domain spaces (insurance / property / pensions / subscriptions / accounts) + a vault
app with a renewals-calendar + coverage-matrix dashboard; a cron shops renewals and writes
recommendations; "renting the flat" / "started a side-gig" grow new sections.
**Leads with:** cron-driven agent research + the most natural self-evolution (life changes → new admin
spaces). **Gap closed/exposed:** deep-research→knowledge+DB; the `ctx.spawn` form gap (working path is
db:insert→hook); mid-life table+page addition to a built app.

### 08 — Small-shop back office that reorders itself
**Persona:** Yuki, ceramics Etsy shop; hates stockouts and spreadsheets.
**Request:** *"Materials/products/suppliers spreadsheet attached, plus 3 months of sales and photos of
my pieces. Build me a stock tracker — when something's low, draft the reorder email to my supplier but
don't send it. And every Sunday give me a read on what sold."*
**Becomes:** per-product-line spaces (catalog / suppliers / stock) + a shop app with a stock dashboard
+ sales chart; a sale logged → db-emitter on stock → hook → agent drafts a reorder email (parked, not
sent); a weekly cron writes a sales-read summary; "adding workshops" / "selling wholesale" grow new
sections.
**Leads with:** the **db-emitter → hook → agent deliverable** loop (the hardest event-pipeline shape).
**Gap:** same three as 07, stressed from the db-emitter angle. Fixtures already at
`08-small-shop/fixtures/` (`inventory.csv`, `product-photo.png`).

### 09 — Home renovation command center
**Persona:** A couple mid-renovation; quotes, photos, and receipts everywhere.
**Request:** *"Quotes, receipts, a budget Excel, photos of every room, and a voice memo from the site.
Build me a reno tracker by room with a budget I can actually see, and warn me before I blow it."*
**Becomes:** per-room spaces (kitchen / budget / contractors) + a reno app with a budget dashboard +
timeline + before/after gallery; log-an-expense form → agent categorizes; db-emitter on budget
threshold → alert; "starting the bathroom" / "need a building permit" grow new sections (permits space
is researched knowledge).
**Leads with:** vision (before/after gallery) + budget db-emitter + phased physical evolution.
**Gap:** mid-life evolution across physical phases; pdf quote ingest.

### 10 — Podcast research desk
**Persona:** Anna, weekly interview show; prep eats her week.
**Request:** *"Guest list for two months with LinkedIn/bios, my past-episode notes, and a voice memo of
angle ideas. Build me a research desk — one briefing per guest — refreshed two days before each
recording with whatever they've been in the news for."*
**Becomes:** per-guest briefing spaces (knowledge from deep_research) + a desk app with an episode
calendar + prep-readiness board; a cron fires T-2 days → agent refreshes each briefing with live news
and marks it prep-ready; "adding a sponsored series" / "turn episodes into articles" grow new sections.
**Leads with:** deep_research → space **knowledge** (not just rows) + the cron-refresh loop.
**Gap:** does researched material land in a space's knowledge and get cited later?; cron-driven
authoring turns that update a space.

### 11 — Family recipe book → meal planner
**Persona:** Vasilis (mixes Greek/English); his mother's recipes are disappearing.
**Request:** *"Σου στέλνω τις συνταγές της μάνας μου — φωτογραφίες χειρόγραφων, συνταγές από το
ίντερνετ, και ένα ηχητικό. Φτιάξε βιβλίο ανά κουζίνα, και κάθε Κυριακή φτιάξε τα φαγητά της βδομάδας
με μία ενιαία λίστα αγορών."*
**Becomes:** per-cuisine spaces (ελληνική / ιταλική) + a recipe app with a recipe-book + meal-plan +
shopping-list page; a Sunday cron → agent plans the week from the book and computes a de-duplicated
shopping list as rows → pings Telegram; "Nikos is now gluten-free" / "hosting a dinner for 8" grow new
sections.
**Leads with:** audio transcription + handwritten-Greek vision + cron **synthesis** (meal plan →
derived rows). **Gap:** audio→rows; handwritten OCR; multilingual end-to-end.

## Other candidates (upgrade to the template above)

- **Home inventory for insurance** — photos of belongings + receipts + a valuables spreadsheet →
  per-room spaces + an inventory app with warranty-expiry cron. Leads with **vision → structured rows**
  (receipt/product photos). Mild overlap with the `homes` store app — fine, personal-data angle.
- **Job-search command center** — CV + 5 job descriptions → per-company spaces + a pipeline app with
  follow-up cron. Leads with **live webSearch research → DB** + restraint (don't apply for him).
- **Telegram personal errand assistant** — build an errand tracker, connect Telegram, ping from the
  phone → app logs + cron pings back. Leads with **real per-platform inbound webhook** (the gap
  `contained-messaging-integrations` flags as not yet live-tested) + cron→channel outbound.
- **Chronic-condition health log** ⚠️ sensitive — specialist letters + labs + med schedule + seizure
  log → per-specialty spaces + a health log app with med-refill cron + a db-emitter that surfaces
  symptom patterns. Leads with **restraint** ("you're not his doctor") + sensitive-data handling.
  Confirm health data is in-scope before authoring.
- **House-hunting decision engine** (time-boxed) — listings + photos + mortgage quotes → per-listing
  spaces + a comparison app with an agent-maintained scoring function; a cron re-fetches listings and
  re-ranks. Leads with **scheduled webFetch → DB → re-derived score** + a natural teardown (decide →
  archive, which no scenario tests).

## The seam these all force

Two things are almost certainly **untested gaps**, and every lifecycle above forces them:

1. **Self-evolution mid-life** — adding a *new table + page + integration* to an **already-built** app
   from a later chat turn, with the new schema live and the `db` global rebound to include it. Tanzania
   seeded rows once at build; none of 01–06 add a *new* table to a running app in a later act.
2. **Agent-processed forms** — a page form → app API route → **agent turn** → DB. `ctx.spawn` from an
   app API handler is a **known no-op** (`reference-project-app-runtime-gotchas`); the working path is a
   `db:insert` emitter → event hook with a `trigger`. No scenario or unit test drives this end-to-end.

A third, softer seam: **cron/inbound → agent turn that writes to the DB** (today's cron emitters mostly
*ping*; whether one can wake an agent that authors rows is unproven). 07 and 08 each force it from a
different angle (research/synthesis vs. reorder draft).
