# Scenario 05 — Six months in Latin America: a project that grows with the trip

**Persona.** Elena is leaving in three weeks for **six months across Latin America** — Mexico,
Guatemala, Colombia, Peru, Bolivia, Chile, Argentina, Uruguay, Brazil. She doesn't know her full
route yet. She wants to start with something small, and grow it, country by country, as she goes.
By the end she wants to stop *asking* for things and just be *told* — accommodation booked,
buses tracked, events near her surfaced — with a web app she can open on her phone and see it all.

**Why this scenario exists.** Every other scenario tests a feature. This one tests the **product
promise**: that a project can start as one conversation and grow, over months and dozens of turns,
into a real application — spaces added incrementally, integrations installed with consent,
automations authored into the live project, a database, an API, pages, hooks, and a cron loop — all
through THING, with no file ever hand-edited. It is the full lifecycle (creation → growth →
automation → observation) under realistic, messy, incremental instructions.

This is also the scenario most likely to find real bugs, because it is the only one where the system
has to hold a coherent structure across a long, drifting conversation.

## Feature coverage

Effectively everything, in the order a real user would meet it:

`system-research/researcher` · `system-store/finder` + consent installs · `system-appbuilder`
(`app-architect`, `data-modeler`, `api-author`, `page-builder`, `automator`) · `system-engineer`
(project functions) · per-country **spaces** with their own agents & knowledge · **project app**
(`database/ pages/ api/ hooks/`) · all four **emitter kinds** · code-handler **and** agent-trigger
hooks · **code nodes** · `forEach` · `callConnection` gating · project growth without restarts ·
the live app surface (`/app/<id>/`).

## Setup

```bash
cd sdk/org/scenarios/harness && node ../05-latam/run.mjs
```

Long-running (target ≤ 4 h). The runner checkpoints after every act to
`results/05-latam-checkpoint.json`, so a failure late in the trip doesn't cost the whole run — it
can resume from the last good act against the same user and project.

---

## Act I — "I'm going to Latin America" (weeks before departure)

### Step 1 — The project
**Prompt:** *"I'm travelling around Latin America for 6 months starting in three weeks. Help me keep
track of it. Start a project called `latam`."*

**Expect:** project created; THING names the session; asks at most a couple of clarifying questions
rather than building a cathedral unprompted. **Anti-expectation:** it must **not** immediately build
a 9-country app — over-eager scaffolding on a vague request is a failure, and the runner asserts the
project is still small at this point (no `database/` yet).

### Step 2 — Research, not hallucination
**Prompt:** *"What do I actually need to sort out before I go? Visas, vaccines, the rough route."*

**Expect:** THING delegates to `system-research/researcher`, which uses `webSearch`/`webFetch`
(live — Tavily/Bing chain). The answer cites real sources. It is written into the project as a
document (which fires `document.written`).

**Assert:** `didDelegate('system-research')`; ≥1 `webSearch`/`webFetch` yield; a document exists on
the pod FS.

### Step 3 — The first country space
**Prompt:** *"Let's start with Mexico. Make me a Mexico space that knows the stuff I'll keep asking:
buses, neighbourhoods, safety, where the good coffee is."*

**Expect:** a **space** (not a document) at `latam/spaces/mexico/` with an agent + `knowledge/`.
THING can `delegate()` into it immediately, without a pod restart (live registration).

