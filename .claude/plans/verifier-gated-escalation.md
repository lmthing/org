# Implementation Plan: Verifier-Gated Escalation & Budget Guardrails

Status: implemented (Phases 1, 2, 3, 4 — all shipped)
Branch: `claude/agentic-framework-paper-ideas-CGzXp`
Source: ideas distilled from *"Advancing Mathematics Research with AI-Driven Formal
Proof Search"* (AlphaProof Nexus, DeepMind, arXiv:2605.22763), critiqued against
lmthing's design thesis.

---

## 0. Implementation status

Landed on this branch (full `pnpm typecheck` clean across all packages; all 195
core/cli tests pass, incl. the new suites):

- **Phase 1 — Budget guardrails: DONE.** `eval/budget.ts` (`Budget`,
  `BudgetExceededError`, `BudgetLimits`). Wired into `runTurnLoop`
  (`tickEpisode` per turn, `tickToolCalls` per resolved yield),
  `Session` (fresh budget per `start()`/`continue()`, from `SessionOpts.budget`),
  and `ForkEngine` (per-fork budget + `assertForkDepth` before VM creation).
  Tests: `eval/budget.test.ts` (12) + budget integration in `fork/fork.test.ts`
  (episodes/toolCalls/forkDepth caps, clean rejection, within-budget no-op).
- **Phase 2 — Progress global: DONE.** Read-only `progress()` injected via
  `host-tools.ts`, declared in `LIBRARY_DTS`, backed by the live per-run budget
  snapshot. Test: progress read inside a real fork VM (`fork/fork.test.ts`).
- **Phase 4 — Per-role models: DONE.** `modelForRole` + `RoleModelConfig` in
  `fork/roles.ts`; `model?` threaded through `StreamOpts` → `TurnLoopDeps` →
  `ForkEngine`; `SessionOpts.roleModels`; CLI `streamFn` resolves per-request
  models (cached) from `LM_MODEL_ROLE_{EXPLORE,PLAN,GENERAL}`. Tests:
  `fork/roles.test.ts` (mapping + a fork passing its role model to `streamFn`).
- **Phase 3 — `solve` escalation: DONE (shipped as a host-orchestrated global,
  commit `eed51ab`).** `fork/solve.ts` is the full verifier-gated ladder, unit-tested
  via dependency injection (`fork/solve.test.ts`, 10 cases: no-verify no-op,
  first-try pass, retry rung, feedback injection, race escalation, exhaustion,
  `maxAttempts` ceiling, custom ladder, async verify, race-width capping).
  **Resolution of the original userland-first sketch:** a `verify` *callback* cannot
  marshal across the QuickJS boundary, so — exactly like `tasklist` — `solve` shipped
  as a value-yielding **global** (`globals/solve.ts` → `routeCommonYield` →
  `runSolveYield`), not a space function. `verify` is given as serializable specs
  (`verifyCommand` run host-side, or `verifyCondition` over the output). It is declared
  in `LIBRARY_DTS` and the runtime preamble; `fixtures/solver` demonstrates it with a
  `tsc` `verifyCommand`, and `fixtures/solver/mock.mjs` exercises the ladder keyless.

Everything below is the original plan, kept for rationale.

---

## 1. Background & framing

AlphaProof Nexus succeeds because of **one property**: a cheap, sound, automatic
verifier (the Lean compiler). Every architectural elaboration in that paper —
episodic refinement ("Ralph loop"), racing subagents, population/Elo evolution, the
SafeVerify integrity gate — is *downstream* of having a ground-truth oracle. The
paper's own headline finding is that the **basic loop solved all 9 Erdős problems**;
the heavy evolutionary machinery only paid off on the 2 hardest and was *less*
cost-efficient elsewhere.

That conclusion is **validating, not prescriptive**, for lmthing: "simple agentic
loops win as LLMs improve" is already lmthing's bet (thin runtime, model writes TS,
context-firewall forks, capabilities-as-spaces). So this plan deliberately adopts the
*small* high-value residue and explicitly rejects the machinery that would erode
lmthing's distinctive design.

### The one usable signal

The only cheap, robust, generic measure of "this task is hard" is **`verify` failing
while budget remains**. Token/turn counts and LLM self-confidence are noisy and
gameable; escalating on them spends compute blind. Therefore *all* escalation in this
plan is gated on `verify` outcome. A corollary makes "only when needed" true **by
construction**:

