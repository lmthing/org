---
name: writing-tests
description: Load when writing or running core tests (vitest patterns, mock providers, fixtures, the testing harness).
---

# Skill: Writing Tests

Load this when you are adding, running or debugging tests for `sdk/org` — the runtime suite
(`libs/*/src/**/*.test.ts`), the keyless mock-LLM harness, the subprocess CLI suites, or the live
prod scenario runner under `sdk/org/scenarios/`.

## Read first — the grounded truth lives in org/docs

- **`org/docs/contributing/testing.md`** — the whole picture: the two overlapping pnpm workspaces and
  which commands silently do nothing, the vitest configs (what is included, what is excluded and
  therefore orphaned), the mock-provider builders (`createMockStreamFn` / `mockScript` / `mockMatch`)
  and their contracts, what lives in `libs/core/src/testing/` and `libs/cli/src/testing/` (incl.
  which suites are quarantined and why), the `scenarios/` live-prod harness API, and the rules that
  bite when writing a test.
- `org/docs/contributing/debugging.md` — tracing the eval/yield pipeline (`--trace`, the NDJSON
  events you assert on).
- `org/docs/runtime/turn-loop.md` — the yield protocol a mock test scripts against; why yield-result
  binding is the turn loop's job, not the VM's.
- `org/docs/cli-api/commands.md` — every CLI flag, incl. `--mock`, `--trace`, `--web`, `--request`.
- `org/docs/contributing/README.md` — the contributing index and the hard CI gates.

## Procedure — commands that actually work

```bash
cd sdk/org                                      # NOT the repo root: root has no `test` script
pnpm test                                       # whole runtime suite (vitest run)
pnpm test libs/core/src/tasklist                # one directory (positional arg = path substring)
pnpm test libs/core/src/tasklist/condition-dsl  # one file

# subprocess CLI suites need the built binary first
pnpm build

# real-model suite (Azure keys from sdk/org/.env)
pnpm build && LM_LIVE=1 pnpm exec vitest run libs/cli/src/testing/live-llm.test.ts

# live scenarios — a scenario.yaml played against a LOCAL `lmthing serve` (rebuild + restart, seconds)
node sdk/org/scenarios/harness/local-server.mjs up            # throwaway server on :8080
node sdk/org/scenarios/run-yaml.mjs 06-tanzania --fresh-server # play it, write evidence to <sc>/.run/
```

**Never use `pnpm --filter <pkg> test`.** `@lmthing/core`, `cli`, `auth`, `utils` and `ui` declare no
`test` script, so a filtered run exits 0 having run nothing. Use the path filter above.

## Order of operations when adding a test

1. Co-locate it: `libs/<pkg>/src/<area>/<thing>.test.ts`. No setup file — import
   `describe/it/expect/vi` from `vitest` directly.
2. Reach the model only through a scripted `streamFn` — prefer the shipped builders in
   `libs/core/src/testing/mock-provider.ts` over hand-rolling one.
3. Assert on the **trace** (`yield` / `yield_resolved` / `llm_request`) and on host effects, not on
   model prose.
4. Run the suite before you push — **no CI workflow runs the tests**; the only hard automated gate is
   the design-token lint.
5. **Always test every fix.** No fix is done until a test would have caught it.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