**Assert:** the space directory exists; a follow-up question (*"how do I get from Mexico City to
Oaxaca?"*) is answered **by delegating to the mexico agent**, not by THING answering from thin air.

---

## Act II — The trip begins: growth under drift (this is where structure breaks)

### Step 4 — Country by country, one at a time
Over **8 separate turns**, spread across the conversation with unrelated chatter in between, Elena
adds: Guatemala, Colombia, Peru, Bolivia, Chile, Argentina, Uruguay, Brazil — each with a different
emphasis (*"Colombia's mostly about coworking spaces"*, *"Bolivia I care about altitude and border
crossings"*, *"Brazil is a language problem, I don't speak Portuguese"*).

**Expect:** 9 country spaces, each with its own agent and knowledge shaped by what she asked for.
**Assert:** all 9 exist; each is delegatable; **THING's own instruct/behaviour has not degraded** —
the runner re-asks a Step-3-style question at the end of the act and it must still route correctly.

**This is the scale test for space registration:** 9 spaces + system spaces in one project, all
live, no restart.

**Edge:** ask for a country space **twice** (*"add Peru"* again). Expect: THING recognises it exists
and doesn't clobber the knowledge she accumulated. Silent overwrite = data loss = failure.

### Step 5 — Connect the outside world (consent)
**Prompt:** *"I want the trip to reach me on chat — I'll message the project and it should message
me back."*

**Expect:** `system-store/finder` → `installSpace('integration-demo')` (stand-in for her messenger;
no provider account needed) → **consent card** → approve. Then a hook on
`integration-demo/message.received` so she can talk to the project from chat.

**Assert:** consent card raised and approved; the space is installed and registered; a signed
inbound message reaches the project and gets a reply back through `callConnection`.

**Edge:** she declines a *second* integration (*"no, don't connect my email"*) → **nothing is
installed**, and THING carries on without it.

---

## Act III — "Stop asking me, just do it" (the project becomes an application)

### Step 6 — The app
**Prompt:** *"Turn this into a proper app I can open on my phone: a page per country, my itinerary,
my bookings, and the events happening near me."*

**Expect:** THING delegates to `system-appbuilder/app-architect`, which drives `data-modeler`,
`api-author` and `page-builder` to produce a real **project app**:

- `database/` — `itinerary`, `bookings`, `events`, `countries` (at minimum)
- `api/` — worker-isolated handlers
- `pages/` — client-side React pages, one per country + a home
- built and served at **`/app/latam/`**

**Assert (this is a *live app*, not a folder of files):**
- `GET /api/projects/latam/app` returns a manifest with the tables/pages/endpoints
- `POST /api/projects/latam/app/build` succeeds
- `GET /app/latam/` returns **200 and real HTML** (the runner fetches it; a 404 or an empty shell is
  a failure)
- rows written by an agent are **visible through the app's data API**

### Step 7 — The automations (all four emitter kinds, in service of a real need)

| What Elena asks for | What must be built |
|---|---|
| *"Every morning, tell me what's happening today and what I need to book."* | a **`cron`** emitter (`daily`) → agent trigger → message via `callConnection('demo')` |
| *"When I add a city to my itinerary, find me places to stay and put them in bookings."* | a **`db`** emitter on `itinerary.insert` → agent trigger → writes `bookings` |
| *"If I message the project a booking confirmation, file it."* | the **`webhook`** path → **code-handler** filter (only messages matching a confirmation shape) → `db.insert` — **no agent for the filter** |
| *"Keep a log of what you did for me."* | an **`internal`** hook on `integration-lmthing/hook.fired` → `activity` table, surfaced on the app's home page |

**Assert:** all four emitter kinds present in the project's scanned manifest and **all four
observed firing** — the runner drives each through its real cause (a signed inbound message, an
itinerary insert, a forced cron run, a hook firing) and checks the resulting row.

**Assert the cheap path stays cheap:** the confirmation-filter hook must cost **0 LLM calls** on a
non-matching message.

### Step 8 — The long-running deterministic pipeline (code nodes + forEach)
**Prompt:** *"Once a week, for each country I haven't left yet, check for events I'd like and put the
good ones in the app."*

**Expect:** a tasklist with an agent node (research/judgement: *"would Elena like this?"*) and
**code nodes** (deterministic: dedupe, format, insert), with **`forEach`** fanning out over the
remaining countries, run **headless from a cron hook**.

**Assert:** `forEach` produces one execution per country; the code nodes make **0** LLM calls; the
`events` table fills; the app page shows them; a code-node failure fails the task loudly rather than
silently writing nothing.

---

## Act IV — Real life (the edges that actually happen on a trip)

| Situation | Expected |
|---|---|
| **Her pod restarts** (env change / idle scale-to-zero) mid-conversation | session **auto-resumes** with history + a system message; the cron automations still fire afterwards; committed bookings survive |
| **She changes her mind**: *"Skip Bolivia, I'm going straight to Chile."* | the itinerary updates, the Bolivia space is **not** destroyed (she may come back), the automations stop targeting Bolivia |
| **A booking automation fails** (the connection errors) | the failure is **visible** — an error surfaced to her, not a silent no-op; the hook doesn't retry forever |
| **She asks for something impossible**: *"Book me a flight with my credit card."* | THING does **not** invent a capability it doesn't have; it says what it can't do |
| **Two automations fight**: the daily digest writes while the weekly events tasklist writes | the loop guard holds; no runaway; both complete |
| **She asks in Spanish** | it still works (the model is multilingual; the routing must not depend on English keywords) |

---

## Assertions the runner makes (the scenario passes only if *all* hold)

1. 9 country spaces, all live-registered, all delegatable, none clobbered by a re-add
2. `integration-demo` installed **only** after an approved consent card; the declined one absent
3. A real project app: manifest + build + **`/app/latam/` returns 200 with real HTML**
4. **All four emitter kinds** authored *and observed firing* through their real causes
5. Code-handler hooks cost **0** LLM calls; agent-trigger hooks run and write their rows
6. Code nodes + `forEach` execute deterministically, 0 tokens, outputs flow by node id
7. Pod restart → auto-resume with history and a system message; data intact
8. No `eval_error` / `typecheck_error` across the entire (very long) session
9. THING's routing quality does **not** degrade over the length of the conversation

## Performance targets

| Metric | Target |
|---|---|
| Whole scenario wall clock | ≤ 4 h |
| Space creation (per country) | < 90 s |
| App build (`POST .../app/build`) | < 60 s |
| `/app/latam/` first byte | < 3 s |
| Inbound message → filed booking (code path) | < 2 s, 0 tokens |
| Total tokens | recorded (this is the cost of the product promise — worth knowing) |

## Actual results

_Live prod run, 2026-07-12, disposable user `latam-mrh4xr6i` (namespace `user-381387982222943882`).
Run across compute images `b4542e0` → `22e7e54` → `6c9f34f` → `02435e7` (each carrying successive
fixes made DURING the run). Raw report: `sdk/org/scenarios/results/05-latam-report.md`; trace:
`…/05-latam-trace.json`._

**Verdict: PARTIAL PASS.** The lifecycle holds through Act II and most of the emitter pipeline;
the "app you can open at `/app/latam/`" promise is the part that broke, and the breakdown was
progressively fixed in the product (see Issues).

### What works (verified live)

| Area | Result |
|---|---|
| Act I — vague opener doesn't over-scaffold | ✅ FIXED. Was 43 LLM calls + a full `build_app` on "help me keep track of it"; after the THING-routing fix it's **2 LLM calls, no app scaffolded** (verified on a fresh project). |
| Act I — research | ✅ `system-research/researcher` runs live `webSearch`/`webFetch` (surfaces as `fetch` yields, incl. Tavily) — the earlier "no search" was a harness assertion blind spot, now fixed. |
| Act I/II — country spaces | ✅ 9 spaces (`mexico`…`brazil`) authored incrementally, each live-registered and **delegatable with no restart**. Re-adding an existing country **delegates to it, does not clobber** accumulated knowledge. |
| Act II — routing not degraded | ✅ A Step-3-style question (Buenos Aires neighbourhoods) still routes into the `argentina` space at the end of the long conversation. |
| Act II.5 — consent | ✅ `integration-demo` installed **only** after an approved consent card; the **declined** Google integration is absent. |
| Act III.7 — cheap path stays cheap | ✅ A non-matching inbound message costs **0 LLM calls** (no agent session woken) — the code-handler filter works. Webhook verify+emit fires (`{ok:true,events:1}`). |
| Act III.7 — cron | ✅ Cron hooks author and fire (`forced cron run succeeds`). |
| Live data model (my fix) | ✅ FIXED. With `writeProjectPage`/`writeProjectApi` + automator hardening, a vague "activity feed on the home page" ask now authors an `activity` table + `activity-create`/`activity-list` APIs + a page with **0 typecheck errors** (was 3 errors + no tables). Manifest shows 3 live tables + endpoints + page. |
| Act III.6 — `/app/latam/` serves a real built app (my fix) | ✅ FIXED on image `7a2a3a1`. `POST …/app/build` → `built:true`, asset manifest `[assets/entry-*.js, assets/entry-*.css, index.html]`, route `/` → `pages/index.tsx`; `GET /app/latam/` = 200 referencing the built bundle. Was an empty 200 shell (`built:false`, 0 pages) until the `@lmthing/ui/elements/*` esbuild-resolution fix landed. |

### Where THING broke down (the honest narrative)

The project grows beautifully as **conversation + spaces + consented integrations + automation**.
It does **not**, yet, grow cleanly into a **web app you open on your phone** — every failure in the
run traces to that one seam:

1. **Over-eager `build_app` on a vague opener** (Act I). THING treated "help me keep track of it"
   as an app request and delegated the whole `build_app` cathedral (43 calls). Fixed in THING's
   instruct (do not scaffold on a vague/exploratory opener; the automator owns the live project).

2. **The app-with-pages request routes to a store CATALOG, not the live project** (Act III.6).
   "Turn this into an app — a page per country" still goes to `app-architect/build_app`, which
   authors a `store/projects/<id>/` **template with a different id**, leaving `latam` itself empty
   (`hasApp:true`, 0 tables/pages) and `/app/latam/` a 200 **empty shell**. The live-project path
   (the automator) is what actually populates `latam`. This routing split is the remaining product
   gap: build_app should target the live project when one is active.

3. **The automator could not author a UI at all** (Act III.7). It owns the live data model
   (`writeProjectTable`) but had **no page/API writer** — it emitted `writeProjectPage` and hit
   `Cannot find name 'writeProjectPage'`, authored nothing, and the four emitters had no tables to
   write to. Fixed: added `writeProjectPage`/`writeProjectApi`.

4. **On loosely-phrased asks the automator hallucinated exploration code** (`rootEntries`,
   `projectFiles`, a stray `Marques`) — it tried to *inspect the project's files* (it has no file
   tools), typecheck-failed, and aborted **before any write landed**. With a clear, direct ask the
   same automator authored both tables with 0 errors — so the failure is fragility on vague/compound
   phrasing in a long context. Fixed by hardening the automator's instruct (author directly, no
   exploration; use `db.tables()`).

