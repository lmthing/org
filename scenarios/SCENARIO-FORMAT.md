# Scenario format — how to author a live-prod scenario

This is the canonical spec for a **scenario**: what it is, the exact shape of its document, the
**feature catalog** it should draw from, and the **validation process** that makes it trustworthy.
It is the companion to [PLAYBOOK.md](./PLAYBOOK.md) (the *process* of running one and fixing what it
finds) — this file defines the *artifact*.

> A scenario is not a unit test. It is a **promise, exercised end-to-end through the THING agent
> against live production**, and asserted on **real system state** — the trace of what the agent
> did, and the actual spaces / app / database rows it produced. If a scenario passes, the feature
> works in prod. A scenario that only grades the model's prose passes when the system is broken.

Every scenario is TWO files plus its results:

```
NN-<slug>.md              # the SPEC + the recorded results (the document, this format)
NN-<slug>/run.mjs         # the executable runner (from _template/run.mjs)
NN-<slug>/fixtures/…      # any input files (attachments, seed data) — self-contained
results/NN-<slug>-report.md          # generated: the Actual-results table
results/NN-<slug>-trace.json         # generated: the full execution trace (evidence)
results/NN-<slug>-checkpoint.json    # generated: per-Act resume state
```

New scenario? `cp -r _template <NN-slug>`, fill `scenario.md` → `NN-<slug>.md`, fill `run.mjs`.

---

## 1. The document structure (the `.md`)

Written for a human who will read it before they run anything. Six sections, in this order — this is
the structure scenario 06 uses and the one `_template/scenario.md` ships:

1. **One line + persona.** Who the user is and the single sentence of what they're trying to do.
2. **The user flow** — the literal UI-level steps the user takes (create project, attach file, send
   *this exact message*, open the app, …). Quote the real message verbatim. This is what the runner
   reproduces.
3. **What the user expects (the contract)** — in the *user's* terms, not the system's. A numbered
   list of what "it worked" means to them, plus the **anti-expectations**: things that are a failure
   even if the chat looks fine (an empty app, a "noted!" with no DB change, data in the wrong
   project). This section is the acceptance bar in plain language.
4. **What happens in the background (the choreography)** — the hop-by-hop system reality under the
   request, for maintainers: upload → `system-files` read → THING triage → delegate(s) → the
   authoring writers → the DB → the event pipeline. Name the moving parts. This is where a reader
   learns *why* a step can break.
5. **User stories** — `As a <persona>, I want <capability>, so that <outcome>`, each with a concrete
   **acceptance signal** (the observable fact that proves it). One per distinct capability the
   scenario claims.
6. **Acceptance criteria (the Acts)** — the executable spec: a table mapping each **Act** to what it
   asserts (on the trace + real state) and which user stories it covers, then a **performance
   targets** table. The runner's Acts must match this table 1:1.

Then two trailing sections the runner/author fill:
- **What this scenario is really testing** — the feature(s) under test and any known gap it closes.
- **Actual results** — pasted from `results/NN-<slug>-report.md` after a run (verdict + per-Act
  table + issues + perf). The document is both the plan and the record.

---

## 2. Feature catalog — what a scenario can (and should) exercise

Draw the scenario's Acts from this catalog. A good scenario covers a *coherent slice* end-to-end, not
one isolated call. The `_template/scenario.md` carries this as a checklist so you tick what applies.

### A. THING triage & routing (`user-thing/agents/thing`)
- **Answer directly** (no delegation) · **Research** (`system-research/researcher`
  `research`/`deep_research`, live `webSearch`/`webFetch`) · **Build a specialist space**
  (`build_specialist` tasklist → `system-architect`) · **Build an app** — **4a** in the *live
  project* (`system-appbuilder/automator`) vs **4b** a *new catalog template*
  (`app-architect/build_app`) · **Write/fix code** (`system-engineer`) · **Remember**
  (`user-memory`) · **Install + automate an integration** (`system-store/finder` → consent
  `installSpace` → `automator`).
- **Compound requests** — one message naming >1 deliverable ("create spaces AND build an app") must
  do EACH.
- **Provided-info shortcut** — when the material is already attached/in-conversation, build spaces
  **directly from it** (skip deep research).