- No `verify` provided  ⇒ ladder is unreachable ⇒ single attempt (no-op for
  verifier-less spaces: cooking, research, sommelier…).
- `verify` passes first try ⇒ complexity reads zero ⇒ no escalation, no extra cost.
- `verify` keeps failing ⇒ escalate, bounded by a hard budget ceiling.

The "complexity factor" is therefore **observed** (how far up the ladder we had to
climb), never declared or guessed.

---

## 2. Scope

### In scope (the residue that survives the critique)

1. **Budget guardrails** — host-enforced ceilings on episodes / fork depth / tool
   calls. The one clear gap: a real host concern (autonomous runaway cost), cannot
   live in userland, must not be model-disableable.
2. **`solve` escalation helper** — a verifier-gated escalation ladder
   (single → retry-with-feedback → race-N), born as **userland space code** in the
   `engineer` space. Graduates to core only if reused.
3. **Exposed progress counters** — surface the retry/failure counts the turn loop
   already tracks, read-only, so the helper and telemetry can see the factor.
4. **Per-role model assignment** — cheap cost lever; let fork roles map to model
   aliases (rater/explore → cheap, plan/general → capable).

### Explicitly OUT of scope (rejected — see critique)

- **Population / shared-pool DB** — deliberately breaks the fork *context firewall*,
  lmthing's most distinctive property. An inversion of the thesis, not a feature.
- **Declarative strategy DSL in frontmatter** (`strategy:`/`replicas:`/`rater:` YAML)
  — pulls control flow out of model-written TS into a config mini-language. The
  existing condition-DSL's limits (no string methods, no arrays, no precedence) are
  the canary: config languages grow into bad programming languages. lmthing already
  uses TS as its orchestration layer; keep it there.
- **Racing / evolution as core primitives** — expressible in userland TS today
  (`forkRace` is a ~10-line `Promise` helper). They earn a place in `@repl/core`
  only by proving they cannot live in a space.
- **Auto-escalation to evolution or any firewall-breaking strategy** — auto-escalation
  may "spend more on the same firewalled approach"; it must never silently change the
  architecture. The ladder hard-stops at race/best-of-N.

### Design lens to carry forward