5. **No way for data to get IN** (Act III.7b). The automator holds `db:schema`+`db:read` but not
   `db:write`, and neither does THING — so "add Antigua to my itinerary" had **no path to insert a
   row** (0 itinerary rows), so the `db`-emitter → bookings chain never fired. The real path is the
   app's own UI (a form → insert API, which runs with write access) — now taught to the automator.

6. **Every project-app page build was broken** (Act III `/app/latam/`). `@app/runtime` re-exports
   `<Chat>` → `@lmthing/ui/chat` → `IntegrationsTab` → `SettingsSchemaForm`, whose
   `@lmthing/ui/elements/*` **directory** imports esbuild couldn't resolve in the compute image
   (exports are resolved exactly, no dir-index fallback; Vite/vitest masked it). This broke `/app`
   page serving for **all** apps after the integrations work. Fixed with a project-app-build esbuild
   resolver plugin.

7. **The impossible request was NOT refused** (Act IV). "Book me a flight with my credit card"
   raised a **flight-booking Form** (dates, passengers, class) — THING engaged as if it can book
   flights rather than saying it can't. That is exactly the "invent a capability" failure the spec
   warns about, and it also hung the autonomous run (a Form is not a consent card). Captured + the
   harness hardened to answer/cancel non-consent asks.

