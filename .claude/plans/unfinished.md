# Unfinished Work Tracker

Status: living doc — consolidates everything **not yet implemented** across the
repo's plans and open issues, as of 2026-06-06 on branch
`claude/agentic-framework-paper-ideas-CGzXp`.

Update this file as items land: when an item is done + tested, strike it here and
(for bugs) delete the `.issues/` file per CLAUDE.md.

---

## 1. Mock LLM mechanism — ✅ DONE
Full design in `.claude/plans/mock-llm.md`. Shipped: a scripted `streamFn` that emits
TypeScript instead of calling the AI SDK; sits upstream of the tracer so all trace
assertions keep working. Proven keyless end-to-end (see item 2).

- [x] `packages/core/src/testing/mock-provider.ts` — `createMockStreamFn`,
      `mockScript`, `mockMatch`; exported from `index.ts`
- [x] `packages/core/src/testing/mock-provider.test.ts` — 10 tests: builders +
      multi-turn `Session` (continue() + sleep yield) + fork-routing + abort
- [x] CLI `--mock <file>` flag + `LM_MOCK` env (`args.ts` + `bin.ts`); skips
      `resolveModel` so no credentials are needed; + `args.test.ts` coverage
- [x] `fixtures/solver/mock.mjs` (3B retry → rung 1), `fixtures/solver/mock-pass.mjs`
      (3A first-try → rung 0), `fixtures/engineer/mock.mjs` (Phase 1 budget + Phase 2
      progress)
- [x] `scripts/live-test.sh` — keyless CI smoke suite (closes live-testing §9); 14/14
      assertions green
- [x] Docs: CLAUDE.md `--mock`/`LM_MOCK` note + skills entry in `writing-tests.md`

## 2. Live testing execution — KEYLESS VARIANT GREEN; credentialed runs still pending
Plan in `.claude/plans/live-testing.md`. The harness (P0.1/P0.2/P0.3) is done and
unit-tested. The mock (item 1) now makes the core scenarios runnable **without keys** —
`scripts/live-test.sh` exercises and asserts them. What remains is the credentialed,
real-model runs (which catch model-behavior issues the mock cannot) and a few scenarios
not yet scripted.

- [x] Phase 1 — 1A episode cap & 1B tool-call cap fire with a clean non-zero exit
      (`fixtures/engineer/mock.mjs`, asserted in `scripts/live-test.sh`)
- [ ] Phase 1 — 1C fork-depth, 1D wall-clock, 1E within-budget no-op, 1F/1G robustness
- [x] Phase 2 — `progress()` reads live counters (2A)
- [ ] Phase 2 — 2B counts climb / 2C read-only / 2D inside-fork
- [x] Phase 3 — 3A first-try pass (`mock-pass.mjs`) & 3B one-retry → `rung:1` with
      feedback carried (`mock.mjs`)
- [ ] Phase 3 — 3C escalate-to-race, 3D no-verify single shot, 3E exhaustion, 3F budget
      interaction (note: with `--max-fork-depth 0`, a fork-depth `BudgetExceededError`
      inside `solve` is currently **swallowed** — the yield resolves `undefined` instead
      of aborting the session. Worth a `.issues/` entry + fix.)
- [ ] Phase 4 — per-role models visible in the `llm_request` trace (P0.2 records the
      model; needs a mock/credentialed run that sets `LM_MODEL_ROLE_*` and asserts)
- [ ] §6.3 — reward-hacking / integrity regression
- [ ] §7 — fill the results table (or sibling `live-testing-results-<date>.md`);
      keep raw `--trace` NDJSON for any failure
- [ ] The above against a **real model** with credentials (the mock covers wiring +
      deterministic logic, not model behavior)

## 3. Open bugs (`.issues/`) — 7 UNFIXED
Each needs a fix **and** a regression test, then delete the issue file + its entry
in CLAUDE.md "Known issues".

- [ ] `execshell-30s-timeout` — 30s `execShell` timeout kills first-run
      `npm install` / `npx`; needs a longer/configurable timeout
- [ ] `execshell-missing-exitcode` — `execShell` returns no `exitCode`; models
      expect it to distinguish non-zero codes (also a typecheck error on access)
- [ ] `fork-regex-line-numbers` — `readFile().content` carries `N\t` line-number
      prefixes that break line-start regexes in fork analysis
- [ ] `grep-no-error-on-bad-path` — `grep` on a nonexistent path returns
      `{ ok: true, matches: [] }`; can't distinguish "missing path" from "no match"
- [ ] `process-exit-retry-loop` — model uses `process.exit(1)` as control flow;
      the thrown error is retried, causing an infinite retry loop
- [ ] `variable-scoping-let-across-statements` — `let` declared without assignment
      isn't propagated to `globalThis`, so later eval statements can't see it
- [ ] `webfetch-raw-html` — `webFetch` returns raw HTML; needs text extraction for
      article/doc/summary use cases

## 4. Doc drift (cheap, no code) — ✅ DONE
- [x] `.claude/plans/verifier-gated-escalation.md` line 3 + §0 updated: Phase 3 marked
      DONE (shipped in commit `eed51ab` as the host-orchestrated `solve` global).

---

## Already done (for context — not unfinished)
- P0.1 budget caps wired into the CLI; P0.2 model recorded on `llm_request`
  (commit `27aa38e`).
- P0.3 `solve` shipped as a host-orchestrated value-yielding global + `fixtures/solver`
  (commit `eed51ab`).
- Verifier-gated-escalation Phases 1, 2, 4 (budgets, `progress()`, per-role models)
  implemented and unit-tested.
- All 211 core unit tests pass; `pnpm typecheck` clean.
