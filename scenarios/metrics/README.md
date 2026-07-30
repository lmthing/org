# scenarios/metrics — the ratchet dashboard

Computes the Part 3 "improvement loop" ratchet metrics
(`design/appbuilder-viewspec-plan.md`, section "Part 3") from a scenario run's on-disk artifacts:
vocabulary-gap rate, procrustean rate, retries-per-write, layout/shell-override rate, bricking rate,
the three build gates, tokens/forks/wall-clock, and (once a judge has run) judge-invariant score and
visual-gate pass rate.

Zero dependencies — Node built-ins only, same rule as the rest of `scenarios/`.

## Run it

```bash
cd sdk/org
node scenarios/metrics/dashboard.mjs                       # every scenario, latest complete run
node scenarios/metrics/dashboard.mjs 13-plant-care          # one scenario, latest complete run
node scenarios/metrics/dashboard.mjs 13-plant-care 3        # one scenario, one specific run
node scenarios/metrics/dashboard.mjs 13-plant-care --all    # every run of that scenario, as a trend
```

Flags: `--json <path>` writes the report somewhere other than the default `scenarios/metrics/out/`
(gitignored — regenerate, don't commit); `--quiet` suppresses the printed table but still writes JSON.

Exit code is `1` if any **measured** metric misses its `lib/targets.mjs` bar, `0` otherwise. A `null`
metric (an honest measurement gap — see below) never fails the exit code by itself; it prints as a
`null: <reason>` status line instead, so a gap in the evidence is visible without being scored as a
regression.

## Module map

- `lib/artifacts.mjs` — locates/loads everything one scenario run left on disk: `run.json`,
  `step-NN.json`, `sessions-ledger.jsonl`, the built project's `pages/**/*.view.json`, and every
  session's `trace.json`.
- `lib/scope.mjs` — reduces a session `trace.json` (routinely 5–20 MB) to a bounded digest: writer
  calls, writer errors classified as host-fault vs. real rejection, token/fork counts, and the
  host-serialized `plan_views`/`verify` values that leak into a downstream fork's prompt (see the
  docblock — it cites `libs/core/src/fork/fork.ts:L398-L407` for exactly why this works).
- `lib/metrics.mjs` — the pure metric functions. Every metric returns `{value, reason}` — `reason` is
  populated and `value` is `null` whenever the metric cannot be honestly extracted (a vacuous
  denominator, a gate that never ran, no judge verdict yet). **A `null` is a measurement gap; a `0` is
  a measurement** — the two are never conflated.
- `lib/targets.mjs` — the plan's Part 3 targets as data: `better: 'lower'|'higher'|'zero'|'toward'`
  and a `target: {op, value}` per metric, plus `meetsTarget`/`movement` helpers.
- `dashboard.mjs` — the CLI above: wires the four modules together, prints the table, writes JSON.
- `judge-contract.md` — the shape of `judge.json`, the one artifact this pipeline does **not**
  produce itself (a human or an lmauto judge campaign writes it after scoring a run's screenshots /
  invariants / procrustean-fit calls). Every judged metric (`procrustean`, `judge-invariants`,
  `visual-gate`, and `binding-coverage`'s judge-supplied override) is `null` until that file exists.

## What "null" means here

Every metric can come back `null` instead of `0`. This is deliberate — see `lib/metrics.mjs`'s
docblock: a `0` reads as "clean", and that inversion is exactly how `renderSmokeViews` once reported a
fully-broken page as 100% covered (`PROGRESS.md`, Wave 2). A vacuous denominator (zero pages built,
zero writes attempted, a gate that never ran) is not a pass — it's an absence of evidence, reported as
`null` with the specific reason so a human can tell "nothing broke" from "nothing was measured" at a
glance.

## Tests

`tests/*.test.mjs` (vitest, this repo's `.test.mjs` convention for `scenarios/**`) — pure-function
unit tests against small synthetic fixtures, not full recorded runs. Run with:

```bash
cd sdk/org && pnpm test scenarios/metrics
```
