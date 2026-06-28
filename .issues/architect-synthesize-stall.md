# Architect `synthesize_and_run` stalls mid-pipeline (model-stream hang)

Observed 2026-06-28 on the production free-tier compute pod while driving the
THING agent from lmthing.chat: "Build a new space … create and register it".

THING correctly routed to `system-architect` and ran `tasklist('synthesize_and_run', …)`.
The pipeline got through *understand* + *research/knowledge* (forks resolved
`{ knowledge, sources }` with real generated content, several retryable
typecheck errors handled normally), then a new turn began
(`[turn 1] streaming…`) and produced **zero further log output for 90s+** —
i.e. a hung model stream. The chat UI stayed on `⟳ 6 running`; no space was ever
scaffolded (`GET /api/projects/recipes-lab/spaces` stayed `[]` for ~13 min).

Not budget (spend was `$0.0098` of the `$1` free cap) and not my space/studio
changes (this is the runtime turn-loop/fork talking to the Azure model). The
stream simply stops mid-turn and the orchestrator waits on the fork forever.

## To investigate / fix (open)
- Add a per-turn / per-stream **watchdog timeout** in the turn loop so a stalled
  upstream stream is treated as a transient error and retried (the loop already
  retries "terminated" connections — a silent no-token stall is not detected).
- Confirm whether the Azure provider surfaces idle-stream timeouts; if not, wrap
  the stream read with an inactivity timeout.
- Repro headlessly: `lmthing --request "build a space that recommends a cocktail
  by mood"` against the prod Azure model and watch for the no-token stall.
- The architect pipeline is also just slow on the free model (~10 min+ with no
  scaffold); consider surfacing progress (which task is running) to the UI.
