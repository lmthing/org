# Live prod scenarios

Two high-complexity, end-to-end scenarios that exercise the **system spaces** (`system-appbuilder`,
`system-architect`, `system-research`, `system-store`, `system-engineer`) and the **unified event
pipeline** through the **THING agent**, against the **live production cluster and a live LLM**.

Every scenario runs as a real user would: a disposable prod test user, a real compute pod, a real
THING chat session, real model calls. Nothing is mocked. If a scenario passes, the feature works in
production — not in a unit test.

| # | Scenario | Covers |
|---|---|---|
| [05](./05-latam/scenario.md) | **Latin America** — six months, nine countries, one growing project | the full lifecycle: incremental space growth, integrations, a THING-controlled **project app** automating bookings/transport/notifications, live in the project web app |
| [06](./06-tanzania/scenario.md) | **Tanzania trip** — one attachment becomes spaces + a live, updatable app | file ingest (`system-files`); per-leg spaces; live-project app (`writeProjectTable`/`Page`/`Api` + rows seed); `db:write` later-update; compound + multilingual ask |

## Running one

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                 # prove the harness + prod are healthy first (≈1 min)
node ../05-latam/run.mjs        # a scenario's runner writes its own report
```

Each scenario directory holds a `scenario.md` (the spec) and a `run.mjs` (the executable spec), and
writes `sdk/org/scenarios/<id>/results/report.md` plus a raw trace JSON. The **Actual results**
section of `scenario.md` is pasted back from that report, so the document is both the plan and the
record.

## Authoring a new scenario — the format + the workflow

Two complementary references, plus a copy-and-fill template:

- **[SCENARIO-FORMAT.md](./SCENARIO-FORMAT.md)** — the canonical **format** for a scenario: the exact
  six-section document structure, the **feature catalog** (everything a scenario can/should exercise —
  THING routing, spaces, the four emitter kinds + hooks + code nodes, consent + capabilities, store +
  integrations, project-apps + the seed/update writers, attachments, pod lifecycle), the **validation
  process** (assert on the trace + real state, not prose; harness-bug vs product-bug triage; recovered
  vs fatal errors), the **harness API**, and the definition of done.
- **[PLAYBOOK.md](./PLAYBOOK.md)** — the **process** of running one and fixing what it finds: the
  product-fix + image-rebuild-verify loop (7-char tags, pod upgrade, hot-patching a system-space
  prompt, CI-rebase gotchas), the re-wake discipline for babysitting a multi-hour run, and the
  reporting template.
- **[`_template/`](./_template/)** — `cp -r _template <NN-slug>`, then fill **`<NN-slug>/scenario.md`**
  (the six-section spec with a feature checklist) and **`run.mjs`** (the runner
  scaffold — checkpoint/resume, keepalive, resilient send, scripted asks, and attachment + live-app +
  signed-inbound helpers all pre-wired; replace the `SCENARIO_*` config and write the Acts).

To start: `cp -r _template 07-myscenario`, then fill `07-myscenario/scenario.md` and `run.mjs`.

**Quick start:**
```bash
cd sdk/org/scenarios/harness
node smoke.mjs                       # prove the harness + prod are healthy (≈1 min)
node ../07-myscenario/run.mjs        # run it; writes 07-myscenario/results/report.md
```

## The harness

`harness/` is zero-dependency Node ESM. It drives the pod's HTTP API directly — no browser needed —
because the pod exposes the whole surface the `/chat` SPA uses (`sdk/org/libs/cli/src/server/`):

```js
import { getUser } from './provision.mjs';            // register → pod → Azure keys → ready
import { Pod } from './lib/pod.mjs';                  // projects, files, store, hooks, inbound, app
import { ThingSession, approveAllConsent } from './lib/thing.mjs';
import { Report } from './lib/report.mjs';            // → the markdown results table

const user = await getUser('my-scenario');
const pod = new Pod({ base: user.pod, token: user.token });
const thing = new ThingSession(pod, { onAsk: approveAllConsent, verbose: true });
await thing.start();                                   // POST /api/sessions  (interactive!)
const turn = await thing.send('install a slack integration and watch #eng');

turn.delegates;      // ['system-store/finder/…', 'system-appbuilder/automator/…']
turn.yields;         // every global THING called, incl. installSpace
turn.tokens;         // { in, out }
thing.consentCards() // every ConsentCard raised, and how it was answered
```

### Why assertions read the trace, not the prose

The pod streams the full execution trace (`libs/core/src/sandbox/trace.ts`), so a scenario asserts on
what the agent **did** — which specialist it delegated to, which consent-marked global it called,
which yields resolved, which hooks fired, how many tokens it burned — instead of grading a paragraph
of English. A scenario that only checks the final message is a scenario that passes when the system
is broken.

### Things the harness learned the hard way

- **Consent needs an interactive session.** The consent prompter is only wired when
  `POST /api/sessions` created the session. Headless paths (hooks, delegates, webhook dispatch) have
  no prompter and **fail closed** — that is the designed behaviour (a scenario should assert it, not work around it).
- **`PUT /api/compute/env` rolls the pod, and sessions are in-memory.** A session created against
  the old replica dies with it (`404 unknown session`). `provisionUser()` therefore loads env
  *before* the first turn, skips the PUT when nothing changed, and then proves a session survives
  before handing the pod over (`waitPodSettled`).
- **`pod.ready` is `readyReplicas > 0`**, which is true throughout a rolling update and precedes
  Envoy wiring the new endpoint. Never treat it as "my next request will land on the new pod".
- **The gateway JWT secret is double-base64.** `.data.GATEWAY_JWT_SECRET` in k8s decodes to the env
  *value*, which is itself base64 of the signing key. Decode once when fetching, once when signing.

## Budget

Scenarios burn real tokens. `provisionUser()` loads the **direct Azure** keys from `sdk/org/.env`
into the pod env, so agent traffic bypasses the per-user LiteLLM key that carries the tier budget —
a run cannot be halted by a tier cap mid-scenario. If a pod ever is capped, provision a new user
(`node provision.mjs <label>`) and re-run; test users are disposable by design.

Test users are named `<label>-<base36-ts>@lmthing.test` and each gets its own `user-<id>` namespace
and pod. Clean up with `kubectl delete ns user-<id>`.
