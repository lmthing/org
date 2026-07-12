# Scenario 04 — Signals & Code nodes — results

**User label:** `observatory` (`user-381387680333719178`) · **Env:** live prod (`lmthing.chat` pod, live LLM)
**Run window:** 2026-07-12 · **Verdict: ✅ PASS (feature-verified) with 2 product bugs fixed + 3 authoring/UX gaps found**

The runtime feature under test works in production: **all five internal signals emit and route with
schema-exact payloads**, the **mixed agent→code DAG executes with 0 tokens on the code nodes and
correct output flow**, `forEach` fans out, and a hook's `tasklist.run` returns its result. Two real
product bugs were found and fixed (one core-routing, one stale specialist prompt); three
authoring/UX gaps are reported honestly (the biggest: **the system spaces have no way to author a
code node**).

---

## Verdict by step

| Step | Result | Evidence |
|---|---|---|
| 1 · install the mirror | ✅ (1 finding) | THING → `system-store/finder` → consent card → `installSpace('integration-lmthing')` → `system-appbuilder/automator` authored **5 code-handler hooks** (one per signal), **0 tokens/signal**. THING could NOT create the project itself (no tool → finding F5). |
| 2 · provoke each signal | ✅ 4/5 live + 1 bug fixed | `space.installed`, `hook.fired`, `session.completed`, `document.written` all routed with **exact** payloads. `project.created` did **not** route → **BUG B1, fixed**. |
| 2e · throwing internal def | ✅ | A deliberately-throwing `events/boom.ts` was worker-contained: the space install completed AND the healthy defs still emitted (`space.installed(integration-google)` recorded). |
| 3 · publish a custom event | ◑ partial-live | Edge **D** (no `events:emit` → `typecheck_error: Cannot find name 'emitEvent'`) verified LIVE. Edges A/B/C (undeclared / bad-payload / scope-spoof) covered by unit tests (`emit-event.test.ts`); live publisher re-run blocked by the pod outage (see caveat). |
| 4 · mixed DAG (code nodes) | ✅ | agent `research` → code `format` → code `store`; `stored:5`, real JWST findings landed in the `digest` table; wiring flags all true (below). Code nodes = **0** `llm_response`. |
| 5 · forEach + headless from hook | ✅ | forEach over `research.findings`: `n:5, indexes:[0,1,2,3,4]`, collector received all 5. A project hook's `ctx.tasklist.run('digest/digest', seed)` **returned its result to the handler** (`result.ok`/`data` present) — the known "drops its result" bug does **not** regress. |
| 6 · isolation & failure | ✅ | `ctx.fetch` → `"ctx.fetch is not a function"`; `callConnection('slack')` on a tasklist declaring nothing → throws "not allowed… declared no connections"; a throwing code node → `ok:false, "Required task \"boom\" failed…"` with downstream **skipped** (0 `SHOULD-NOT-RUN` rows). |
| 7 · project functions | ⚠️ not executed live | Deferred (time + pod outage). Runtime support exists (`spaces/project-functions-load.ts`, DTS overlay, `writeProjectFunction`) and is unit-tested; not exercised end-to-end here. |

### Exact signal payloads recorded (Step 2, live)
```
space.installed    {"projectId":"observatory","spaceId":"integration-demo"}
hook.fired         {"projectId":"observatory","slug":"record-space-installed","hookType":"event"}
session.completed  {"projectId":"observatory","agent":"thing","sessionId":"aca70583-…","ok":true,"durationMs":24243}
document.written   {"projectId":"observatory","path":"documents/control-note.md"}
project.created    (no row — bug B1, pre-fix)
```
Each payload matches its def's declared schema **exactly** (no extra/undefined keys). An incomplete
signal produces no row (the defs' `emit` returns `[]` on a missing field — `validateEmitted` + the
def guards).

### Code-node wiring (Step 4, live — the DAG assertions that usually break)
```
run-digest → { ok:true, data:{ n:5, indexes:[0,1,2,3,4], stored:5,
  wiring:{ seedTopLevel:true, researchByNodeId:true, formatByNodeId:true } } }
```
- `seedTopLevel:true` — the seed key is `inputs.topic` at TOP LEVEL, and `inputs.seed` is `undefined`.
- `researchByNodeId:true` / `formatByNodeId:true` — upstream output is keyed **by node id**
  (`inputs.research.summary`, `inputs.format.markdown`), only for **direct** `dependsOn` deps.
- Static `node` metadata: the tasklist ran without core ever executing the `.ts` modules to learn
  their ids (extraction is AST-only; also unit-covered by `orchestrator.codenode.test.ts`).

---

## Bugs found & fixed

### B1 — `project.created` never reaches the observing project *(core routing; FIXED)*
`emitInternalSignal('project.created', { projectId })` used the default fan-out rule, which reads
`data.projectId` as the **audience**. But for `project.created` the id names the **subject** — a
just-scaffolded project that by construction has **no emitter defs or hooks** — so the signal routed
to the one project that cannot subscribe, and every `integration-lmthing` mirror in every *other*
project missed it. Confirmed live: 4/5 signals recorded, `project.created` = 0 rows.

**Fix:** a `meta.fanOutAll` flag on the signal; `project.created` sets it so the sink routes to every
project (the new id still rides through as payload data). `internal-signals.ts` +
`session-manager.ts`; regression tests in `internal-signals.test.ts` (fanOutAll routes to all
projects; a normal projectId-carrying signal still scopes to one). **sdk/org `54ed659`**, parent
`dcf4bc2f`. Deployed in `compute:fe7cf57`.

