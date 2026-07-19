# Plan — the "repro distiller": turn scenario failures into fast, targeted regression probes

> **STATUS 2026-07-19 — IMPLEMENTED + VALIDATED.** Harness (`lib/assert.mjs` + `lib/assert.test.mjs`
> 15/15, `ScenarioRunner` `seedDir` path, `run-repro.mjs`), distiller prompt (`campaign/distill.md`),
> corpus front-door (`repros/README.md`), and the first repro (`repros/retract-fact-row-grain`) are in
> place; full scenarios+spaces suite 138 green. **Live-validated end-to-end via the revert-test:** the
> retract repro is **GREEN 0/1 on HEAD** (~102s) and **RED 1/4 on the pre-fix commit `eb67ebb^`** (it
> deleted the whole Ngorongoro `safari_days` row) — proving the repro captures the bug, the asserts
> aren't vacuous, and the committed retract_fact fix is verified. Per-run ~50-110s (DeepSeek-V4-Pro),
> vs a 30-40 min full replay. Deferred: the raw-dump repro (its trigger is schema-authoring ⇒ a slow
> build; revisit with a query-shaped trigger) and the rest of the backlog (07/5 persistence, wrong-row,
> vision, action-refusal), plus wiring the distiller into the judge.

**Problem.** The real scenarios are 18–25 steps / 30–40 min, gated by broken session-resume, judged
by a non-deterministic LLM. Verifying one fix means replaying the whole thing. We need a way to test a
*single found problem* in ~1–2 min with a deterministic red/green oracle.

**The core trick (why this works now).** Almost every bug we find is THING **acting on existing
state**, not on restored conversation history. A per-step snapshot already captures the FULL state
(`snapshots/step-NN/.lmthing/project/.data/app.db` + `database/*.json` + `spaces/**`). The runner can
seed a fresh run's data dir from any snapshot (`startRun({seedFrom})`, `runner.mjs:315`) and the
session-history reconnect is a **separate** step (`resumeSessionId = this.resumeFrom ? … : null`,
`runner.mjs:367`). So a probe does:

> **seed real state from a snapshot → start a FRESH THING session → fire the one trigger message → assert mechanically.**

Fresh-session-on-seeded-state is NOT a resume — it sidesteps the resume-contamination/hang bug
entirely. This is buildable independent of the resume fix.

## Decisions (locked — my instinct, per the go-ahead)
1. **Brain-level probes primary** — message → THING → real model turn (highest fidelity to the real
   bug). Flakiness handled by running each probe **N times** and reporting the reproduction RATE
   (buggy = k/N red, fixed = 0/N). A unit-level `--mock`-deterministic tier is a later option, not v1.
2. **Explicit distiller agent first** — pointed at the failure backlog we already have. Auto-emitting a
   probe from the judge is a later wire-in, once the shape is proven.
3. **Seed from a captured snapshot** (Strategy A) — reuses `seedFrom` with zero new seeding code; a
   snapshot is a faithful, complete fixture. A declarative `given:` block (hand-authored minimal state)
   is a later convenience, only if snapshot-seeding proves too heavy.
4. **Mechanical asserts, evaluated by the harness** — the reliability win. `expect` in scenarios is
   prose passed to an LLM judge; a probe's `assert` is a small typed vocabulary the harness checks
   deterministically. LLM judge only as a fallback for genuinely semantic checks.
5. **Validity gate (non-negotiable):** a probe is only valid if it reproduces RED on the commit where
   the bug was observed. Green-on-buggy-code ⇒ it doesn't capture the bug ⇒ reject/iterate. (Same
   discipline as the revert-proven-test rule in `judge.md`.)

Naming: **repro** (dir `scenarios/repros/<id>/`, format `repro.yaml`, agent `campaign/distill.md`) —
"probe" is already taken by the one-off `harness/probe-*.mjs` scripts. Changeable.

## The `repro.yaml` format
```yaml
id: retract-fact-row-grain
from: 06-tanzania#15                 # provenance (scenario#step)
bug: retract_fact deletes a whole row for a field-level note retraction
seed: ./seed                          # a snapshot-shaped dir copied into this repro's own tree
                                      #   (durable; decoupled from the ephemeral run it came from)
runs: 20                              # repeat count → reproduction rate
steps:                                # 1–3 steps, FRESH session (no history reconnect)
  - say: "Scrap that ranger-tip line — it was already included, we paid nothing extra."
assert:                               # MECHANICAL, evaluated by the harness (all must hold to PASS)
  - db safari_segments count == 2                     # the record survives (not row-deleted)
  - db safari_segments where day="Aug 9" exists       # Ngorongoro not collateral-deleted
  - db safari_segments where day="Aug 8" note empty    # only the field cleared
  # other verbs: `knowledge <space> matches /regex/` · `reply not_raw` · `yield absent webSearch`
red_on: fa008df                       # stamped by the distiller once red is proven
```

