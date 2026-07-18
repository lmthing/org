# scenarios/campaign — the run-judge-fix brain

The agent-facing prompts that drive the scenario campaign: run each `scenarios/<id>/scenario.yaml`
end-to-end against a per-run local `lmthing serve`, **judge every step** on the execution trace + real
state, and on a failing step **fix it at the right rung** (L0 scenario / L1 prompt / L2 structure /
L3 framework) and prove the fix with a snapshot-resume rerun — until every step is green.

This lives inside the scenarios mechanism on purpose. The old `automation/lmauto` engine is
**deprecated**; these prompts are read directly by the orchestrator's subagents. There is no template
engine — `<SCENARIO_ID>` is a placeholder the orchestrator fills in each spawn prompt, and every path
is relative to the repo's `sdk/org` directory.

## The prompts

| File | Role |
|---|---|
| `scenario-spec.md` | shared foundation: the `scenario.yaml` format, the real-person rules, the three-store contract, the invariant library ("Asking well" included), the feature map, generalize-never-overfit. Every other prompt says "read this first." |
| `judge.md` | the runner-judge-fixer: launch the runner, poll step evidence (2-min log checks), judge each step, fix the first failure at the lowest rung, verify with `--resume/--from`, drive to fully green. Owns a disjoint subsystem; **reports each decision and awaits the orchestrator's OK, then signals the verified fix — never commits itself.** |
| `migrate.md` | convert a prose `scenarios/<id>/scenario.md` + `fixtures/` into `scenario.yaml`, wiring every fixture; validate with `--plan`. |
| `create.md` | author a brand-new `scenario.yaml` + real fixtures. |
| `extend.md` | grow a fully-green scenario in-persona toward an untouched capability. |
| `orchestrator.md` | the Opus orchestrator's own durable runbook: fan-out, concurrency, disjoint subsystem ownership, review+commit gate, the 5h-usage guard, the 200k-token context-cap handoff. |

## Who commits

The Opus **orchestrator** is the sole committer. Subagents leave changes uncommitted in the shared
`main` working tree, coordinated by disjoint per-lane subsystem ownership (not a lock), and signal the
orchestrator, which reviews the diff (hard anti-overfit + typecheck/test/lint gates) and
commits+pushes to `main`, or feeds back for a revision.

## State (gitignored — `state/`)

- `state/orchestrator-state.json` — the orchestrator's live ledger, including the `coordination`
  field: the live disjoint-ownership split (which lane owns which paths).
- `state/<id>.handoff.md` — per-scenario resume note for the 200k-token context-cap handoff.

The one TRACKED memory is `attempts/<id>.md` — the cross-attempt fix ledger every judge round reads
first and appends to last.

## Running one by hand

    node scenarios/run-scenario.mjs <id> --plan     # dry plan + fixture-coverage audit (no pod)
    node scenarios/run-scenario.mjs <id>            # a fresh run under scenarios/<id>/runs/<n>/
    node scenarios/harness/runs.mjs <id> list       # runs + liveness

`06-tanzania` / `07-life-admin` have `scenario.yaml`. `08-small-shop` / `09-home-renovation` /
`10-family-recipes` are migrated from their `scenario.md` by `migrate.md` first.
