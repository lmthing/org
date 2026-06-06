# Unfinished Work Tracker

Status: living doc — consolidates everything **not yet implemented** across the
repo's plans and open issues. Last updated 2026-06-06 on branch
`claude/unfinished-livetest-mock-plans-r4hu4`.

Update this file as items land: when an item is done + tested, strike it here and
(for bugs) delete the `.issues/` file per CLAUDE.md.

**Remaining work:** only the credentialed/real-model live-testing runs and the
not-yet-scripted live-testing scenarios (item 2). The mock mechanism (1), all 7 bugs
(3), and the doc drift (4) are done.

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

Most scenarios are now asserted in two places: `scripts/live-test.sh` (CLI level) and
`testing/mock-session.test.ts` (in-process Session, in unit-test CI).

- [x] Phase 1 — 1A episode cap, 1B tool-call cap, 1C fork-depth, wall-clock cap all
      fire with a clean non-zero exit; 1E within-budget no-op; budget resets per
      `continue()` turn
- [ ] Phase 1 — 1F REPL-specific reset / 1G no-VM-leak edge cases
- [x] Phase 2 — `progress()` reads live counters (2A), counts climb across a yield (2B),
      read-only snapshot (2C)
- [ ] Phase 2 — 2D inside-fork progress
- [x] Phase 3 — 3A first-try pass, 3B one-retry → `rung:1` with feedback carried,
      3D no-verify single shot, 3E bounded exhaustion, 3F budget bounds the ladder
      (the previously-swallowed fork-depth `BudgetExceededError` now propagates — fixed
      in `turn-loop.ts`)
- [ ] Phase 3 — 3C escalate-to-race (needs a mock that keeps failing into the race rung)
- [x] Phase 4 — per-role fork model recorded on the `llm_request` trace; no config →
      no override
- [ ] §6.3 — reward-hacking / integrity regression
- [ ] §7 — fill the results table (or sibling `live-testing-results-<date>.md`);
      keep raw `--trace` NDJSON for any failure
- [ ] The above against a **real model** with credentials (the mock covers wiring +
      deterministic logic, not model behavior)

## 3. Open bugs (`.issues/`) — ✅ ALL 7 FIXED + TESTED
Each got a fix **and** a regression test; the `.issues/` files are deleted and the
directory is now empty.

- [x] `execshell-30s-timeout` — default `execShell` timeout raised to 120s + a
      per-call `{ timeout }` override (`host-tools.ts`; test in `host-tools.test.ts`)
- [x] `execshell-missing-exitcode` — `execShell` now returns `exitCode`
      (0/126/127/…); `library-dts.ts` updated so `.exitCode` type-checks
- [x] `fork-regex-line-numbers` — fork preamble now tells subagents to use
      `readFile().raw` for regex/parsing (`fork/roles.ts`)
- [x] `grep-no-error-on-bad-path` — `grep` probes path existence and returns
      `{ ok:false, error:"path not found: …" }` (test contrasts it with no-match)
- [x] `process-exit-retry-loop` — the turn loop detects a `process.exit()` error and
      stops cleanly instead of retrying (`turn-loop.ts`; test in `turn-loop-yield.test.ts`)
- [x] `variable-scoping-let-across-statements` — `extractBindingNames` now handles
      no-initializer declarations (`let parsed;`) so they propagate to `globalThis`
- [x] `webfetch-raw-html` — `webFetch` extracts readable text by default
      (`format:'html'` opts out); test covers tag/script/style stripping + entities

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
- Mock LLM provider + `--mock` CLI flag + keyless `scripts/live-test.sh` (this branch).
- All 7 `.issues/` bugs fixed + regression-tested; `.issues/` is now empty.
- 234 unit tests pass; the keyless live-test suite is 14/14 green.
