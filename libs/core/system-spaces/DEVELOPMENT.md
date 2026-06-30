# System-Spaces Development Guide

How to develop the system spaces (`system-architect`, `system-research`, `system-engineer`,
`system-global`, `user-thing`, `user-memory`) and the tasklist/agent authoring model they use.
Written after the mid-2026 rewrite that tuned everything for the **weak production model**
(`DeepSeek-V4-Flash`, alias `S`). Read this before editing a system space or the runtime that
backs it.

> Governing principle: **the author declares structure + capability + context; the host enforces
> scheduling, parallelism, and capability gating; the model fills ONE narrow task.** The weaker the
> model, the more you push out of the model's hands. Every feature below exists to keep the weak
> model's job small, well-scoped, and hard to get wrong.

---

## 1. The authoring primitives (what you write in a space)

### Agent: `agents/<slug>/` — `charter.md` + `instruct.md`
- **`charter.md`** (NEW, fork-safe): 2–4 sentences of identity + domain + a "never fabricate"
  guardrail. **No `ask`/`delegate`/UI/routing prose** — it is injected into the top-level prompt
  AND into *every* task fork, where those capabilities don't exist. Loaded into `AgentDef.charterBody`.
- **`instruct.md`**: frontmatter (`title`, `knowledge`, `functions`, `components`, `actions`,
  `defaultAction`, `canDelegateTo`) + the **top-level orchestration body** (routing, when to `ask`,
  when to `delegate`). Top-level/delegate only — NOT injected into forks.
- Keep both SHORT. Do not restate runtime mechanics (TS-only, forbidden patterns) — the runtime
  preamble already says all that.

### Tasklist: `tasklists/<name>/`
- **`index.md`** — frontmatter `input:` schema (validated against the seed at runtime) + a body that
  states the **overall goal** (not procedure). The body is injected into every task fork as standing
  context (`# Tasklist (overall goal …)`). Keep it goal-not-steps.
- **`NN-<id>.md`** — one task per file. Frontmatter fields:
  | field | meaning |
  |---|---|
  | `id` | task id (also derived from filename) |
  | `output` | `{ field: "string"\|"number"\|"boolean"\|"object"\|"array" }` — validated on `resolve()` |
  | `dependsOn` | `[ids]` — also the **parallelism spec** (independent tasks run concurrently) |
  | `goal: true` | exactly one per tasklist; its output is the tasklist result |
  | `optional: true` | a failed fork → skipped, pipeline continues |
  | `condition` | DSL string, e.g. `"build.ok == true"` |
  | **`role`** | `explore`\|`plan`\|`general` — capability profile (see §2) |
  | **`functions`** | allowlist of space-function names visible to this task's fork. `[]` = NONE (also removes `webSearch`/`webFetch`); omit = all |
  | **`forEach`** | `"<upstreamTask>.<field>"` — host fan-out (see §3) |
  | **`canDelegateTo`** | per-task delegation allowlist: `"space/agent"` or `"space/agent#action"` — the ONLY targets this task may `delegate()` to (see §3a). Omit = no delegation |
- Task body = the instruction the fork's model sees. Make it **short, code-first, autonomous**
  (uses the injected `query`/seed, never asks), ending in `currentTask.resolve({...})`.

> 🚫 **NEVER write "do not use tool X" in a task instruction.** Disable it STRUCTURALLY in
> frontmatter instead: a read task → `role: explore` (no writes); a no-tools task → `functions: []`
> (no functions at all, incl. web); a task that should only touch two builders → `functions: [a, b]`.
> Prose restrictions are advisory and the weak model ignores them; the frontmatter is enforced by the
> host. The task body should only ever describe what the model SHOULD do with the tools it HAS.

---

## 2. `role` — per-task capability (least privilege)

