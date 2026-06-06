# fixtures/solver

A minimal coding agent for **live-testing the `solve` verifier-gated escalation**
(Phase 3 of `.claude/plans/live-testing.md`). Each `solve` attempt writes a candidate
to `work/candidate.ts`; the `verifyCommand` type-checks it; failures escalate the
ladder (single → retry-with-feedback → race-N), bounded by the run budget.

`solve` is a built-in global, so this space declares no functions of its own — it only
demonstrates the pattern. The attempts write into `work/` (gitignored scratch).

## Running

```bash
CLI="node packages/cli/dist/cli/bin.js"
T=/tmp/solver.jsonl

# 3A — easy, should verify on the first attempt (rung 0, attempts 1)
$CLI --space fixtures/solver --claude --trace $T \
  "implement add(a: number, b: number): number returning a + b"

# 3B — likely needs a retry (the feedback from tsc guides attempt 2)
$CLI --space fixtures/solver --claude --trace $T \
  "implement parseDuration(s: string): number supporting ms/s/min/h, throwing on bad input"

# 3C/3F — harder; combine with a budget cap to prove the ladder is bounded
$CLI --space fixtures/solver --claude --max-episodes 12 --max-fork-depth 2 --trace $T \
  "<a harder, strictly-typed task>"
```

## What to assert in the trace (see live-testing.md §2 for jq recipes)

- Distinct `fork:*` conversations = number of attempts; for 3A there is exactly one.
- On 3B, the 2nd attempt's `llm_request` contains the tsc error text (feedback carried).
- `solve`'s resolved value `{ verified, rung, attempts }` matches the escalation taken.
- With a budget cap, escalation stops with a `BudgetExceededError` rather than running away.

## Notes

- `verifyCommand` runs with the **space dir** as cwd, so `work/candidate.ts` resolves.
- `npx tsc` resolves the repo's TypeScript; no install needed when run from the monorepo.
