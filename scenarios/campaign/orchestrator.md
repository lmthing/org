# Scenario-campaign orchestrator (Opus → Sonnet fan-out) — durable runbook

This file is the **durable brain of the autonomous orchestrator**. A fresh Opus context (after a
usage-reset wakeup or its own handoff) reads THIS file + `scenarios/campaign/state/orchestrator-state.json`
+ each live scenario's `scenarios/campaign/state/<id>.handoff.md` and resumes with no lost work. It
never asks the human anything.

> Paths here are relative to the repo's **`sdk/org`** directory — the orchestrator's (and the
> subagents') working directory. The deprecated `automation/lmauto` engine is NOT used and subagents
> must never be pointed at it; the entire campaign brain lives here under `scenarios/campaign/`.

## Mission

Drive the lmthing scenario campaign to green, fully automated:
1. **Migrate** `08-small-shop` / `09-home-renovation` / `10-family-recipes` from prose `scenario.md`
   + `fixtures/` → `scenario.yaml` (one Sonnet subagent each, `scenarios/campaign/migrate.md`).
2. **Run** every scenario (`06`, `07`, then `08`/`09`/`10` as they land) to fully green — one Sonnet
   runner-judge-fixer each, `scenarios/campaign/judge.md`: play the runner step-by-step, judge each
   step, fix failing steps at the lowest rung in source (prefer loadable knowledge over prompt prose
   — never overfit), verify via snapshot/resume, until all steps pass.
3. **Review + commit.** The orchestrator is the sole committer. It reviews each ready fix, submitted
   under disjoint subsystem ownership, and commits+pushes to `main` as early as possible, or feeds
   back to the subagent.

## Substrate

- **Orchestrator = the Opus session** (this one), working dir `sdk/org`. Subagents = `Agent` tool,
  `model: sonnet`, background, all in the **shared `main` working tree** (no worktrees). `sdk/org` is
  a git submodule; "main" = the submodule's `main`. After committing there, bump the parent
  superproject's submodule pointer.
- **Brain prompts** the subagents read (give concrete `<SCENARIO_ID>` in the spawn prompt; they
  substitute it): `scenarios/campaign/{scenario-spec.md, judge.md, migrate.md, create.md, extend.md}`.
- **Runner:** `node scenarios/run-scenario.mjs <id>` — per-run isolated server on an allocated port
  under `scenarios/<id>/runs/<n>/`, per-step snapshots, `--resume <runId> --from N`, `--plan` (dry).
  No build (tsx from source; `--adopt-system-spaces` every boot). Evidence: `runs/<n>/step-NN.json`
  (compact — poll this), `.full.json`, `trace.md`, `run.json.completedSteps`. Logs:
  `runs/<n>/sessions.log`, `runs/<n>/data/.lmthing/sessions-ledger.jsonl`.

## Concurrency (bounded)

- 3 migration subagents in parallel immediately (cheap — YAML authoring, no pod).
- ≤2 scenario runners at once to start (06, 07); add 08/09/10 runners as migrations land — **cap ~3
  expensive runner lanes** total. Migrations don't count against the runner cap.
- Runs parallelize freely (isolated `runs/<n>/` + servers). **Source edits are serialized by disjoint
  per-lane subsystem ownership** (below), so only one subagent's tracked diff is ever pending review
  per subsystem.

## Coordination — disjoint subsystem ownership (no lock)

An earlier `mkdir`-based edit-lock (`scenarios/campaign/state/edit.lock/`) deadlocked in practice — a
lane held it through a long run — and has been RETIRED. Coordination is now **disjoint file ownership
by subsystem**, path-scoped commits, with the orchestrator as sole committer. Assign each lane a
subsystem it owns exclusively — a typical split: THING brain (`user-thing/agents/thing/instruct.md` +
`user-thing/knowledge/**` + the instruct content tests); appbuilder + organizing
(`system-appbuilder/**` + `user-thing/tasklists/organize_material/**` +
`user-thing/knowledge/organizing/**`); architect + sessions (`system-architect/**` +
`libs/core/src/session/session.ts`); core globals / the runner mechanism / `loadKnowledge` impl —
cross-cutting, owned by the orchestrator itself (edit directly, or hand a scoped task to whichever
lane has the context).

A lane that hits a failure in ANOTHER subsystem REPORTS it to the orchestrator — it does not edit
outside its lane. A genuinely shared file (e.g. `session.ts`) is claimed, not assumed: the lane
SendMessages the orchestrator **"CLAIMING <file>"** before editing it. Ownership can be REASSIGNED
between lanes when one finishes — verify the file is clean first (`git status --porcelain -- <file>`
empty) before handing it over. The live split is recorded in `orchestrator-state.json`'s
`coordination` field — that JSON, not this file, is the current-truth record of who owns what right
now.

## Review + commit-or-feedback gate

When a subagent signals a ready fix (or a migration finishes):
1. `git -C sdk/org status --porcelain` + `git -C sdk/org diff -- <named files>` — review ONLY the
   files the subagent named (path-scoped).
2. **Anti-overfit (hard gate).** For any edited `agents/**/instruct.md|charter.md`,
   `tasklists/**/*.md`, or space-function body: grep for scenario literals (persona names, place
   names, fixture tokens) AND domain framing (e.g. "trip"/"recipe"/"tenant" reasoning in a
   system-wide brain). Domain heuristics MUST live in `knowledge/<domain>/<field>/<option>.md` loaded
   on demand (the `user-thing/knowledge/organizing/split/` pattern), never in a system-wide prompt.
   Violation → **feedback, no commit**.
3. **Correctness gate** (from `sdk/org`): `pnpm typecheck`; `pnpm test <touched path>`; `pnpm
   lint:tokens`; for a mechanism fix, `pnpm test scenarios`; for L3 core, `pnpm docs:check` + require
   the matching `org/docs/` page in the diff.
4. **Migration diff:** `node scenarios/run-scenario.mjs <id> --plan` parses + all fixtures ✅.
5. **Commit** (path-scoped): `git -C sdk/org add <named files> && git -C sdk/org commit -m "<msg>"`
   with the trailer, then `git -C sdk/org push origin HEAD:main`. Bump the parent pointer:
   `git -C . add sdk/org && git -C . commit -m "bump sdk/org: <msg>" && git -C . push origin HEAD:main`
   (from repo root). Then SendMessage the subagent it's committed → continue.
6. **Feedback path:** if wrong/overfit, `SendMessage` the subagent specific, actionable feedback; it
   revises inside its owned subsystem and re-signals. Never commit an overfit or red-gate diff.

Commit message trailer (both repos):

    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01FJnNWbu2dhpPtzhDdbxWqR

## Usage guard (strict 95%) — the shared 5h budget

- The statusline wrapper `~/.claude/statusline-capture.sh` writes `~/.claude/lmthing-orchestrator/
  usage.json = {updated_at(ms), five_hour:{used_percentage,resets_at}, seven_day, …}` on every
  render. Each orchestrator turn is a render, so it's fresh when read.
- **Every heartbeat read `five_hour.used_percentage`.** If **≥ 95**: SendMessage every live subagent
  to ensure `handoff.md` + latest snapshot are current, then stop; stop launching new subagents;
  record `paused_at` + `resets_at` in state. Then **schedule the restart**: `ScheduleWakeup` clamps to
  ≤3600s, but a 5h reset can be further out, so CHAIN — schedule 3600s, and on each wake re-check
  `usage.json.resets_at`; if the reset epoch hasn't passed, reschedule; once past (and
  `used_percentage` dropped), resume. Subagents are stopped during the pause, so usage stays flat
  below 100% and the tiny chained-wakeup turns never lock out.
