# Unfinished Work Tracker

Status: living doc — consolidates everything **not yet implemented** across the
repo's plans and open issues, as of 2026-06-06 on branch
`claude/agentic-framework-paper-ideas-CGzXp`.

Update this file as items land: when an item is done + tested, strike it here and
(for bugs) delete the `.issues/` file per CLAUDE.md.

---

## 1. Mock LLM mechanism — NOT STARTED
Full design in `.claude/plans/mock-llm.md`. Nothing built yet. Unblocks running the
live-testing plan **without API keys** (a scripted `streamFn` that emits TypeScript
instead of calling the AI SDK; sits upstream of the tracer so all trace assertions
keep working).

- [ ] `packages/core/src/testing/mock-provider.ts` — `createMockStreamFn`,
      `mockScript`, `mockMatch`; export from `index.ts`
- [ ] `packages/core/src/testing/mock-provider.test.ts` — multi-turn, fork-routing,
      abort
- [ ] CLI `--mock <file>` flag + `LM_MOCK` env (`args.ts` + `bin.ts`); skips
      `resolveModel` so no credentials are needed; + `args.test.ts` coverage
- [ ] `fixtures/*/mock.mjs` — scripted mocks for the live-testing scenarios
      (solver retry/race, engineer budget/progress)
- [ ] `scripts/live-test.sh` — keyless CI smoke suite (also closes live-testing §9)
- [ ] Docs: CLAUDE.md `--mock`/`LM_MOCK` note + a skills entry

## 2. Live testing execution — NOT RUN
Plan in `.claude/plans/live-testing.md`. The harness (P0.1/P0.2/P0.3) is done and
unit-tested, but the **actual model-driven runs** — the entire point of the plan —
have not been executed. Blocked on live credentials *or* on item 1 (mock) for a
keyless variant.

- [ ] Phase 1 — budget guardrails (1A episode cap, 1B tool-call cap, fork-depth,
      wallclock) against `fixtures/engineer`
- [ ] Phase 2 — `progress()` global
- [ ] Phase 3 — `solve` escalation (3A first-try pass, 3B one-retry → `rung:1`,
      3C escalate-to-race) against `fixtures/solver`
- [ ] Phase 4 — per-role models visible in the `llm_request` trace
- [ ] §6.3 — reward-hacking / integrity regression
- [ ] §7 — fill the results table (or sibling `live-testing-results-<date>.md`);
      keep raw `--trace` NDJSON for any failure
- [ ] File any divergence as a new `.issues/` entry

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

## 4. Doc drift (cheap, no code) — TODO
- [ ] `.claude/plans/verifier-gated-escalation.md` line 3 + §0 still say Phase 3
      "userland exposure DEFERRED". It shipped in commit `eed51ab` as the `solve`
      global — update the status to DONE so the plan reflects reality.

---

## Already done (for context — not unfinished)
- P0.1 budget caps wired into the CLI; P0.2 model recorded on `llm_request`
  (commit `27aa38e`).
- P0.3 `solve` shipped as a host-orchestrated value-yielding global + `fixtures/solver`
  (commit `eed51ab`).
- Verifier-gated-escalation Phases 1, 2, 4 (budgets, `progress()`, per-role models)
  implemented and unit-tested.
- All 211 core unit tests pass; `pnpm typecheck` clean.
