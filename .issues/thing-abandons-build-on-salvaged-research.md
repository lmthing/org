# THING/architect abandon the build when research comes back salvaged

When the deep-research step returns a salvaged placeholder (see
[investigate-forks-degrade-under-delegate-nesting.md](./investigate-forks-degrade-under-delegate-nesting.md)) —
fields like `"(unavailable — the subagent could not produce a synthesis before
exhausting its budget)"` — the orchestrating agent gets confused by the alarming
text and goes off-script instead of proceeding.

## Symptoms

Observed in `THING → researcher(deep_research) → architect` runs (`user-thing`
path 3):

- THING receives the "(unavailable …)" report, comments "the deep research
  subagent hit its budget," then improvises — runs a *quick* `research` pass,
  `inspect()`s the results, and finishes **without ever delegating to the
  architect**. No space is built.
- Earlier variant (architect doing its own research): the architect got the
  placeholder, fumbled the `tasklist('synthesize_and_run', …)` call (emitted only
  comment lines, then skipped ahead to the "run the built agent" turn referencing
  an undefined `t`), and produced nothing.

## Why it matters

The build pipeline is designed to degrade gracefully — `build_field` falls back
when `research` is empty — so a partial/failed research pass should NOT abort the
whole build. But the placeholder's wording actively derails the orchestrator, so
the graceful fallback never gets a chance to run.

## Fix options (open)

- Make the orchestration prompts (`user-thing` path 3, `system-architect` JOB 1)
  explicit: even if research is thin/unavailable, ALWAYS proceed to the architect
  / `synthesize_and_run` with whatever research you have — never stop or
  substitute a different path.
- Soften `salvageOutput`'s placeholder text (`libs/core/src/fork/fork.ts`) so it
  reads as "partial/low-confidence" rather than a hard failure the model feels it
  must route around.
- Have the architect explicitly tolerate an empty/placeholder `context.research`
  (it already does structurally) and note the gap in the built agent's knowledge
  rather than failing.
