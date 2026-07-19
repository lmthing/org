# Distill a scenario failure into a targeted repro

You take ONE judged failure from a full scenario and distill it into a **repro** — a tiny, fast,
mechanically-scored regression probe that reproduces JUST that bug — so a fix is verified in ~1–2 min
instead of a 30–40 min / resume-blocked replay, and the bug is guarded forever after.

You do **not** commit and you do not edit product/source on your own authority. You AUTHOR the repro,
PROVE it reproduces (goes RED on the buggy commit), and REPORT it + the reproduction rate to the
orchestrator, which reviews and commits. (Running repros needs no OK; committing does.)

**First read [`scenario-spec.md`](./scenario-spec.md)** (the scenario.yaml format + invariants) and
[`judge.md`](./judge.md) (how a step is judged — a repro's `assert` is the mechanical form of a step's
`expect`). The repro harness is `scenarios/run-repro.mjs`; its assert DSL is `scenarios/lib/assert.mjs`.

## Why this works (and why it dodges the resume bug)
Almost every bug is THING **acting on existing state**, not on restored conversation history. A repro
**seeds real state from a captured snapshot** and starts a **FRESH session** — which is NOT a resume
(no history to restore), so it sidesteps the broken `Session.resume()` entirely. Seed → fire the one
trigger → assert mechanically → repeat N times → the reproduction RATE is the fix's oracle:

- **buggy code** → some/all runs RED (an assert fails ⇒ the bug is present), rate > 0
- **fixed code** → every run GREEN (all asserts pass), rate = 0/N

## Inputs you are given
- The failing `<scenario>#<K>` (scenario id + step number) and the `expect:` bullet that failed.
- The real run dir `<scenario>/runs/<n>/` — its `step-<K>.json` (the evidence of the failure) and its
  per-step snapshots `snapshots/step-NN/` (the seed source).
- The layer diagnosis if known (which subsystem is at fault).

## The procedure
1. **Read the failure.** `<scenario>/scenario.yaml` step K's message(s) + `expect`; `runs/<n>/step-<K>.json`
   for WHAT went wrong (the reply, the yields, the state); confirm the pre-bug snapshot exists at
   `runs/<n>/snapshots/step-<K-1>` (the last GOOD state).
