# Live scenarios — `@lmthing/scenario-harness`

High-complexity, end-to-end scenarios that exercise the **system spaces** (`system-appbuilder`,
`system-architect`, `system-research`, `system-store`, `system-engineer`) and the **unified event
pipeline** through the **THING agent**, against a real `lmthing serve` and a **live LLM**. Nothing is
mocked: a real project, a real THING chat session, real model calls. If a scenario passes, the
feature works.

A scenario is a **single declarative `scenario.yaml`** (persona · promise · invariants · knows ·
steps) plus a **`fixtures/`** dir of real input files. It is played by the **generic runner**
`run-yaml.mjs`, which drives the pod exactly as the `/chat` SPA would and writes per-step
**evidence** for a separate **judge** to score — the runner never judges.

| # | Scenario | Covers |
|---|---|---|
| [06](./06-tanzania/scenario.yaml) | **Tanzania trip** — one attachment dump becomes spaces + a live, updatable app | file ingest (vision/audio/PDF/xlsx); per-leg spaces; live-project app (`writeProjectTable`/`Page`/`Api` + row seed); `db:write` later-update; compound + multilingual ask; query-not-remember; retraction hard-delete |
| [07](./07-life-admin/scenario.yaml) | **Life admin** — a drawer of household paperwork becomes a vault he can check | multi-file ingest; knowledge vs DB placement; hooks/events; pod restart survival |

## Running one

Local by design (`SCENARIO_TARGET=local` → `http://localhost:8080`, no auth): a product fix is
`pnpm build` + a server restart (seconds), not a prod image roll (minutes).

```bash
# 1. build the CLI and bring up a throwaway `lmthing serve` on :8080
cd sdk/org && pnpm --filter @lmthing/cli... build
node scenarios/harness/local-server.mjs up

# 2. dry-run the plan (no pod) — prints the steps + a fixture-coverage audit
node scenarios/run-yaml.mjs 06-tanzania --plan

# 3. play it — wipes the pod root, plays every step, writes evidence to 06-tanzania/.run/
node scenarios/run-yaml.mjs 06-tanzania --fresh-server
```

Flags: `--through N` (play steps 1..N — the judge's verify rerun) · `--out <dir>` (evidence dir,
default `<sc>/.run`) · `--project <id>` · `--fresh-server` (wipe the runtime root first) · `--plan`
(parse + print, never connect) · `--verbose` · `--keep-project`.

**Evidence** (per step, in `.run/`): `step-NN.json` (the compact observables the judge scores — space
names, table row COUNTS, delegate names, yield kinds+counts, errors, the reply, the asks),
`step-NN.full.json` (the raw drill-down dump), `trace.md` (human-readable), `summary.json`. The runner
also writes `runner.pid` (a stopper does `kill $(cat .run/runner.pid)`). The judge prompt lives at
`automation/instances/scenario-campaign/judge.md`.

## Authoring a new scenario

```bash
cp -r _template 08-myscenario          # a scenario.yaml skeleton + an empty fixtures/
# fill 08-myscenario/scenario.yaml, drop real files in 08-myscenario/fixtures/
node scenarios/run-yaml.mjs 08-myscenario --plan   # sanity-check the plan + fixture coverage
```

The full step-verb spec (`say`, `then_say`, `in_app_chat`, `open_app`, `attach[]`, `fresh_session`,
`restart_pod`, `if_asked{}`, `deny_consent`, `expect[]`) lives with the campaign automation in
`automation/instances/scenario-campaign/scenario-spec.md`.

## The package

`scenarios/` is `@lmthing/scenario-harness` (a script-free workspace package — no build step; run by
raw `node`). Its public surface is the barrel `index.mjs`; the runner engine is `lib/`:

```js
import { runScenario, loadScenario, Pod, ThingSession, getUser } from '@lmthing/scenario-harness';
// or, as the runner does, import ./lib/* and ./harness/* directly.

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

- `lib/` — `scenario.mjs` (`loadScenario`/`planLines`), `runner.mjs` (`ScenarioRunner`/`runScenario`),
  `evidence.mjs` (`compactStep`/`traceLines`/`snapshot`), `asks.mjs` (`StepAsks`), `errors.mjs`. The
  pure transforms are golden-tested against recorded run output (`lib/*.test.mjs`).
- `harness/` — the pod client the runner drives: `provision.mjs` (`getUser`), `lib/pod.mjs` (`Pod`),
  `lib/thing.mjs` (`ThingSession`), `lib/local.mjs` (the local-server lifecycle), `lib/gateway.mjs`
  (the prod-provisioning path used by `smoke.mjs`), `lib/report.mjs` (`Report`), `jwt.mjs`, `paths.mjs`.
- `harness/smoke.mjs` — register → pod → env → THING session → a real LLM turn → trace assertions; run
  it to prove the harness + a target are healthy before a long run.

### Why assertions read the trace, not the prose

The pod streams the full execution trace (`libs/core/src/sandbox/trace.ts`), so a scenario asserts on
what the agent **did** — which specialist it delegated to, which consent-marked global it called,
which yields resolved, which hooks fired, how many tokens it burned — instead of grading a paragraph
of English. A scenario that only checks the final message is a scenario that passes when the system
is broken. That is exactly what `step-NN.json` records for the judge.

### Things the harness learned the hard way

- **Consent needs an interactive session.** The consent prompter is only wired when
  `POST /api/sessions` created the session. Headless paths (hooks, delegates, webhook dispatch) have
  no prompter and **fail closed** — that is the designed behaviour (assert it, don't work around it).
- **`--fresh-server` wipes the runtime root**, so every run starts from zero projects (the "from
  scratch" guarantee the judge relies on). A clean pod still has the built-in `system`/`user`
  projects — those are infrastructure, not state leak.
- **The local server is process-shared and keyed by `LM_LOCAL_PORT`.** A `restart_pod` in one lane
  drops every other lane's in-memory session; the harness re-resumes from the persisted id. A lane
  that needs isolation sets its own `LM_LOCAL_PORT`.
- **`PUT /api/compute/env` rolls the pod (prod path), and sessions are in-memory.** A session created
  against the old replica dies with it; `provisionUser()` loads env *before* the first turn and proves
  a session survives before handing the pod over.
- **The gateway JWT secret is double-base64.** `.data.GATEWAY_JWT_SECRET` in k8s decodes to the env
  *value*, which is itself base64 of the signing key. Decode once when fetching, once when signing.

## Budget

Scenarios burn real tokens. `agentEnvFromSdk()` loads the **direct Azure** keys from `sdk/org/.env`
into the pod env, so agent traffic bypasses the per-user LiteLLM key that carries the tier budget — a
run cannot be halted by a tier cap mid-scenario. Prod test users are `<label>-<base36-ts>@lmthing.test`,
each with its own `user-<id>` namespace and pod; clean up with `kubectl delete ns user-<id>`.
