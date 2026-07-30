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
| [20](./20-studio/scenario.yaml) | **TEAM · Fold Studio** — four people, one shared brain | a thread remembers across MEMBERS; the team directory; THING acting across channels; a parked question a *different* member answers; a viewer refused |
| [21](./21-newsroom/scenario.yaml) | **TEAM · The Alcalá Post** — the room works while it is empty | a scheduled turn that posts into a channel; THING creating a channel; a private DM to the same brain; in-app chat |
| [22](./22-crossfire/scenario.yaml) | **TEAM · Harbour Works** — three people change one app at once | `concurrent:` beats (real races, not sequences); a genuine contradiction surfaced rather than silently resolved |

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
`restart_pod`, `if_asked{}`, `deny_consent`, `cancel_ask`, plus the direct-pod-probe verbs —
`space_session`, `call_app_api`, `run_emitter`, `inbound` (+ `sign{}`), `list_integrations`,
`set_env`, `blank_env`, `restore_env`, `mutate_schema` — for the "0 LLM calls" beats: a webhook, an
app's own route, a cron tick, a settings-path credential, a schema drift, `expect[]`) lives in the
campaign brain at [`campaign/scenario-spec.md`](./campaign/README.md).

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
  `lib/thing.mjs` (`ThingSession`, and the `CANCEL_ASK` sentinel for a true-cancel `cancel_ask`),
  `lib/local.mjs` (the PER-RUN server lifecycle — `startRun`/`stopRun`/`restartRun`/
  `snapshotProject`/`seedRun`/`listRuns`/`mutateTableSchema`), `lib/env.mjs` (`applyEnv`/
  `mergeEnvContent`/`readEnvVar` for `set_env`/`blank_env`/`restore_env`), `lib/team-pod.mjs`
  (`TeamPod`/`TeamSocket` — a team pod driven as a named member) + `lib/team-thread.mjs`
  (`ThreadSession` — THING in a channel thread), `lib/webhook-sign.mjs`
  (`signHmac`, for `inbound`'s `sign:` block), `lib/gateway.mjs` (the prod-provisioning path used by
  `smoke.mjs`), `lib/report.mjs` (`Report`), `jwt.mjs`, `paths.mjs`.
- `harness/runs.mjs` — a small CLI to `list`/`path`/`logs`/`down`/`gc` a scenario's prior runs.
- `harness/smoke.mjs` — register → pod → env → THING session → a real LLM turn → trace assertions; run
  it to prove the harness + a target are healthy before a long run.
- `harness/team-smoke.mjs` — the same proof for a TEAM pod (see below).

## Driving a TEAM pod

A team pod is a different shape: `LMTHING_TEAM_MODE=1` (which is what registers `/api/team/*` at all
— `libs/cli/src/server/serve.ts` gates on `isTeamMode()`), several members instead of one user, and
conversation in **channels** rather than a `/chat` session. Caller identity arrives as the four
headers Envoy projects from the team-scoped JWT (`x-user-id`, `x-user-email`, `x-team-id`,
`x-lmthing-role` — `team-guard.ts#readCaller`), and the pod **trusts them absolutely**, because in
production the edge overwrites anything a client sent. So a local harness needs no proxy: it sends
those headers itself.

```bash
cd sdk/org
node scenarios/harness/team-smoke.mjs          # the one command; --keep leaves the server up, --verbose traces
node scenarios/harness/team-smoke.mjs --ask    # + the park-on-a-question path (opt-in: the model must CHOOSE to ask)
```

It boots a team-mode run under `harness/.state/team-smoke/runs/<n>/`, seeds two editors and a
viewer, has member A `@thing` a real LLM turn, has member B answer **in the same thread**, and
asserts the viewer is genuinely refused a write — then prints a pass/fail table.

```js
import { TeamPod, ThreadSession, startRun } from '@lmthing/scenario-harness';

// A team-mode run — the ONLY server-side difference a team scenario needs (`local.mjs#teamEnv`).
const run = await startRun({ scenarioDir, runId, projectId: 'user', scenarioId, teamMode: true, teamId: 'acme' });

const pod = new TeamPod({ base: run.base, teamId: 'acme', members: [
  { name: 'ana', role: 'editor', handle: 'ana' },
  { name: 'bo',  role: 'editor', handle: 'bo'  },
  { name: 'vic', role: 'viewer', handle: 'vic' },   // a viewer is FIRST-CLASS: read-only is testable
]});
await pod.introduceAll();                                    // every member lands in the directory
const { channel } = await pod.createChannel('ana', 'Launch'); // editor-only, by team-guard default-deny
await pod.request('vic', 'POST', '/api/team/channels', { name: 'x' }, { raw: true });  // → {status: 403}