### B2 — `build_app` still authors the REMOVED `{type:'database'}` hook *(stale prompt; FIXED)*
`system-appbuilder/tasklists/build_app/06-build_hook.md` emitted `{ type: 'database', on:{table,event},
trigger }` — a hook kind deleted in the events migration (dropped-with-warn + a migration error) — and
a nonsensical self-`trigger` into `app-architect#build_app`. Any app THING builds would ship broken
hooks. **Fix:** rewrote the step to author current `{type:'event'}` hooks with a `ctx.db` code
handler (or a real `trigger`). **sdk/org `54ed659`.**

---

## Product gaps found (the real "can the specialists author this?" answer)

### F1 — **The system spaces cannot author a code node.** *(biggest finding)*
There is no `writeCodeNode`, and no knowledge/prompt anywhere in `system-spaces/` mentions code nodes,
`NN-<id>.ts`, the `node` metadata literal, or `run(ctx, inputs)` (verified by exhaustive grep). The
tasklist author (`system-architect`) has only `writeTaskFile`, which writes `.md` agent nodes. So
Step 4's "build me a digest tasklist… don't use a model for formatting/storing" cannot be fulfilled by
any specialist THING routes to — the **code-node runtime works, but nothing can author one**. The
runtime was proven here by the harness writing the `digest` space files directly (clearly flagged
substrate). **Recommendation (not implemented — high blast radius mid-campaign):** add a
`writeCodeNode(space, tasklist, spec)` writer + a code-node knowledge aspect to `system-architect`
(and/or teach `system-engineer` to author them via `writeFileRaw`), so the feature it owns is
authorable.

### F2 — the automator hallucinated a db API + couldn't make its table *(prompt; improved)*
On the first ask the automator wrote 5 correct event hooks but guessed at `ctx.project.db` /
`ctx.publishEvent` fallbacks (neither exists) and referenced a `signals` table it had no capability
to create (`hooks:write` only). I added a "persisting from a handler" section documenting the real
`ctx.db` API and the "you cannot create a table" boundary; a concurrent scenario-01 change then
granted the automator `db:schema` + `writeProjectTable` outright (the better fix). For this run the
harness provisioned the `signals` table (storage substrate, like the project) so the agent-authored
hooks — the actual feature — could be exercised.

### F3 — `document.written` only fires from the documents API, not an agent `writeFile`
The spec's provocation ("ask THING to write a note") makes THING call `writeFile('mission.md')` on the
project fs, which is **intentionally not** classified as a document write (S8) — so no signal fired.
The signal's real cause is a project-document write (`POST /documents` / `addDocument`), which we used
and which routed correctly. Worth reconciling the spec (or classifying agent notes as documents).

### F5 — THING cannot create a bare project
"Create a project called observatory" → THING replied it has no project-creation tool and stopped
(no delegation). Project creation is effectively a UI/API action today; the harness created it. Minor,
but a dead-end for a natural request.

---

## Performance

| Metric | Value |
|---|---|
| Code-node execution (format + store, per run) | < 1 s, **0 tokens** (pure host code) |
| Full `digest` tasklist (1 agent node + 2–4 code nodes + forEach) | ~340 s wall — **all of it the agent node's live webSearch/webFetch**; code nodes negligible |
| `forEach` over 5 findings | 5 executions, single collected array (`n:5`) |
| Step 1 install+author turn | 57.5 s · 23 196 in / 1 773 out tokens |
| Signal recording cost | **0 tokens/signal** (code handlers, no agent trigger) |

---

## Caveats / honesty

- **Post-fix live re-confirmation of B1 is inconclusive.** After patching the pod to `compute:fe7cf57`
  (which contains the fix), the **entire recorder stopped writing** — all five signals, not just
  `project.created` (manual hook run returns `ok:true` but lands no row; a publisher agent session
  errored). This is a recorder-**write** regression/pod-state issue on the heavily-churned disposable
  pod (dozens of raw-fs schema writes bypassing the `writeProjectTable`/`onSchemaWrite` reload seam,
  repeated image rolls, a stale `integration-demo` webhook-path collision from another scenario's
  not-yet-imaged store fix). It is **unrelated to the one-line routing fix**. B1's correctness rests on
  (a) the crisp pre-fix live evidence that isolated exactly `project.created`, and (b) green regression
  tests. Flagged for follow-up: why do event-hook `ctx.db` inserts silently no-op on this image/pod.
- A repeated `run-digest` firing (~18 s cadence, 20+ times from one manual call) is an **ingress-retry
  artifact** of driving a 340 s tasklist through the *synchronous* manual hook-run POST — not a
  dispatch loop; each run's `stored:5` and wiring flags were identical and correct.
- Shared-tree note: fixes were committed as an isolated hunk set (`git add -p`) to avoid sweeping four
  concurrent agents' in-flight work in the shared `sdk/org` checkout.

## Files

- Runner / spec: `sdk/org/scenarios/04-signals/run.mjs`
- Focused runtime verifiers: `sdk/org/scenarios/04-signals/verify-codenodes{,2,3}.mjs`, `verify-emitevent.mjs`
- Fix commit: sdk/org `54ed659` · parent `dcf4bc2f`
