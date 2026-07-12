# Live prod scenarios

Five high-complexity, end-to-end scenarios that exercise the **system spaces** (`system-appbuilder`,
`system-architect`, `system-research`, `system-store`, `system-engineer`) and the **unified event
pipeline** through the **THING agent**, against the **live production cluster and a live LLM**.

Every scenario runs as a real user would: a disposable prod test user, a real compute pod, a real
THING chat session, real model calls. Nothing is mocked. If a scenario passes, the feature works in
production — not in a unit test.

| # | Scenario | Covers |
|---|---|---|
| [01](./01-newsroom-multispace-events.md) | **Newsroom** — one project, three installed spaces, all four emitter kinds | new project + multi-space install; `webhook`/`cron`/`db`/`internal` emitter defs; code-handler vs agent-`trigger` hooks |
| [02](./02-consent-and-store.md) | **Consent & Store** — discovery, the consent card, and everything that must NOT happen | `system-store/finder`; `installSpace` consent approve **and** deny; `@consent` space functions; fail-closed in headless paths; store error edges |
| [03](./03-resilience-storm-loops-resume.md) | **Resilience** — storms, cycles, and a pod restart mid-flight | high-frequency event bursts; coalescing, depth cap, cooldown, self-trigger exclusion; pod restart → auto-resume + system message |
| [04](./04-signals-and-code-nodes.md) | **Signals & Code nodes** — the runtime observing itself | `integration-lmthing` internal signals; `emitEvent`; multi-tasklist DAG with **code nodes**, `dependsOn`/`forEach` output flow |
| [05](./05-latam-trip-lifecycle.md) | **Latin America** — six months, nine countries, one growing project | the full lifecycle: incremental space growth, integrations, a THING-controlled **project app** automating bookings/transport/notifications, live in the project web app |

## Running one

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                 # prove the harness + prod are healthy first (≈1 min)
node ../01-newsroom/run.mjs    # a scenario's runner writes its own report
```

Each scenario directory holds a `run.mjs` (the executable spec) and writes
`sdk/org/scenarios/results/<id>-report.md` plus a raw trace JSON. The **Actual results** section of
each scenario `.md` is pasted back from that report, so the document is both the plan and the record.

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
  no prompter and **fail closed** — that is the designed behaviour and scenario 02 asserts it.
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