For any future capability, ask: **(a) does the task expose a sound verifier?**
(if not, escalation machinery doesn't apply) and **(b) who decides — guardrail or
power tool?** (guardrails = host policy, default-on, not model-disableable; power
tools = userland, opt-in). This lens, more than any single feature, is the durable
takeaway.

---

## 3. Implementation phases

### Phase 1 — Budget guardrails (host, default-on)

**Goal:** a hard, host-enforced ceiling so any loop/escalation cannot run away.

- Add `BudgetOpts { maxEpisodes?, maxForkDepth?, maxToolCalls?, maxWallClockMs? }`
  to `SessionOpts` (`packages/core/src/session/session.ts`) and thread into
  `ForkEngineOpts` (`packages/core/src/fork/fork.ts`).
- Enforce in two places:
  - `runTurnLoop` (`packages/core/src/eval/turn-loop.ts`) — episode/tool-call counts.
  - `ForkEngine.runFork` (`packages/core/src/fork/fork.ts`) — fork depth, per-fork
    wall clock (extend the existing `task.timeout` machinery at fork.ts:96).
- On exceed: terminate cleanly with a structured `BudgetExceededError`, dispose the
  VM (respect the disposal-timing comments at fork.ts:128–147 / 291–304).
- Sensible defaults; opt *up*, never opt out from inside the worker VM.

**Tests** (`packages/core/src/eval/turn-loop.test.ts`,
`packages/core/src/fork/fork.test.ts`):
- loop that never resolves halts at `maxEpisodes` with `BudgetExceededError`.
- nested forks beyond `maxForkDepth` are rejected.
- VM is disposed on budget termination (no leak).

### Phase 2 — Exposed progress counters (host, small)

**Goal:** make the "complexity factor" observable.

- `error-rewind.ts` / `turn-loop.ts` already track a retry count (`maxRetries: 3`).
  Surface a read-only `progress` snapshot: `{ attempts, verifyFailures, budgetUsed }`.
- Expose to userland via the existing host-tools substrate
  (`packages/core/src/globals/host-tools.ts`) as a read-only global, so a space
  function (and `solve`) can read it. **Read-only** — the worker cannot mutate it.

**Tests** (`packages/core/src/globals/host-tools.test.ts`): counters increment on
eval-error retries; snapshot is immutable from inside the VM.

### Phase 3 — `solve` escalation helper (USERLAND first)

**Goal:** the verifier-gated ladder. Lives in the `engineer` space, *not* core.

- Add as a space function in `fixtures/engineer/` (this is where a sound oracle —
  `tsc` + tests — actually exists).

```ts
// fixtures/engineer/functions/solve.ts  (illustrative signature)
async function solve<T>(opts: {
  task: ForkOpts<T>;
  verify?: (out: T) => { ok: boolean; feedback?: string };
  ladder?: ('retry' | 'race3')[];        // default ['retry', 'race3']
  budget?: { maxAttempts: number };
}): Promise<{ value: T; rung: number; attempts: number }>;
```

**Behavior:**
1. Run `task` once. If no `verify` → return immediately (ladder unreachable).
2. `verify(out)`. If `ok` → return `{ value, rung: 0, attempts }`.
3. Else climb the ladder while budget remains:
   - `retry`: re-run with `feedback` injected into the instruction (the paper's
     "lessons learned" carried forward).
   - `race3`: spawn 3 forks, return the first whose output passes `verify`.
4. Stop at first pass or budget exhaustion; surface `rung`/`attempts` for telemetry.

**Implementation note:** `race3` is a thin `Promise` helper over the existing `fork`
global; no new core primitive. Cancellation of losing forks must dispose their VMs
(respect fork.ts disposal timing).

**Tests** (co-located `fixtures/engineer` exercise + a core-level unit test of the
ladder logic with a stub `fork`):
- no `verify` ⇒ exactly one attempt, `rung 0`.
- `verify` passes first try ⇒ `rung 0`, no extra forks spawned.
- `verify` fails then passes on retry ⇒ `rung 1`.
- persistent failure ⇒ climbs to `race3`, then stops at `budget.maxAttempts`.

**Graduation criterion:** promote `solve` into `@repl/core` *only* if a second space
reuses it. Until then it stays space-local.

### Phase 4 — Per-role model assignment

**Goal:** cheap raters/explorers, capable provers.

- Map fork `role` → model alias in `packages/core/src/fork/roles.ts` +
  `packages/cli/src/providers/resolve.ts` (e.g. `explore` → `LM_MODEL_M`,
  `plan`/`general` → `LM_MODEL_L`). Default to current behavior when unset.

**Tests** (`packages/core/src/fork/roles.test.ts`): role resolves to the configured
alias; absent config falls back to the session default.

---

## 4. Live validation (per CLAUDE.md rules)

Unit tests miss model-behavior issues. After Phases 1–3, drive the built CLI against
`fixtures/engineer` with `--trace` and confirm from the NDJSON:
- a task with a passing first attempt does **not** spawn extra forks (no over-spend);
- a deliberately hard task escalates through the ladder and halts at budget;
- budget termination disposes VMs and surfaces `BudgetExceededError`.

```
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude \
  --trace /tmp/solve.jsonl "<task with a checkable acceptance test>"
```

---

## 5. Sequencing & risk

1. **Phase 1 (budgets)** — highest value, lowest risk, unblocks safe escalation. Ship first.
2. **Phase 2 (counters)** — small, enables Phase 3.
3. **Phase 3 (`solve`)** — the core idea; userland, so reversible and low-blast-radius.
4. **Phase 4 (per-role models)** — independent, cheap, can land anytime.

**Primary risk:** the escalation policy is *itself* complexity — a meta-controller
deciding when to orchestrate harder is exactly the accretion the critique warns
against. Mitigation: keep the ladder tiny (2 rungs), observable (`rung`/`attempts`
returned), overridable (`ladder` arg), and userland. If it grows knobs, it is failing
and should be cut back.

**Non-goal reminder:** this work is only valuable in the narrow verifier zone (the
engineer/coding space). It is a *space* improvement that happens to be reusable — not
a framework-wide feature. Born as space code by design.