`role` sets the fork's `HostToolsProfile` and which globals/prompt lines it gets:
- **`explore` / `plan`** — READ-ONLY. `writeFileRaw` is a no-op-error, mutating shell is blocked,
  `registerSpace` is withheld. The prompt does **not** advertise write tools. Still gets
  `webSearch`/`webFetch`/`readFileRaw`/read-only `execShell`.
- **`general`** — full toolkit (read+write+shell+`registerSpace`).
- Omitted → defaults to `general` (back-compat) — but **always set it explicitly**; pick the least
  that works. A read task that accidentally has write access is the kind of thing the weak model
  misuses.

Code: `libs/core/src/fork/roles.ts` (profiles+preambles), `globals/host-tools.ts` (gating),
`fork/fork.ts` (prompt-line gating + function-allowlist filtering).

---

## 3. `forEach` — host-driven fan-out (the map node)

`forEach: "<upstreamTask>.<field>"` makes the host run the task **once per element** of that
upstream array, in parallel (within `maxConcurrentForks`), and collect the resolved values into an
array that downstream tasks receive. **The model never writes the loop.**
- Each element fork gets the element as seed var **`item`** (+ `index`).
- The referenced upstream task MUST be in `dependsOn` (validated in `dag.ts`).
- Empty/missing source array → empty result, zero forks.
- Use this for "do X for each discovered item" (research per question, build per knowledge field).

Code: `tasklist/orchestrator.ts` (`resolveForEachItems` + the fan-out branch), `tasklist/dag.ts`
(validation), `spaces/tasklist-load.ts` (parsing).

## 3a. `canDelegateTo` — let a task delegate (opt-in, allowlisted)

By default a task/fork has **no** `delegate`/`tasklist`/`fork`/`ask` (isolated + headless). A task
that declares `canDelegateTo` gets a `delegate()` global **restricted to exactly those targets**:
```yaml
role: general
canDelegateTo:
  - system-research/researcher#deep_research   # space/agent#action  (or space/agent for any action)
```
- Enforced in `fork.ts` (`resolveTaskDelegate`): a call to a non-listed target **throws** a clear
  error (surfaced to the model, retryable) — it never silently runs.
- Routed via `ForkEngineOpts.delegateRunner`, wired by **both** the `Session` (`session.ts`
  `runDelegateForFork`) and the delegate runtime (`delegate.ts` `runChildDelegate`, at `depth+1`).
  The second one matters: the architect runs as a *delegatee*, so its tasks use the `delegate.ts`
  ForkEngine — without that wiring, architect tasks couldn't delegate.
- Recursion is bounded by `runDelegate`'s `maxDepth: 5` plus `assertForkDepth`.
- ⚠️ Delegating from a task nests `delegate → tasklist → forks → web calls` deeper — with the
  sync-`fetch` issue (§5) that multiplies the hang risk. Keep web volume low, or wait for async fetch.

---

## 4. The two system spaces that matter most

### `system-architect` — builds + runs other agents
`synthesize_and_run` is decomposed into per-file, host-driven tasks (NOT a one-turn monolith):
```
design (explore) → build_field / build_function  (forEach fan-out, general) →
write_agent (general) → write_tasks (general) → validate (explore) → register (general) → finalize (goal)
```
- `design` outputs `{ slug, goal, actionId, fields[], functions[] }` (the build plan).
- `build_field` (`forEach: design.fields`) writes ONE knowledge field's index + aspect files.
- `write_agent`/`write_tasks` write the new agent referencing only what was actually written.
- `validate` runs `validateSpace`; `register` calls `registerSpace`; `finalize` packages
  `{ spaceKey, agentSlug, actionId, query, ok, errors }`.
- The architect's **instruct** does the top-level program (it's model-driven when delegated to):
  deep-research the domain → `tasklist('synthesize_and_run', { topic, goal, research })` → delegate
  to the built agent.
