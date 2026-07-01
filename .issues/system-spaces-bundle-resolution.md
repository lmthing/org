# system-spaces resolution depends on Docker co-location

`defaultSystemSpaceDirs()` (`libs/core/src/spaces/system.ts`) resolves the
shipped system spaces relative to the running module's `__dirname`. Because the
cli **bundles `@lmthing/core`** into `libs/cli/dist/cli/bin.js`, at runtime
`__dirname` is the cli's `dist/cli/` dir, so the probed paths become
`…/cli/dist/system-spaces` and `…/cli/system-spaces` — neither of which exists
in a plain build. The real assets live under `libs/core/system-spaces`.

The compute Docker image works around this by copying `system-spaces` to
`libs/cli/dist/system-spaces` (see `devops/argocd/compute/Dockerfile`), so
`materializeRuntime` finds them. But a developer running the built cli **outside
Docker** — e.g. `pnpm build && node libs/cli/dist/cli/bin.js serve` — still
gets an empty `<root>/system/` and every session fails with
`Agent "thing" not found`. (Running from source via tsx works, since the
src-layout candidate resolves.)

`materializeRuntime` now warns loudly (and `runtimeNeedsInit` repairs an empty
`system/`), so the failure is at least diagnosable rather than silent.

## Fix options (open)

- Make `defaultSystemSpaceDirs()` resolve `@lmthing/core`'s package root
  robustly even when bundled (e.g. `require.resolve('@lmthing/core/package.json')`
  with a fallback), instead of relying on `__dirname` proximity.
- Or stop bundling core into the cli (mark it `external` in `cli/tsup.config.ts`)
  so `__dirname` stays inside `core/dist`.
- Or have the cli build step copy `system-spaces` into `cli/dist/` so the
  dist-layout candidate always resolves (parity with the Docker workaround).

## Status

Fix landed (Phase 0): `libs/cli/scripts/copy-system-spaces.mjs` now copies
`libs/core/system-spaces/` → `libs/cli/dist/system-spaces` as part of the cli
`build` script (`tsup && node scripts/copy-system-spaces.mjs`), giving the
built cli parity with the Docker image's manual copy step without requiring
Docker. Pending live verification — do not delete this file until confirmed.
