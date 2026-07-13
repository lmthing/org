# Scenario NN — <Title>: <the promise in a phrase>

> Keep this file as `<NN-slug>/scenario.md` and fill every section. Structure + rules:
> `automation/instances/scenario-campaign/prompt.common.md`. Delete these quote lines when done.

> **One line.** <What the user is trying to do, in a sentence. The whole scenario serves this.>

**Persona.** <Who they are, what they already have, what they want. Concrete, not generic.>

**Why this scenario exists.** <The PROMISE under test — the product claim this proves or breaks. Name
the feature slice and any known gap it is meant to close.>

---

## 1. The user flow (what the user actually does)

| # | Step (in the UI) | What the user does |
|---|---|---|
| 1 | <e.g. Create a project> | <names it `<project>`> |
| 2 | <e.g. Attach a file> | <attaches `<file>`> |
| 3 | **Ask, once** | sends the message below |

> *"<the EXACT message the user sends — verbatim; the runner reproduces this>"*

| 4 | <Watch it build> | <what they see happen> |
| 5 | <Use the result> | <open `/app/<id>/`, ask a follow-up, …> |
| 6 | <Keep going> | <the later message(s) that must also work> |

---

## 2. What the user expects (the contract)

In the user's terms — success is:

1. **"<expectation>."** <the observable that proves it>
2. …

**Anti-expectations (a failure even if the chat looks fine):**
- <e.g. a summary but no spaces/app → "it just answered me">
- <e.g. an app that opens but is empty → "where's my stuff?">
- <e.g. "noted!" with no DB change → "it didn't save it">

---

## 3. What happens in the background (the choreography)

Hop by hop, for maintainers:

1. <UI/API action — e.g. `POST /api/projects`>
2. <e.g. attachment upload → AttachmentRef>
3. <e.g. message over WS carries the attachment>
4. <THING triage → which path → which delegate(s)>
5. <the specialist(s) → the authoring writers → the DB / event pipeline>
6. <serving / later updates>

Name the moving parts (agents, globals, routes) so a reader learns where each step can break.

---

## 4. User stories

- **US-1 — <name>.** *As a <persona>, I want <capability>, so that <outcome>.*
  **Accept:** <the observable fact that proves it — a trace signal or real state>.
- **US-2 — …**

---

## 5. Feature coverage (tick what this scenario exercises — see the feature catalog in the campaign prompt)

- THING routing: [ ] answer [ ] research [ ] build space [ ] app-4a (automator) [ ] app-4b (build_app)
  [ ] code (engineer) [ ] memory [ ] install+automate [ ] compound request [ ] provided-info shortcut
  [ ] restraint/refusal [ ] multilingual
- Spaces: [ ] create per-part [ ] live-registered/delegatable [ ] no-clobber re-add
- Event pipeline: [ ] webhook [ ] cron [ ] db [ ] internal · [ ] code-handler hook [ ] agent-trigger
  hook · [ ] code nodes [ ] forEach · [ ] project functions · [ ] loop guard [ ] payload validation
  [ ] emitEvent
- Consent/caps: [ ] @consent [ ] installSpace approve/deny [ ] fail-closed headless [ ] capability gating
- Store/integrations: [ ] discovery [ ] install a space [ ] callConnection [ ] inbound webhook
  [ ] integration-demo source
- Project-app: [ ] writeProjectTable(+rows seed) [ ] writeProjectPage/Api [ ] db:write later-update
  [ ] app build [ ] /app/<id>/ serving [ ] app data API
- Attachments: [ ] upload [ ] readDocument [ ] attachmentIds to a specialist [ ] vision/audio
- Pod lifecycle: [ ] restart→auto-resume [ ] cold-wake [ ] event storm [ ] worker containment
- Cross-cutting: [ ] edge cases/errors [ ] performance [ ] budget

---

## 6. Acceptance criteria (the Acts)

The runner (`NN-<slug>/run.mjs`) drives these and asserts on the **trace + real pod state**. Acts here
must match the runner 1:1.

| Act | Asserts (trace + real state) | Stories |
|---|---|---|
| **I — <name>** | <what must be observably true> | US-1 |
| **II — <name>** | … | US-2 |
| … | | |

*Performance targets are **hang detectors, not SLOs**. Record the ACTUAL time as a metric on every
Act; only FAIL when a ceiling below is breached — that means something is broken, not merely slow.*

### Performance targets
Keep only the rows this scenario has Acts for; add scenario-specific rows using the nearest value
below. This is the full canonical default list:

| Metric | Target |
|---|---|
| Multi-attachment ingest turn (upload + transcribe + vision + triage) → THING's offer | < 5 min |
| A plain chat turn (no authoring, no research) | < 2 min |
| A research turn (webSearch/webFetch → a researched row) | < 8 min |
| Research → one new specialist space, live-registered | < 10 min |
| The WHOLE build after "yes" (research + spaces + app + seeded rows) | < 45 min |
| An authoring turn that adds a table / page / section | < 10 min |
| App build (`POST …/app/build`) | < 90 s |
| Served app first byte — warm pod | < 5 s |
| Served app first byte — cold pod (scaled to zero) | < 2 min |
| Forced agent-trigger hook / cron run (a real LLM turn) | < 5 min |
| Code-`handler` hook run | < 15 s **and 0 LLM calls** |
| Signed inbound webhook → row | < 2 min |
| Event storm (15 signed webhooks) → all processed, none lost | < 5 min |
| Pod restart → session auto-resumed | < 5 min |
| In-app chat message → the change is live in the running app | < 10 min |
| Whole scenario wall clock | ≤ 4 h |
| Unrecovered eval/typecheck errors | **0** (hard fail) |

---

## 7. What this scenario is really testing (and any gap it closes)

<The feature(s) under test. If it exposes/closes a product gap, say what and how — this is where the
scenario earns its keep.>

## 8. Running it

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                    # prove harness + prod healthy first
node ../NN-<slug>/run.mjs         # fresh; writes NN-<slug>/results/report.md
node ../NN-<slug>/run.mjs --reuse # reuse the cached user + project
```

## Actual results

_Filled in by the runner — paste from `results/report.md` after a run._