- **Restraint** — do NOT scaffold a heavyweight app/space on a vague opener; do NOT invent a
  capability it lacks (refuse "book me a flight"). Multilingual routing (don't key off English).

### B. Spaces & the agent runtime
- Create per-topic/per-part **spaces** (agent + knowledge), **live-registered** (delegatable with no
  restart), **no-clobber** on re-add. Delegating INTO a built space (`delegate`, `registerSpace`).
- Runtime globals: `display`/`ask`/`setSessionMeta`/`fork`/`delegate`/`tasklist`/`loadKnowledge`.

### C. The unified event pipeline (`@.claude/skills/events-and-hooks.md`)
- All **four emitter kinds**: `webhook` (HMAC/verify-before-emit), `cron` (`every`/`daily` +
  `ctx.state` cursor), `db` (synthetic `project/db.<table>.<event>` + curated defs), `internal`
  (the `integration-lmthing` signal set).
- **Event hooks**: code `handler`-as-filter (0 LLM cost) vs agent `trigger`.
- **Code nodes** in space tasklists (`NN-<id>.ts`, `node` metadata, worker-isolated), `dependsOn`,
  `forEach`, output-by-node-id.
- **Project functions** (the third function scope).
- **Loop guard**: coalescing, depth cap, self-write/self-trigger exclusion, per-hook cooldown,
  budget-pending. **Payload validation** (undeclared/mistyped dropped). **`emitEvent`** (`events:emit`).

### D. Consent & capabilities
- `@consent` (generic, host-enforced, **fails closed** in headless) · `installSpace` consent card
  (approve AND deny AND every non-approval answer) · capability gating enforced at typecheck
  (`store:read/install`, `events:emit`, `db:read/write/schema`, `hooks:write`, `pages:write`,
  `api:write`, `connections:use`).

### E. Store & integrations
- `storeSearch`/`storeInspect` discovery · install a space from the catalog · `integration-*`
  messaging spaces · `callConnection` (gated, SSRF-pinned) · inbound webhooks
  (`/api/inbound/<path>`, provider verify) · the `integration-demo` provider-free test source.

### F. Project-as-application
- The live-project authoring writers: `writeProjectTable(name, schema, rows?)` (**seed known data**),
  `writeProjectPage`, `writeProjectApi`, `writeProjectHook`, `writeProjectEvent`,
  `writeProjectFunction`. · `db:write` for **later updates**. · `POST /app/<id>/build` → compiled
  assets · serving at **`/app/<id>/`** · the app data API (`/api/projects/<id>/app/data/<table>`).

### G. Attachments (`system-files` / `system-vision`)
- Upload (`POST /api/uploads`, kind image/audio/file) · deliver WITH a message (WS path) ·
  `readDocument` (text/markdown/pdf) · hand an attachment to a specialist via `attachmentIds` ·
  vision for images, transcription for audio.

### H. Pod lifecycle & resilience
- Restart → **auto-resume** + system message · scale-to-zero **cold-wake** · `maxSessions`
  behaviour · high-frequency event **storms** (throughput, event-loop not starved) · worker
  containment of a throwing/hanging space emitter.

### I. Cross-cutting
- **Edge cases & error handling** (bad signature → 401, unknown path → 404, malformed → 0 events,
  a failing automation surfaces its error) · **performance** (latency, tokens, throughput) ·
  **multilingual** · **budget** (runs use direct Azure keys, so a tier cap can't halt a run).

---

## 3. The validation process (how a scenario earns trust)

### 3.1 Assert on the trace + real state, never prose
The pod streams the full execution trace (`libs/core/src/sandbox/trace.ts`). The harness surfaces it
as `turn.delegates` / `turn.yields` / `turn.errors` / `turn.tokens` / `thing.consentCards()`, and the
`Pod` client reads the real side effects (`listSpaces`, `fsTree`/`readFile`, `appManifest`/`appBuild`/
`appData`, `listIntegrations`). Every check must key off one of these — *what the agent did* or *what
actually exists* — not the wording of a `display()`.

- **Good:** `flights` table has ≥5 rows whose contents match the file; THING `didDelegate('system-appbuilder')`; a signed inbound with a bad HMAC returns 401 and writes 0 rows.
- **Bad:** the reply "contains the word booked"; the summary "mentions Cairo".

### 3.2 Distinguish a harness bug from a product bug
When a check fails, decide which it is *before* changing anything (read the trace + `kubectl logs`):
- **Product bug** → fix it in `sdk/org/libs/{core,cli}` or a specialist's `instruct.md`, with a unit
  test that would have caught it. This is the point of the campaign.
- **Harness/assertion bug** → fix the assertion to be **accurate and, where possible, stronger** —
  never merely looser to force green. (S06: the "app built" check read the wrong manifest field and
  skipped the explicit build; the fix was to *compile the app and assert real assets*, a stronger
  check — not to drop it.)
- **Recovered vs fatal errors** — a `typecheck_error`/`eval_error` the eval loop retried and the
  deliverable still landed is the retry surface, not a failure. Hard-assert the **deliverable**;
  record recovered errors as a metric + note (point at the owning follow-up). Never hide them, never
  fail the whole scenario on them.

### 3.3 Run it for real, resumably
- Provision a disposable prod user; load env/secrets **before** the first session (a `PUT env` rolls
  the pod). Reuse a patched pod when instruct fixes aren't yet in a compute image.
- **Checkpoint after every Act**; a long run resumes from the last good Act.
- Drive it as a **`run_in_background` Bash process** (the only mechanism that re-wakes a stopped
  babysitter) — never a Monitor/poll/cron.
- The harness is resilient by construction (§4): it survives session eviction, cold-wake 504s, and
  a pod roll mid-turn.

### 3.4 Verify a code fix actually shipped
Instruct/prompt fixes to a materialized system space can be **hot-patched** onto the test pod
(`patch-instructs.mjs`) and reloaded with a restart — verify live without a rebuild. **Runtime** code
fixes need a new compute image: push the submodule → bump the parent pointer → CI builds
`compute:<7-char-parent-sha>` → `kubectl set image` the test pod → re-run. (Watch: 7-char tags, and
ArgoCD selfHeal can revert a manual image set.)

### 3.5 Report honestly
Verdict (PASS / CONDITIONAL / FAIL), the per-Act table, **every issue found + whether fixed (sha)**,
the performance table, and the **honest narrative of where the product broke down** — the single most
valuable output. A "CONDITIONAL PASS" with a documented residual beats a green checkmark that hid a
gap.

---

## 4. The harness API (what the runner is built on)

Zero-dependency Node ESM in `harness/`. Drives the pod's HTTP + WS API directly (no browser).

```js
import { getUser } from '../harness/provision.mjs';          // register → pod → Azure keys → ready+settled
import { Pod } from '../harness/lib/pod.mjs';                 // projects, spaces, files, store, apps, hooks, inbound, uploads
import { ThingSession, approveAllConsent, denyAllConsent } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';           // → the Actual-results markdown + trace

const user = await getUser('my-scn');                          // { userId, token, pod }
const pod  = new Pod({ base: user.pod, token: user.token });
const thing = new ThingSession(pod, { projectId, onAsk: approveAllConsent, verbose: true });
await thing.start();

const turn = await thing.send('do the thing');                 // text turn
const att  = await pod.upload('fixtures/notes.md');            // → AttachmentRef
const t2   = await thing.sendWithAttachments('use this', [att]);// WS path (HTTP /message drops attachments)

turn.delegates          // ['system-store/finder/…', 'system-appbuilder/automator/…']
turn.yields             // every global THING called (installSpace, emitEvent, …)
turn.errors             // eval/typecheck errors this turn (classify recovered vs fatal)
turn.tokens             // { in, out }
thing.consentCards()    // every ConsentCard raised + how it was answered
await pod.listSpaces(projectId)                                // real spaces on disk
await pod.appBuild(projectId)                                  // { built, assetManifest, routes }
await pod.appData(projectId, 'flights')                        // real DB rows
await pod.inbound('demo', signedBody, { 'x-demo-signature': sig })  // deliver a webhook

const r = new Report('my-scn', 'title');
r.step('Act I — …', 'expected'); r.check('label', pass, actual); r.metric('turn', s, 's');
r.save('results/my-scn-report.md'); r.saveTrace('results/my-scn-trace.json', thing);
```

### Resilience built into `ThingSession` (do not re-solve these)
- **Session eviction** — a long turn spawns many delegate sub-sessions; a small pod (`MAX_SESSIONS`,
  default 8, free tier 3) may evict the top-level session right after its turn. `pullEvents()` treats
  a `404` as a soft `sessionGone` (turn complete if work was seen); `#ensureAlive()` re-establishes an
  evicted session before the next send (the project's spaces/app/db persist on disk regardless). Raise
  `MAX_SESSIONS` on the test pod (`kubectl set env deployment/lmthing MAX_SESSIONS=25 -n user-<id>`)
  for a session-heavy scenario.
- **Cold-wake 504** — a scaled-to-zero pod answers `504 {waking:true}`; `Pod.req`/`Pod.inbound` retry
  until warm.
- **Consent/asks mid-turn** — `onAsk` answers consent cards (and settles any other Form with a
  default) so an autonomous run never hangs.

### Gotchas the harness already encodes (from the campaign)
- The gateway JWT secret is **double-base64** (decode once fetching, once signing).
- `PUT /api/compute/env` **rolls the pod** and sessions are in-memory → load env before the first turn.
- `pod.ready` = `readyReplicas>0` (true throughout a rolling update) → use `waitPodSettled`.
- Consent needs an **interactive** session (`POST /api/sessions`); headless paths fail closed.
- The `built` flag is at `manifest.build.built`; the authoritative check is `POST /app/build` +
  real assets in the returned `assetManifest`.

---

## 5. Definition of done

A scenario is done when:
- [ ] the `.md` has all six sections + the feature checklist + the Acts table;
- [ ] `run.mjs` reproduces the literal user flow and its Acts match the `.md` table 1:1;
- [ ] every assertion reads the trace or real state (no prose grading);
- [ ] it **runs e2e live against prod** and reaches a verdict (fixes made for every product bug found,
      each with a test);
- [ ] `results/` has the report + trace; the `.md` Actual-results section is filled;
- [ ] the report carries the honest narrative and every fix's commit sha.
