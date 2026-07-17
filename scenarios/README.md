# Live scenarios — `@lmthing/scenario-harness`

High-complexity, end-to-end scenarios that exercise the **system spaces** (`system-appbuilder`,
`system-architect`, `system-research`, `system-store`, `system-engineer`) and the **unified event
pipeline** through the **THING agent**, against a real `lmthing serve` and a **live LLM**. Nothing is
mocked: a real project, a real THING chat session, real model calls. If a scenario passes, the
feature works.

A scenario is a **single declarative `scenario.yaml`** (persona · promise · invariants · knows ·
steps) plus a **`fixtures/`** dir of real input files. It is played by the **generic runner**
`run-scenario.mjs`, which drives the pod exactly as the `/chat` SPA would and writes per-step
**evidence** for a separate **judge** to score — the runner never judges.

| # | Scenario | Covers |
|---|---|---|
| [06](./06-tanzania/scenario.yaml) | **Tanzania trip** — one attachment dump becomes spaces + a live, updatable app | file ingest (vision/audio/PDF/xlsx); per-leg spaces; live-project app (`writeProjectTable`/`Page`/`Api` + row seed); `db:write` later-update; compound + multilingual ask; query-not-remember; retraction hard-delete |
| [07](./07-life-admin/scenario.yaml) | **Life admin** — a drawer of household paperwork becomes a vault he can check | multi-file ingest; knowledge vs DB placement; hooks/events; pod restart survival |

## Running one

Local by design (`SCENARIO_TARGET=local`, the default). **No `pnpm build`** — every run spins up its
own `lmthing serve` via `pnpm lmthing serve --cwd …`, which runs the CLI from TS source through `tsx`,
so a product fix is just a rerun (the fresh process re-reads source).

```bash
cd sdk/org

# 1. dry-run the plan (no pod) — prints the steps + a fixture-coverage audit
node scenarios/run-scenario.mjs 06-tanzania --plan

# 2. play it — a fresh, uniquely-numbered run (06-tanzania/runs/<n>/), every step, evidence + snapshots
node scenarios/run-scenario.mjs 06-tanzania

# 3. a rerun that continues from a prior run's snapshot instead of replaying (the judge's verify)
node scenarios/run-scenario.mjs 06-tanzania --resume 1 --from 2   # seed run 1's step-2, continue at step 3

# inspect / clean up runs
node scenarios/harness/runs.mjs 06-tanzania list          # list · path <n> · logs <n> · down <n>|--all · gc [--keep N]
```

Each invocation is an isolated run under **`06-tanzania/runs/<n>/`**: `data/.lmthing` (its runtime
root), `snapshots/step-NN/` (per-step project-file snapshots), `sessions.log` (the server's output),
`run.json`, `runner.pid`, and the evidence — plus a `runs/latest` pointer. The whole `runs/` tree is
gitignored. The run's server is killed WITH `run-scenario` on every exit path (including a kill).

Flags: `--through N` (play steps 1..N) · `--resume <runId> [--from N]` (seed from a prior run's
snapshot and continue) · `--run <id>` (name the run; default: next integer) · `--out <dir>` (evidence
dir; default: the run dir) · `--project <id>` · `--plan` (parse + print, never connect) · `--verbose`
· `--keep-project` · `--keep-server` (leave the server up on normal completion) · `--purge` (delete
the run dir at the end).

**Evidence** (per step, in the run dir): `step-NN.json` (the compact observables the judge scores —
space names, table row COUNTS, delegate names, yield kinds+counts, errors, the reply, the asks),
`step-NN.full.json` (the raw drill-down dump), `trace.md` (human-readable), `summary.json`. The runner
also writes `runner.pid` (a stopper does `kill $(cat <run>/runner.pid)`). The judge prompt lives at
`campaign/judge.md`.

## Authoring a new scenario

```bash
cp -r _template 08-myscenario          # a scenario.yaml skeleton + an empty fixtures/
# fill 08-myscenario/scenario.yaml, drop real files in 08-myscenario/fixtures/
node scenarios/run-scenario.mjs 08-myscenario --plan   # sanity-check the plan + fixture coverage
```

The full step-verb spec (`say`, `then_say`, `in_app_chat`, `open_app`, `attach[]`, `fresh_session`,
`restart_pod`, `if_asked{}`, `deny_consent`, `expect[]`) lives in the campaign brain at
[`campaign/scenario-spec.md`](./campaign/README.md).

## The campaign brain — `campaign/`

The agent-facing prompts that run, judge, and fix the campaign — `scenario-spec.md` (shared
foundation), `judge.md` (run-judge-fix a scenario to green), `migrate.md` (prose `scenario.md` →
`scenario.yaml`), `create.md` / `extend.md` (authoring), and `orchestrator.md` (the autonomous Opus
orchestrator's runbook). An Opus orchestrator fans out Sonnet subagents that read these directly; it
is the sole committer. The old `automation/lmauto` engine is **deprecated** — see
[`campaign/README.md`](./campaign/README.md).

## The package

`scenarios/` is `@lmthing/scenario-harness` (a script-free workspace package — the runner is run by
raw `node`; the per-run `lmthing serve` it spawns runs the product CLI from source via `pnpm lmthing`,
so no build step). Its public surface is the barrel `index.mjs`; the runner engine is `lib/`:

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
  `lib/thing.mjs` (`ThingSession`), `lib/local.mjs` (the PER-RUN server lifecycle — `startRun`/
  `stopRun`/`restartRun`/`snapshotProject`/`seedRun`/`listRuns`), `lib/gateway.mjs` (the
  prod-provisioning path used by `smoke.mjs`), `lib/report.mjs` (`Report`), `jwt.mjs`, `paths.mjs`.
- `harness/runs.mjs` — a small CLI to `list`/`path`/`logs`/`down`/`gc` a scenario's prior runs.
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
- **Every run is isolated by construction** — its own `data/.lmthing`, its own server, its own port.
  A clean run still has the built-in `system`/`user` projects — those are infrastructure, not state
  leak. `--resume` seeds a NEW run's data dir from a prior run's snapshot *before* the server boots
  (restoring into a live server wouldn't be seen — the runtime holds state in memory).
- **`SCENARIO_TARGET=local` must be set before the harness is imported** — `local.mjs` computes its
  `LOCAL` flag at module-eval time and ESM hoists `import`s above any assignment, so `run-scenario.mjs`
  sets the default and then `import()`s the harness dynamically. Setting the env var externally also
  works (and is what the campaign does).
- **A killed `run-scenario` always kills its server** — the server is a detached process group, and
  the runner SIGKILLs it on `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGQUIT`/`exit`; a startup reaper cleans any
  server orphaned by an untrappable `kill -9`. `restart_pod` cycles the run's own server in place
  (same data dir + port), and the persisted session resumes from disk.
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
