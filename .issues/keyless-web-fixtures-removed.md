# keyless-cli & web-api integration tests reference deleted `fixtures/`

**Status:** quarantined (skipped), 2026-07-03.

## Symptom
`pnpm test` (after `pnpm build`) fails 4 tests:
- `libs/cli/src/testing/keyless-cli.test.ts` (3 cases: 1A episode cap, 1B tool-call cap,
  2A `progress()`) — `Error: Cannot find module '<repo>/fixtures/engineer/mock.mjs'`.
- `libs/cli/src/testing/web-api.test.ts` (1 case) — `web server did not come up in time`
  (the spawned CLI errors on missing `fixtures/cooking/` + `mock-ask.mjs` and never binds the port).

## Root cause
Commit `acb460a` ("refactor: remove deprecated agent and component test fixtures from the SDK
directory") deleted the entire `fixtures/` tree (`fixtures/engineer/`, `fixtures/cooking/`, …),
but these two integration suites still spawn the built CLI against those fixtures. They only
self-skip on `!hasBin()` (dist absent), not on missing fixtures, so a full `pnpm test` after a
build goes red. This predates the project-as-application work.

## Fix (to re-enable)
Restore minimal fixtures the suites need, then revert the `describe.skip` → `describe.skipIf(!hasBin())`:
- `fixtures/engineer/` — a space dir + `mock.mjs` scripted provider that loops (for the budget-cap
  cases) and can call `progress()` (for 2A). See the mock-provider format (`--mock`) in
  `libs/cli/src/testing/live-harness.*` and the scripted-provider precedent (commit `18c1c70`).
- `fixtures/cooking/` — a `chef` agent with a `ConfirmDish` space component + `mock-ask.mjs` that
  triggers an `ask()` (for the web-mode ask/resume flow).

Both suites are otherwise valid coverage (budget caps, `progress()`, web ask/resume + WS trace),
so the intent is to restore the fixtures, not delete the tests.

## Separate known flake (not fixture-related)
`libs/cli/src/server/serve-tree-ws.test.ts` intermittently fails the full parallel `pnpm test`
with `ENOTEMPTY: directory not empty, rmdir '.../user/sessions/<id>'` — a race between an
in-flight session snapshot write and the recursive temp-dir teardown under parallel load. It
**passes reliably in isolation** (`pnpm exec vitest run libs/cli/src/server/serve-tree-ws.test.ts`).
Not caused by the project-as-application work. Robust fix: ensure the WS server + all session
writers are fully drained/stopped before the `afterAll` `rm`. Until then, treat a lone
`serve-tree-ws` ENOTEMPTY as a known flake and re-run.
