# repros — targeted regression probes distilled from scenario failures

A **repro** reproduces ONE found bug FAST. Where a full `scenario.yaml` is 18–25 steps / 30–40 min /
blocked by the broken session-resume / judged by an LLM, a repro is **1–3 steps / ~1–2 min /
mechanically scored** — the fast INNER loop for verifying a fix.

## How it works
```
seed real state from a captured snapshot  →  boot a pod  →  start a FRESH session (no history)
     →  fire the trigger message(s)  →  evaluate a mechanical `assert:` block  →  repeat N times
```
A fresh session on seeded state is **not** a resume (there is no history to restore), so a repro
sidesteps the `Session.resume()` bug entirely. The reproduction RATE is the fix's oracle:

- **buggy code** → some/all runs **RED** (an assert fails ⇒ the bug is present), rate > 0
- **fixed code** → every run **GREEN** (all asserts pass), rate 0/N

A repro is only VALID once it is proven RED on the commit where the bug was observed.

## Run one
```bash
node scenarios/run-repro.mjs <id>            # scenarios/repros/<id>/repro.yaml
node scenarios/run-repro.mjs <id> --runs 20  # more repeats → a sharper reproduction rate
node scenarios/run-repro.mjs <id> --keep     # keep each run dir (default: purged after scoring)
```
The last line is the verdict: `REPRO <id>: RED k/N` (bug present) or `GREEN 0/N` (fixed).

## Layout
```
repros/<id>/
  repro.yaml     # id · from · bug · seed · seedProject · runs · steps · assert
  seed/          # a BARE state fixture: seed/<project>/{database, .data/app.db, spaces, project.json}
  runs/<n>/      # per-run evidence (git-ignored; only kept with --keep)
```
The seed is stored **de-wrapped** — the project dirs sit directly under `seed/` with NO `.lmthing/`
wrapper, so it escapes the blanket `.lmthing/` gitignore and is committed with the repro. `seedRun()`
re-wraps it into the run's `.lmthing/` on boot. Keep seeds small: checkpoint the WAL into `app.db`
(`sqlite3 app.db "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"` then drop
`app.db-wal`/`-shm`) and drop everything the asserts don't need (old `sessions/`, the built-app
`pages`/`api`/`.data/pages-*`, the `user` home).

## Authoring
Point the distiller agent at a judged failure — see [`../campaign/distill.md`](../campaign/distill.md).
The mechanical assert DSL lives in [`../lib/assert.mjs`](../lib/assert.mjs) (golden tests:
`../lib/assert.test.mjs`).

Repros do **not** replace the full scenarios — those still find NEW bugs end-to-end and exercise the
tail restart/resume machinery. Repros pin a FOUND bug so a fix is verified in minutes and guarded
forever.
