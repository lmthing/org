# `judge.json` — the contract `lib/metrics.mjs`'s judged metrics read

`judge.json` lives at `scenarios/<scenarioId>/runs/<n>/judge.json`, sibling to `run.json` and the
`step-NN.json` evidence. **The scenario runner never writes it.** It is the verdict file a judge —
today a human reading the run's evidence + screenshots per `scenarios/campaign/judge.md`'s scoring
rules, eventually an lmauto judge campaign — writes after scoring a completed run. Its absence is the
normal state before a judge has looked, which is why every metric below comes back `null` with a
reason (`lib/artifacts.mjs#loadRun` sets `judge: null` when the file is missing — never `{}`, which
would silently satisfy an `Array.isArray` check with a passing-looking absence).

Only four `lib/metrics.mjs` functions read this file: `procrustean`, `bindingCoverage`,
`judgeInvariants`, `visualGate`. Every field below is **optional** — a judge may score only some of a
run's dimensions, and each metric degrades to `null` independently, keyed off its own field(s) only.

## Shape

```jsonc
{
  // Bucket-1 force-fits (Part 3 of the plan): one entry per page/section the judge decided is a
  // vocabulary mismatch that PASSED every gate anyway (a `list` standing in for a `timeline`, etc.).
  // Read by `procrustean()`. Route de-duplicated — multiple findings on one route count once.
  "procrustean": [
    { "route": "trips/timeline", "section": "timeline-of-events", "note": "list section force-fit for a genuine timeline ask" }
  ],

  // Fraction (0–1) of bound fields the judge confirmed are non-null on REAL rendered data — the
  // number `renderSmokeViews` computes internally but never persists past `16-verify`'s reduction
  // (see `lib/metrics.mjs#bindingCoverage`'s docblock). Judge-supplied ONLY; there is no other source.
  // Omit when the judge did not check binding coverage — do not write 0 or 1 as a placeholder.
  "bindingCoverage": 0.92,

  // Screenshot-judged visual gate (Workstream D / T6 tier 3), one verdict per target actually shot.
  // Omit a key (rather than writing null) for a target that was never screenshotted.
  "visualGate": { "web": "pass", "native": "fail" },

  // Per-scenario-step invariant verdicts — the same steps the step-NN.json evidence carries, each
  // scored PASS/FAIL by the judge against scenario-spec.md's invariant library + judge.md's ask
  // scoring rules. `judgeInvariants()` reads ONLY `verdict`; `reason`/`invariant` are for a human
  // reading the file, not consumed by any metric today.
  "steps": [
    { "step": 1, "verdict": "PASS", "invariant": "asking-well", "reason": "consent card shown before installSpace" },
    { "step": 2, "verdict": "FAIL", "invariant": "no-fabrication", "reason": "finalize reported success with a lost tasklist envelope" }
  ]
}
```

## Rules for whoever writes this file

- **Never write a placeholder value to make a metric "green".** A `0` and a `null` mean different
  things to every reader of the dashboard (see `README.md`'s "What null means here") — write a field
  only when you actually scored that dimension.
- `procrustean` findings are about a spec that **validates** — every gate is clean and the writer
  accepted it; the force-fit is a judgement call about the wrong section KIND being used, not a schema
  violation. If the gates themselves failed, that is a `gate-*` metric's job, not this one.
- `steps[].verdict` must be exactly `"PASS"` (uppercase) — `judgeInvariants()` matches it literally.
- Route strings in `procrustean[].route` should match the `route` field `lib/artifacts.mjs#loadProjectViews`
  derives from the page's path under `pages/` (e.g. `plants/[id]`, not `pages/plants/[id].view.json`).
