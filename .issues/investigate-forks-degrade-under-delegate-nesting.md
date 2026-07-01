# deep_research `investigate` forks degrade under delegate nesting

`system-research`'s `deep_research` tasklist is **reliable standalone / shallow**
but fails badly when `deep_research` runs **inside a delegate layer** (i.e. the
real product path `THING → researcher(delegate) → deep_research`, and deeper
`THING → architect → researcher → deep_research`).

## Symptoms

- Standalone (`--space system-research --agent researcher --no-default-action`,
  session→forks, 2 levels): all `investigate` forEach forks succeed, **0 errors**,
  full cited report produced. Verified repeatedly.
- Nested (through one or more `delegate()` layers, 3–4 levels): **6–8 of the
  `investigate` forks fail** and salvage empty output. The failures are
  small-model TypeScript mistakes in the fork, not stream/rate errors:
  - `Cannot find name 'question'` / `question2` / `search` / `questionStr`
    (cross-statement variable loss — a var declared in an earlier turn is not in
    scope in a later statement),
  - `cannot read property 'ok' of undefined` (reading `search.results`/a fetch
    result that was never bound).
- With most `investigate` entries empty, `synthesize` has nothing to cluster,
  degrades (its own multi-statement `all_sources` build also throws
  `'sourceMap' is not defined` across turns), and `summarize` resolves a
  placeholder report whose fields are all
  `"(unavailable — the subagent could not produce a synthesis before exhausting its budget)"`
  (`salvageOutput`, `libs/core/src/fork/fork.ts`).

## Why it matters

This placeholder research is what breaks the `THING → architect` build flow: the
architect (or THING) receives "unavailable" research, gets confused, and never
completes the space build. The hard **crash** in this path is already fixed (see
git history / `sandbox/quickjs.ts` `dispose()` teardown guard + `LM_QJS_DEBUG`);
this issue is the remaining *reliability* problem that blocks a clean end-to-end
build.

## Notes / leads

- Shallow vs nested `investigate` forks use the **same model**
  (`azure:DeepSeek-V4-Pro`) and a near-identical system prompt (5487 chars); the
  nested fork's user messages are only ~400 chars larger (parent
  history/charter). So the cause is subtle, not an obvious config difference.
- Reproduce: `LMTHING_ROOT=<scratch> node libs/cli/dist/cli/bin.js --agent thing
  --space <empty> --request "Build me an agent that advises on <topic>" --trace t.json`,
  then compare `investigate` fork `eval_error`/`typecheck_error` counts against a
  standalone `--agent researcher --no-default-action` "deep research …" run.

## Fix options (open)

- Harden the `investigate` (and `synthesize`) task instructions against
  cross-statement variable loss — e.g. compute everything needed for
  `currentTask.resolve(...)` in the SAME statement, or make the multi-statement
  contract explicit/robust for the small model at depth.
- Investigate whether the extra parent context injected into forks under a
  delegate layer is what tips the small model over; trim what leaf forks inherit.
- Consider a stronger model (or more retries/nudges) for the `investigate`/
  `synthesize` forks specifically when running at depth.