2. **Seed = the last-good snapshot, de-wrapped + pruned.** A snapshot carries the full state
   (`.data/app.db` rows + `database/*.json` + `spaces/**`); the fixed source is adopted on boot
   (`--adopt-system-spaces`), so the repro always tests current source. Store it as a BARE seed (no
   `.lmthing/` wrapper — that dir is gitignored) and shrink it so it's fast to boot and small to commit:
   ```bash
   mkdir -p scenarios/repros/<id>
   cp -r <scenario>/runs/<n>/snapshots/step-<K-1>/.lmthing/<project> scenarios/repros/<id>/seed/<project>
   cd scenarios/repros/<id>/seed/<project>
   rm -rf sessions pages api components types documents .data/pages-dist .data/pages-build .data/pages-cache.json
   sqlite3 .data/app.db "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" && rm -f .data/app.db-wal .data/app.db-shm
   ```
   Keep `database/`, `.data/app.db`, `project.json`, and `spaces/` (drop `spaces/` too if the bug
   doesn't need them). `seedRun()` re-wraps the bare seed into `.lmthing/` on boot.
3. **Trigger = step K's message(s).** Copy step K's `say` / `in_app_chat` (+ `attach`) into the repro's
   `steps:`. Include a prior step's message as a setup turn ONLY if the bug needs in-session context
   (a "same question again" / "don't re-search" shape); default to state-only.
4. **Write the mechanical `assert`** from the failed `expect`, encoding CORRECT behaviour (green =
   correct, red = bug). Use the DSL (below). Prefer a sharp, single-cause oracle; add a corroborating
   assert if one cause has two signatures. The fixture is concrete — the "zero scenario literals" rule
   is for system-wide PROMPTS, NOT test fixtures, so name real tables/rows freely.
5. **Author `scenarios/repros/<id>/repro.yaml`:**
   ```yaml
   id: <kebab>
   from: <scenario>#<K>
   bug: <one line>
   seed: ./seed
   seedProject: <the project dir under seed/.lmthing/ — e.g. tanzania-trip, project, household-admin>
   runs: <N — 10–20 for a stochastic bug, 3–5 for a systematic one>
   steps: [ … the trigger(s) … ]
   assert: [ "<mechanical assert>", … ]
   ```
6. **PROVE RED on HEAD.** `node scenarios/run-repro.mjs <id>` (add `--runs N`). READ the actual output —
   the final `REPRO <id>: RED k/N` line is the reproduction rate. It MUST be RED (k > 0) to be a valid
   repro.
   - **GREEN 0/N** ⇒ the repro does not capture the bug. Escalate: sharpen/lengthen the trigger, seed
     more state, or add a setup turn; re-run. If after escalation it stays green, the bug may genuinely
     be gone on HEAD — report THAT (do not keep a green "repro"; a green-on-buggy repro is worthless).
   - A low rate (e.g. 3/20) is fine and expected for a stochastic bug — it is a real, measurable signal;
     record it.
7. **Report + STOP.** Stamp `red_on: <short-sha>` in the repro. Report to the orchestrator: the repro
   path, the reproduction rate on HEAD, the failing asserts + their actuals, and (for the fix loop) that
   a fix is verified when the SAME command reports `GREEN 0/N`. The orchestrator commits.

## The assert DSL (`scenarios/lib/assert.mjs`)
Evaluated deterministically against `rec.state` (spaces + app tables WITH rows + manifest), the turn
evidence (reply, yield kinds, delegates), and the run's on-disk space-knowledge files.
```
db <table> count <op> <n>                     # <op> ∈ == != >= <= > <
db <table> where <col>=<val> exists | absent
db <table> where <col>=<val> <field> empty | nonempty
db <table> where <col>=<val> <field> == <v2>  # (or !=)
knowledge <spaceSubstr|*> matches /<regex>/[i] # a space-knowledge file body matches (persistence oracle)
reply not_raw                                  # the reply is not a raw data dump (raw-introspection oracle)
reply matches | not_matches /<regex>/[i]       # over the reply's RENDERED text
yield present | absent <kind>                  # webSearch/webFetch fired or not (research oracle), etc.
```
Values may be `"quoted"` to include spaces. A malformed assert never silently passes. If the failure
needs an observable the DSL can't express, propose the new assert verb to the orchestrator (a harness
change in `lib/assert.mjs` + a golden case in `lib/assert.test.mjs`) — do NOT hand-wave it in prose.

## Mapping a failure class → its oracle (examples)
- **row-vs-field grain (retract deletes a record):** `db <t> count == <preserved>` + `db <t> where
  <id>=<v> exists` + `db <t> where <id>=<v> <field> empty`.
- **research not persisted:** `knowledge <space> matches /<the fact>/` (RED when absent) + optionally
  `yield present webFetch` (it did research) to prove it's a persistence, not a research, failure.
- **raw-introspection dump as answer:** `reply not_raw`.
- **answered the wrong thing / from the wrong data:** `reply matches /<the right answer>/` +
  `yield absent webSearch` (a personal read must not search).
- **claim-without-write (says done, state unchanged):** `db <t> where …` / `knowledge … matches` for the
  change it CLAIMED — RED when the state doesn't back the claim.

## Guardrails
- **Minimize only while it stays red.** Seed from the FULL pre-bug snapshot first (faithful by
  construction); prune tables/spaces from `seed/` only as far as the repro stays RED.
- **The rate is measured, never claimed.** Read `run-repro.mjs`'s real output; report the actual k/N.
- **One repro = one bug.** If step K fails two independent expectations, author two repros.
