# Two tests flake under full-suite worker saturation (never in isolation)

**Symptom:** a full `pnpm test` from `sdk/org` fails exactly one test, but **which** one varies
between runs. Observed:

- `libs/core/src/fork/fork.test.ts` → `ForkEngine > concurrency (maxConcurrentForks) > runs forks in
  parallel up to the cap`
- `libs/cli/src/server/session-manager.spaceref.test.ts` → `a plain project session still persists
  under <project>/sessions/`

Each passes **3/3 when run alone**. The rest of the suite is stable at 2189 passed / 24 skipped.

**Why these are flakes, not regressions:** the varying identity is the tell — a real regression fails
the same test every time. Both assertions are timing-derived under a saturated vitest worker pool:
the fork test infers *observed parallelism* from wall-clock interleaving, so late-scheduled
continuations make the observed peak dip below the cap even though the engine honours it; the
session-manager test races a filesystem write against its assertion. Neither area was touched by the
Tamagui migration, which is confined to `libs/{ui,css,auth}`.

**Fix direction — do NOT paper over either with a retry or a longer timeout.** A time-based proof of
a concurrency cap is exactly what makes it fragile, and the cap is the whole point of that test.

- `fork.test.ts`: have the fake work signal entry/exit through a counter the engine increments and
  assert on that counter's peak, not on elapsed time. `vi.useFakeTimers()` also works if the
  scheduling is timer-driven.
- `session-manager.spaceref.test.ts`: await the write the assertion depends on rather than the
  promise that merely schedules it.

**Reproduce:** `cd sdk/org && pnpm test` (a few runs; it does not fail every time).