## The assert vocabulary (`lib/assert.mjs`, new)
Deterministic checks over what `snapshot()` + the turn evidence already expose (`evidence.mjs`):
- `db <table> count <op> <n>` — row count (via `pod.appData`).
- `db <table> where <col>=<v> exists|absent` — presence of a matching row.
- `db <table> where <col>=<v> <field> empty|== <v2>` — a field's value on the matched row (row-vs-field grain).
- `knowledge <space> matches /regex/` — a space knowledge file exists whose body matches (via a
  space-file read; the persistence oracle).
- `reply not_raw` — `lastText` is not a bare `{...}`/JSON dump (the raw-introspection-dump oracle).
- `yield present|absent <kind>` — e.g. `webSearch`/`webFetch` fired or not (research oracle).
Each returns `{pass, actual}`; the harness records them exactly like `report.mjs#check`, so the
existing golden-test style applies.

## Harness delta (small, additive)
- `run-repro.mjs` (new, sibling of `run-scenario.mjs`) — parse `repro.yaml`; for `i in 1..runs`: call
  `startRun({ seedFrom: <repro>/seed })` **without** the resume session reconnect (fresh session);
  play `steps` via the existing `runStep`; evaluate `assert` via `lib/assert.mjs`; collect red/green.
  Report `k/N red` + per-assert actuals.
- `runner.mjs` — add a `seedState`/`freshSession` path: seed the data dir from a dir (reusing the
  `seedFrom` copy) while NOT setting `resumeSessionId`. This is the one real change to the runner; it's
  a narrowing of the existing resume path (state without history).
- `lib/assert.mjs` + `lib/assert.test.mjs` — the evaluator + golden tests (the harness's own gate,
  `pnpm test scenarios`).
- `scenarios/repros/<id>/{repro.yaml, seed/, runs/}` — the corpus home.

## The distiller agent (`campaign/distill.md`, new — sibling of `judge.md`)
Input: a judged failure (the failed `expect` bullet + evidence cite + layer diagnosis) and the real
run dir. It:
1. Copies the pre-bug snapshot (`runs/<n>/snapshots/step-<K-1>`) into `repros/<id>/seed/`.
2. Extracts the trigger message(s) from step K.
3. Writes the mechanical `assert` from the failed expectation + the evidence.
4. Runs the probe ×N against HEAD; **confirms RED** (rate > 0). If green: escalate (add 1–2 setup turns
   / more seeded state) or reject as non-reproducing. Stamps `red_on`.
5. Reports the probe + red-proof; the orchestrator commits (same no-self-commit discipline as judge.md).

## Phases & deliverables
- **Phase 0 — spike (de-risk the core claim).** Hand-build ONE repro end-to-end and prove it goes red,
  to confirm seed-state + fresh-session reproduces a real bug with no history. Target: **10-family
  #12 raw-dump** (seed `runs/2/snapshots/step-11`, in-app trigger, `assert reply not_raw`) — mechanical,
  reached, snapshotted. Fallback target: **07 #5 persistence** (seed `runs/22/snapshots/step-04`, ask the
  research question, `assert knowledge <space> matches /…/`). No new format work yet — just prove the
  mechanism with a throwaway script.
- **Phase 1 — format + harness.** `repro.yaml`, `run-repro.mjs`, `lib/assert.mjs` + tests, the runner
  `freshSession` path. Green golden tests.
- **Phase 2 — distiller agent.** `campaign/distill.md` + the red-proof loop.
- **Phase 3 — seed the corpus + wire in.** Distill the known backlog (07/5 persistence, 10/12 raw-dump,
  retract_fact 06/15, vision, wrong-row 06/16, action-refusal 06/13·07/12), add a `pnpm repro` sweep
  (the fast regression suite), then optionally auto-emit a repro from the judge on a fresh failure.

## Risks & mitigations
- **Over-minimization → false green:** the red-proof gate catches it; seed from the full pre-bug
  snapshot first, minimize only while it stays red.
- **Bug needs prior in-session context:** escalate state-only → state + 1–2 setup turns → (last resort)
  trimmed snapshot; only when state-only won't reproduce.
- **Residual non-determinism:** the ×N rate is the metric; a fix must drive k/N → 0/N, not just "a
  green run."
- **Snapshot heft:** snapshots carry built pages/dist; prune `seed/` to `database/ + .data/app.db +
  spaces/` where the app UI isn't needed.

## Non-goals
Repros do NOT replace the full scenarios (those still find NEW bugs end-to-end and exercise the tail
resume/restart machinery). They are the fast INNER loop that pins a found bug so a fix is verified in
minutes and guarded forever.