- **On resume:** re-spawn each paused scenario from its `handoff.md` (`--resume <runId> --from <K-1>`).
- **Heartbeat cadence while active:** `ScheduleWakeup` ~600s + subagent-completion notifications (also
  heartbeats). Read usage, check subagent liveness + the Monitor `until`-loop over `statusline.json`'s
  per-subagent `tokens` (CAP=200000 — see "200k-token context-cap handoff" below; NOT `output_file`
  byte size, which never reflects real context size), review any pending fix.

## 200k-token context-cap handoff

Each subagent maintains `scenarios/campaign/state/<id>.handoff.md` after EVERY step (current step,
`--resume <runId> --from <K-1>` point, per-step verdicts, fixes+files, any edit in flight). Two
triggers:
1. The subagent self-checkpoints and stops at ~200,000 tokens of its own context (finishing or
   reverting any in-flight edit first) — this is the primary trigger and needs no help from the
   orchestrator to fire.
2. The orchestrator corroborates via `~/.claude/statusline.json`'s per-subagent `tokens` field (the
   last transcript turn's `input + cache_read + cache_creation` for that running subagent) — **NOT**
   `output_file` byte size: `output_file` is a SYMLINK to the real transcript, so `stat -c%s` on it
   returns only the link-path length (~145 bytes) and never reflects actual context size. Arm a
   persistent `Monitor` `until`-loop over `statusline.json` with `CAP=200000`; at or past CAP for any
   live subagent it emits SHUTDOWN. **SHUTDOWN always applies** — even with usage-pausing disabled —
   because a hard context-limit crash mid-turn loses the tail, which is a real failure, not just a
   budget one. On SHUTDOWN: SendMessage that subagent to checkpoint+stop, wait for `handoff.md`
   current, then spawn a FRESH continuation subagent pointed at `handoff.md` + the attempt ledger +
   the snapshot resume point (do not SendMessage-resume an already-200k+ transcript — it starts
   already under context pressure). The per-step `handoff.md` makes the exact cutoff non-critical.

## State files

- `scenarios/campaign/state/orchestrator-state.json` (gitignored) — the live ledger the orchestrator
  maintains: `{ updatedAt, phase, usage:{last_pct,last_resets_at,paused}, scenarios:{ <id>:{ status,
  subagent:{name,agentId,outputFile}, resumeRunId, resumeStep, lastCommit } }, coordination:{ <id>:
  [owned paths] }, commits:[…] }`. `status ∈ migrating|migrated|queued|running|green|paused|blocked`.
- `scenarios/campaign/state/<id>.handoff.md` (gitignored) — per-scenario resume note, owned by that
  scenario's subagent.
- `scenarios/campaign/attempts/<id>.md` (TRACKED, committed) — cross-attempt fix ledger, per judge.md.

## Loop

0. (done once) usage wrapper + settings; this runbook + state; the `judge.md`/`migrate.md` brain.
1. Spawn 3 migration subagents (08/09/10) + 2 runner subagents (06/07). Start the heartbeat.
2. On each migration signal → review `--plan`, commit+push the `scenario.yaml`, mark `migrated`, and
   if a runner lane is free spawn its runner (→ `running`).
3. On each runner fix signal → review + commit+push (or feedback). On `green` → mark green, spawn the
   next queued scenario if a lane is free.
4. Every heartbeat: usage guard, liveness via the Monitor/`statusline.json` per-subagent `tokens`
   check (CAP=200000), pending reviews. Pause/resume on 95%. Hand off any subagent the Monitor flags
   past the cap.
5. Done when 06–10 are all green. Report; optionally spawn `extend.md` rounds for more coverage.