- Builder functions (`functions/`): `writeAgentFile` (writes charter.md + instruct.md),
  `writeTaskFile` (emits role/functions/forEach), `writeKnowledgeIndex/Option`, `writeFunctionFile`
  (typechecks on write), `validateSpace` (requires charter, validates roles/forEach refs, knowledge
  refs, one goal/tasklist). `writeAgentFile` also **drops declared knowledge refs whose index.md
  wasn't written** — a host-side safety net for weak-model over-declaration.

### `system-research` — `researcher` agent, two actions
- **`research`** (default, tasklist `research`): shallow — ONE search + one fetch + concise sourced
  answer → `{ answer, sources }`. For quick questions.
- **`deep_research`** (tasklist `deep_research`): a 5-stage pipeline, each task narrow per the
  governing principle (no one-turn monolith):
  ```
  scope (explore, webSearch only) → plan (explore, no tools) →
  investigate (forEach: plan.questions, explore, webSearch+webFetch) →
  synthesize (explore, no tools) → summarize (explore, no tools, goal)
  ```
  - `scope` runs TWO broad, fetch-free searches (the raw topic + a `topic:'news'`-biased
    reformulation) and writes `{ topic, landscape, seedSources }` — reconnaissance the planner
    uses instead of decomposing blind.
  - `plan` decomposes `scope.landscape` into 6-8 sub-questions spread across a fixed angle
    taxonomy (background, current state, key players, risks/debate, outlook, +1 topic-specific) →
    `{ topic, questions }`.
  - `investigate` (`forEach: plan.questions`, parallel within `maxConcurrentForks`) does ONE search
    + up to THREE fetches per question → `{ question, findings, sources, confidence, gaps }` — the
    `confidence`/`gaps` fields are free (no extra web calls) and let downstream steps reason about
    evidence quality instead of presenting everything with equal certainty.
  - `synthesize` clusters `investigate`'s array into themed buckets, dedupes sources (incl.
    `scope.seedSources`), and rolls up gaps → `{ topic, themes, all_sources, gaps }`. NOT the goal.
  - `summarize` (goal) writes the final narrative from `synthesize`'s output → the **unchanged
    external contract** `{ topic, executive_summary, findings[], conclusion, sources[] }` that THING
    and the architect already destructure.
  - Web-call budget vs. the prior single-`synthesize` design: `scope` adds 2 cheap searches total
    (not multiplied by fan-out); `investigate`'s fetch count went from 2→3 per question (the
    user-accepted depth/risk tradeoff, see §6) and questions from 3-5→6-8. All fetches remain
    individually bounded by the curl hardening in §5.
- THING routes quick questions → `research`, deep dives → `deep_research`. The architect uses
  `deep_research` for validated, sourced knowledge before building an agent.

---

## 5. Hard invariants & gotchas (these bite the weak model)