const thread = new ThreadSession(pod, { channelId: channel.id, observeAs: 'ana' });
await thread.open();                                          // watch /api/team/ws AS ana
const t1 = await thread.ask('ana', '@thing our codename is Bluefin');
const t2 = await thread.say('bo', 'what codename did Ana give you?');   // no @thing needed in-thread
t2.sessionId === t1.sessionId;   // the THREAD owns the session — cross-member memory
t2.blocks;                       // the STORED display descriptors (a channel reply is structure)
```

`TeamPod` covers channels, categories, DMs, messages (channel-level and threaded), the directory, the
profile and mark-read; every method takes the acting member first, or use `pod.as('ana')` for the
pre-bound spelling. `pod.request(who, method, path, body, {raw:true})` returns `{status, body}` — the
shape a refusal assertion needs, since a 403 is the *result* there, not a fault.

**The completion signal is `thing_status`, not "a `thing` message appeared."** THING's `ask()` also
posts a `thing` message into the thread (`routes/team-channels.ts#postAsk`), so a driver that stopped
at the first one would report a turn that is actually *parked on a question* as finished, with the
question as its answer. `runThingReply` broadcasts the reply message and then the `done`/`error`
frame with no `await` in between, so the terminal never races the content it follows.
`ThreadSession` infers a park (a `thing` message with no terminal behind it), answers it through
`onAsk` if you supply one, and otherwise returns `status:'parked'` rather than hanging.

### Playing a team scenario

A team scenario declares a `team:`, a `cast:` (with roles — a viewer is load-bearing) and
`channels:`, and is played by its own runner. `run-scenario.mjs` and `lib/runner.mjs` are untouched
by it, and each refuses the other's scenarios by name.

```bash
cd sdk/org
node scenarios/run-team-scenario.mjs 20-studio --plan     # cast · channels · who speaks where · validation
node scenarios/run-team-scenario.mjs 20-studio            # play it (fresh run under 20-studio/runs/<n>/)
node scenarios/run-team-scenario.mjs 20-studio --through 3 --run 900 --purge     # a cheap pre-flight
```

Flags: `--plan` · `--through N` · `--run <id>` · `--out <dir>` · `--resume <runId> [--from N]` ·
`--verbose` · `--keep-server` · `--purge`. `--resume` works because `.team/` (channels, members, the
thread→session map) lives inside `.lmthing`, so it rides along in every per-step snapshot.

Step verbs, on top of the shared ones (`open_app`, `in_app_chat`, `restart_pod`, `run_emitter`,
`expect`):

| verb | meaning |
|---|---|
| `as: <cast key>` | who is speaking — required on a conversational step |
| `in: <channel id>` | which channel |
| `dm: <cast key>` | speak in the DM between `as:` and this member |
| `say:` | the message, verbatim |
| `reply_to: <step number>` | continue the thread that step opened instead of opening a new one |
| `answer_ask: true` | this message answers a question THING parked in that thread |
| `if_asked: {substring: answer}` | steer the persona's answer to an expected question |
| `concurrent: [{as, in\|dm, say}, …]` | several members speaking **in the same instant** |

`concurrent:` is played in three phases — every message's channel, thread and socket are set up
first, then every POST goes on the wire with no `await` between them, and only then does anything
wait. Played in sequence it would be a different test: the second speaker would arrive after the
first speaker's turn had already finished.

`--plan` is also a **validator**: an `as:` who is not in the cast, an `in:` that is not a declared
channel, an `answer_ask` with no `reply_to`, or a `reply_to` naming a step that never speaks are all
refused before a pod is booted.

**Evidence is attributable.** Every turn row in `step-NN.json` carries `who`, `role`, `channel`,
`dm`, `threadId` and `sessionId`, plus `asks` (with what answered them), `consumedPendingAsk`,
`crossChannelPosts` (THING posting where nobody addressed it — invisible in a per-thread view) and
`denied` (a refusal recorded as the result it is, never thrown).

> ⚠️ **A team channel turn is invisible to the pod's own session ledger.** `runHeadlessThreaded`
> (`libs/cli/src/server/session-manager.ts:2068`) subscribes the tracer for displays and activity but
> never calls `sessionLedger.trackTracer(...)` the way `runHeadless` does at `:1900`, and the session
> is never registered in the manager so there is no `/events` stream either. So there are **no tokens,
> no cost and no delegate record** for any team turn. Until that is fixed, `threadSessionFacts()`
> recovers what a turn did from the statements it wrote (`<root>/user/sessions/<id>/snapshot.json`) —
> the delegate targets, the globals, the `db.*` calls. That is evidence for the judge, never an
> answer: what THING *said* is `lastText`, which comes from what it displayed.

**A parked turn is not in-flight work.** `beginThingReply` releases the drain the moment a turn parks,
because `settleChannelWork` — the pod's graceful-shutdown drain — would otherwise wait forever on a
question nobody answers. The harness kills its run server with SIGKILL, so this cannot hang teardown
here; on a pod that shuts down gracefully it would.

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