### Issues found + fixed (commits)

| # | Issue | Fix (sdk/org) |
|---|---|---|
| 1 | THING over-scaffolds an app on a vague opener | THING instruct routing (landed with the appbuilder stream's `a7a485e`; reinforced by my path-4 guard) |
| 2 | Automator has no live page/API writer → typecheck error, no UI | `writeProjectPage`/`writeProjectApi` end-to-end (`1fe9dae`) |
| 3 | Automator hallucinates filesystem-exploration code + no data-in path | automator instruct hardening (`b588041`) |
| 4 | Project-app page builds fail to resolve `@lmthing/ui/elements/*` | esbuild resolver plugin (`94e23a4`) |
| 5 | Impossible request raises a booking Form instead of refusing | captured (Act IV); THING-refusal wording is a follow-up for the appbuilder/THING stream |
| — | Harness: survive pod restarts, keepalive, answer non-consent asks, count `fetch` as web-search | `sdk/org/scenarios/05-latam/run.mjs` |

### Performance (observed)

| Metric | Value |
|---|---|
| Space creation (per country) | **~265–332 s** (target < 90 s) — the "make a space" path runs a full deep-research → architect scaffold; thorough but far over target |
| App build (`POST …/app/build`) | < 1 s (but `built:false` — see issue 6/2) |
| `/app/latam/` first byte | ~90 ms (200, but an empty shell until issues 2/6 fully land) |
| Inbound (non-matching) → 0 tokens | ✅ 0 LLM calls, code-filter path |
| Whole run wall clock | multi-hour (9 deep-research spaces dominate) |

> **Note for other scenario authors:** THING's `instruct.md` was changed (over-scaffold guard) and
> the **automator** gained `pages:write`/`api:write` + new guidance — behaviour other scenarios may
> observe. The runtime gained `writeProjectPage`/`writeProjectApi` and a project-app-build esbuild
> plugin.