- **Forks/tasks have NO `tasklist`, `fork`, or `ask`** (and no `delegate` unless the task opts in via
  `canDelegateTo`, §3a). They are isolated, headless, single-shot. These are now **stripped from the
  fork DTS**, so a stray call fails typecheck (a clean retryable error) instead of passing typecheck
  then throwing at runtime and salvaging a placeholder. Orchestration happens at a session's top
  level (incl. an agent's instruct when it is delegated to), and per-task delegation via §3a.
- **Cross-fork data is JSON-only.** Values pass via `output` schema → `vm.setVar`. No functions/class
  instances. Upstream outputs arrive as vars named by task id; `forEach` element as `item`.
- **Variables don't persist between statements/turns** unless re-bound — declare and use in the same
  statement; keep yielding calls (`await webSearch/webFetch/tasklist/delegate/registerSpace`) FLAT at
  top level, ternary-guarded, never inside `if/try/loop` (code after a nested yield is lost on resume).
- **Forks salvage, they don't hard-fail.** A fork that never `resolve()`s gets forced resolve turns,
  then a schema-valid placeholder (`[]`/`0`/`""`/`(unavailable…)`). So a "successful" tasklist can
  carry empty data — `validate`-style gates and honest error fields matter. (Hard budget caps and an
  explicit `timeout` still fail loudly.)
- **`validateSpace` rejects placeholder `loadKnowledge('<domain>',…)`** and refs to files that don't
  exist. Builders must DERIVE refs from what was written, with REAL slugs.
- **System spaces are read from SOURCE** (`libs/core/system-spaces/…`) at runtime — editing `.md`
  and builder `.ts` needs **no rebuild**. Only changes to compiled runtime code
  (`libs/core/src/**`) need `pnpm --filter @lmthing/core build`.
- **`SYSTEM_SPACE_NAMES`** (`libs/core/src/spaces/system.ts`) must list every system-space dir; the
  6 names are materialized into `<root>/system/`. Renaming a space = update this + tests + any
  instruct that delegates to it by dir-key.

### `fetch` is now a real, non-blocking yield (Wave 2 — done)
`fetch` (`globals/fetch.ts` + `eval/fetch-yield.ts`) is a **value-yielding global**, exactly like
`sleep`/`ask`/etc. — it ends the turn and resumes once a real, async Node `fetch()` settles, instead
of the old `execSync(curl ...)` that blocked the entire single Node thread for the request's
duration (no other fork could progress, and the stream-idle watchdog's `setTimeout` couldn't even
fire). `webSearch`/`webFetch` are plain `async function`s that `await fetch(...)` internally — a
yield NESTED inside another async function, which exposed a real, separate bug in the bridge: it
disposed the QuickJS promise deferred *before* the host promise settled, permanently neutering
`resolve()`/`reject()` (no-ops after `dispose()`), so a nested await never resumed (`sandbox/host-bridge.ts`
now disposes on settle, with an `alive`-guard + pending-deferred registry so a fork torn down mid-flight
— budget cap, timeout — doesn't leave a live handle blocking `ctx.dispose()`). Turn-loop's post-yield
binding also had to start preferring the VM's own computed value (`vm.getVar`) over the raw yield
result, since for a nested yield those differ (`eval/turn-loop.ts`). See `eval/yield-router.ts`
(session/delegate) and `fork/fork.ts`'s `forkProcessYield` (fork leaf VMs) for the two resolution
sites. Regression-tested in `globals/host-tools.test.ts` (concurrent fetches don't serialize) and
`eval/turn-loop-yield.test.ts` (nested-yield binding).

---

## 6. Current state & open risks

**Validated working (live, real Azure models):**
- Per-task `role`/`functions`, `forEach`, charter/instruct split, soft todos, stream watchdog —
  unit-tested (`tasklist/foreach.test.ts`, `eval/turn-loop-extras.test.ts`, `spaces/system-spaces-dag.test.ts`).
- Architect synthesis **with inline per-field web search** (the pre-research-rework build): full
  success on Pro (`M`) and Flash (`S`) — built + registered + ran a multi-field agent, no stall.

**Resolved:** the original architect → `deep_research` hang (sync-`fetch` event-loop blocking under
a heavy nested fan-out, defeating the stream-idle watchdog) is now fixed at the root — `fetch` is a
real async yield (§5), not a hardened-timeout stopgap. `.issues/architect-synthesize-stall.md` was
deleted once confirmed. The architect's `instruct.md` calls
`delegate('system-research', 'researcher', 'deep_research', …)` directly as its first turn.

**Validated (live, `--model S`, real Tavily/Azure keys, post-Wave-2):** the `deep_research` fan-out
(`scope → plan → investigate[forEach] → synthesize → summarize`) ran end-to-end against the
`researcher` agent directly with **no stall** (`node_start`/`node_end` both 24, full run ~152s) and
exercised 52 real `fetch` yields (concurrent within `maxConcurrentForks`, confirmed via the trace) —
produced a genuinely good report with sourced findings, an honest low-confidence flag, and a
specific gaps section. `webSearch` now falls back to DuckDuckGo when `TAVILY_API_KEY` is unset, and
`webFetch` can return Markdown (`format: 'markdown'`) instead of flattened text — both task `.md`
files in this space already opt into markdown for fetched pages. Remaining real limitation:
`webFetch` still can't read PDFs and some sites anti-bot-block plain requests — neither is a
blocking/hang risk anymore (degrades to a low-confidence gap, not a stall), but a follow-up (PDF
text extraction and/or a more realistic UA/header set) would improve report depth.

**⚠️ Open / unverified:**
- Only the direct `researcher` agent path was live-validated above; the architect's own
  `delegate('system-research', 'researcher', 'deep_research', …)` call site is unchanged (same
  output contract) and typechecks/DAG-validates, but was not separately re-run live through the full
  `synthesize_and_run` pipeline after this rewrite.
- 2 pre-existing `mock-session` "per-role models" test failures on `main` — unrelated to this work.

---

## 7. Testing

### Unit / structural (no keys — use the mock provider)
```bash
cd sdk/org
npx vitest run libs/core/src/tasklist libs/core/src/fork libs/core/src/eval libs/core/src/spaces
pnpm --filter @lmthing/core typecheck
```
- `tasklist/orchestrator.test.ts`, `tasklist/foreach.test.ts` — DAG scheduling, forEach, role/function
  scoping, charter injection (drive REAL `runTasklist`+`ForkEngine` via `createMockStreamFn`).
- `spaces/system-spaces-dag.test.ts` — every shipped system-space tasklist loads + validates + has a
  goal + charter present. **Run this after editing any system space.**
- Mock streamFn must emit typecheck-clean TS (e.g. annotate `reduce` params) — a fork that fails
  typecheck salvages a placeholder and your assertion sees `0`/`[]`.

### Live (real model — needs `.env` at `sdk/org` with `AZURE_API_KEY`, `AZURE_RESOURCE_NAME`, `TAVILY_API_KEY`)
Model aliases in `.env`: `XS`/`S`=`DeepSeek-V4-Flash` (weak, the production target), `M`/`L`=`DeepSeek-V4-Pro`, `L_R`=`Kimi-K2.6`. Default is `M`.
```bash
cd sdk/org
pnpm --filter @lmthing/core --filter @lmthing/cli build      # only if libs/core/src changed
ROOT=$(mktemp -d /tmp/lmroot-XXXX)                            # FRESH root per run (materializes system spaces from source)
LMTHING_ROOT="$ROOT" node libs/cli/dist/cli/bin.js \
  --request "Build an agent that <…>, then use it." \
  --model S --trace "$ROOT/trace.ndjson" > "$ROOT/run.log" 2>&1 &
```
- Run on **`--model S` (Flash)** to validate the real target; `M` (Pro) confirms mechanics.
- `--agent architect` targets the architect directly (its `defaultAction` runs synthesize); omitting
  `--agent` runs THING (the full realistic path: THING → delegate → architect → … → run built agent).
- **Watch for hangs**: compare `node_start` vs `node_end` counts in the trace; if `node_start` stays
  ahead and the last `"ts"` is minutes old, it's stalled (almost always a blocked curl — see §5).
  `grep -c '"type":"node_end"' "$ROOT/trace.ndjson"`.
- Built spaces land in `$ROOT/user/spaces/<slug>/` — inspect `charter.md`, `knowledge/**`, and the
  generated task's `role` + real `loadKnowledge` line.
- Foreground `sleep` is blocked in this harness; poll with a bounded `until`-loop or run in background
  and read the trace/log.

### Issue lifecycle
File `.issues/<slug>.md` + a Known-issues line in `sdk/org/CLAUDE.md` when you find a bug; delete both
when fixed and tested. (The `architect-synthesize-stall` issue was fixed by the stream watchdog and
removed.)
```
