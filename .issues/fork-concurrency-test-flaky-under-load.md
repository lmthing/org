# `fork.test.ts` "runs forks in parallel up to the cap" is flaky under full-suite load

**Where:** `libs/core/src/fork/fork.test.ts` → `ForkEngine > concurrency (maxConcurrentForks) > runs
forks in parallel up to the cap`

**Symptom:** fails during a full `pnpm test` run (1 failed / 2189 passed), passes 3/3 when run
alone (`pnpm test libs/core/src/fork/fork.test.ts` → 25 passed each time).

**Why it is a flake, not a regression:** the assertion is about observed *parallelism* — how many
forks are in flight at once — which it infers from wall-clock interleaving. Under a full vitest run
the worker pool is saturated, so scheduled continuations land late enough that the observed peak
concurrency dips below the cap even though the engine is behaving correctly. Nothing in the fork
engine changed; this surfaced while working the Tamagui migration, which touches only
`libs/{ui,css,auth}`.

**Fix direction:** make the assertion deterministic instead of timing-derived — have the test's
fake work signal entry/exit through a counter the engine increments, and assert on the peak of that
counter rather than on elapsed time. A `vi.useFakeTimers()` clock would also work if the engine's
scheduling is timer-driven.

**Do not** paper over it with a retry or a longer timeout: the test's whole value is proving the cap
is honoured, and a time-based proof of that is what makes it fragile.
