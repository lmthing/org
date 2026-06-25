# Issue: research fork loses variable scope across statements (typecheck "Cannot find name")

**Status:** open
**Severity:** medium (graceful — the `synthesize_and_run` DAG marks the optional `research` task `⊘` and continues; the synthesized space just ships without pre-researched web knowledge)
**Found in:** live architect run A6 (2026-06-14). `fork:research` failed ×3 and was skipped.

## Symptom

During the `synthesize_and_run` → `research` task (a fork), the model's statements fail
typecheck with errors like:

```
const top1 = top.results.slice(0, 2);
  typecheck error: Cannot find name 'top'.
```

i.e. a variable bound in an earlier statement is not visible to a later statement's
typecheck pass, so the fork burns all 3 retries and resolves with the salvage/empty
`{ knowledge: [], sources: 'none' }` (which then also mismatches the task's required
output schema `{ knowledge: object, sources: string }`, compounding the failure).

Note: the **other** half of the original A6 research failure — `display(<p>…)` throwing
`React is not defined` inside the fork VM — is ALREADY FIXED (fork.ts now injects the
React shim + CATALOG_NAMES, see `fork/fork.test.ts` "injects the JSX runtime"). This
issue is only the remaining variable-scope-loss fragility.

## Root-cause hypotheses (verify each in a fresh session)

The runtime is a sync-eval model: each statement is an isolated ES module; variables
propagate to the next statement two ways —
1. **VM side:** `eval/turn-loop.ts` appends `try { globalThis['x'] = x; } catch {}` after a
   statement so the next module can read `x` as a global.
2. **Typecheck side:** `accumulatedContext` (`eval/turn-loop.ts:133`, grown by
   `appendContext` at ~:134, fed to `runTsc({ sessionContext })`) re-declares prior
   statements so tsc knows the names.

A statement is appended to `accumulatedContext` ONLY after it evaluates cleanly
(`appendContext(stmt)` runs after the eval-ok / yield branches). So:

- **H1 — binding statement errored, then its name is referenced.** If statement N binds
  `top` but statement N itself errors (e.g. a tool returned an unexpected shape, or N
  also had the JSX error pre-fix), N is never appended to `accumulatedContext`; the model
  on retry writes statement N+1 referencing `top` → "Cannot find name 'top'". The
  error block (`eval/error-rewind.ts buildErrorBlock`) lists in-scope names from
  `scopeContext`, but `top` isn't there because N never committed. **Most likely cause.**
- **H2 — model split a declaration from its first use across two statements** (the
  documented FIREWALL_TAIL / SCOPE rule in `fork/roles.ts` warns against this). If the
  model writes `const top = …;` and `const top1 = top.slice…;` as SEPARATE statements and
  the first yielded (webSearch is a yield), the post-yield binding may not have landed in
  `accumulatedContext` before the next statement typechecks.
- **H3 — `extractBindingNames` misses the binding form the model used** (e.g. destructuring,
  multi-var `const a=…, b=…`), so the `globalThis['x']=x` propagation is incomplete. See
  the known multi-var bug already fixed (`feedback-multivar-const` memory) — confirm the
  research model isn't hitting a *different* uncovered form.

## Exact plan (new session)

1. **Reproduce deterministically (keyless).** Add a focused fork test in
   `packages/core/src/fork/fork.test.ts` that scripts a 2-statement fork where stmt 1
   binds a var via a (mock) yielding call and stmt 2 references it — assert it does NOT
   error with "Cannot find name". Use `createMockStreamFn` to emit the two statements.
   This pins the behavior without a live model. Start here — make it fail first.
2. **Instrument** `eval/turn-loop.ts` around `appendContext` and the yield-binding block
   (~:316-382): log when a bound name is added to `accumulatedContext` vs. when it's only
   `vm.setVar`'d. Confirm which hypothesis holds by replaying `/tmp/arch-traces/expA6.jsonl`
   (the `fork:research` node) via `buildTraceTree` or `--web ?trace=`.
3. **Fix per hypothesis:**
   - If H1: after a yield RESOLVES, append the yielding statement to `accumulatedContext`
     (it already does at ~:382 `appendContext(yieldingStatement)`) — verify the bound
     names from the yield are ALSO declared in the typecheck context (they're `vm.setVar`'d
     but is a `declare`/`const` line added to `accumulatedContext` so tsc sees them?). If
     not, synthesize `declare const <name>: any;` lines for yield-bound names and append
     them. This is the likely real fix.
   - If H2: strengthen the research task instruction (`system-spaces/system-architect/tasklists/synthesize_and_run/02-research.md`)
     AND make the harness resilient regardless (don't rely on prompt).
   - If H3: extend `extractBindingNames` / `extractBindingPattern` to cover the missed form;
     add a regression test.
4. **Make the research task's salvage schema-valid.** Even when research yields nothing,
   it must resolve `{ knowledge: [], sources: 'none' }` matching `{ knowledge: object,
   sources: string }`. `[]` is an object (typeof === 'object') so it likely passes
   `validateOutput`; CONFIRM in `tasklist/schema.ts` that an empty array satisfies an
   `object` field — if not, change the task output type to `array` or fix the validator.
   (The salvage path `salvageOutput` in `fork/fork.ts` already produces `[]` for array
   types — ensure the research task's declared output types match what salvage produces.)
5. **Verify live** (subagent, clean shell): re-run A6
   (`cd /home/vasilis/LMTHING/org && node packages/cli/dist/cli/bin.js --space ./fixtures/architect --agent architect --web <port> --trace … --claude`,
   then POST a "create a specialist about X" message; poll `/api/state`). Confirm the
   `fork:research` node is now ✓ with non-empty `knowledge`, and the synthesized space's
   `knowledge/` dir contains web-sourced content. (Requires `TAVILY_API_KEY`; the key is
   live as of 2026-06-14. Launch from repo root or `.env`/`LM_MODEL_M` won't load.)

## Acceptance

- New keyless fork test reproduces then proves the scope fix.
- `fork:research` resolves ✓ with real `knowledge` in a live architect run.
- `pnpm test` green, `pnpm typecheck` clean.
- Delete this file when fixed (per the issue-lifecycle rule in CLAUDE.md).

## Key files
- `packages/core/src/eval/turn-loop.ts` — accumulatedContext / appendContext / yield-binding
- `packages/core/src/eval/error-rewind.ts` — buildErrorBlock in-scope-names hint
- `packages/core/src/fork/fork.ts` — fork VM setup + salvageOutput
- `packages/core/src/fork/roles.ts` — FIREWALL_TAIL SCOPE rule
- `packages/core/system-spaces/system-architect/tasklists/synthesize_and_run/02-research.md`
- `packages/core/src/tasklist/schema.ts` — validateOutput
