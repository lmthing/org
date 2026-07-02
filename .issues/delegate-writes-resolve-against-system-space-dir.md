# Delegate file writes resolve against the agent's SYSTEM space dir

**Found:** 2026-07-02, during the DeepSeek live-test ladder (E4, engineer path).

## Symptom

The engineer delegate's `writeFile("iso8601-duration.ts", …)` calls landed in the
**repo source tree** at `libs/core/system-spaces/system-engineer/` (4 stray files,
since removed). In a workspace (non-Docker) run, `defaultSystemSpaceDirs()` resolves
to the *source* system-spaces, and a delegate VM's host tools resolve relative paths
against `spaceDir` = the delegated agent's own space dir — so any writing delegate
(engineer especially) mutates the installed/system space instead of the user's
project.

## Expected

Relative writes from a delegate should land in the **project** directory (the same
place the session's own writes go — `projectSpacesDir`'s parent / the session
`spaceDir`), or at minimum in a scratch dir scoped to the delegate run. System
space dirs should be read-only to child VMs.

## Repro

`lmthing init` in a scratch dir, then
`node libs/cli/dist/cli/bin.js --request "Write a TypeScript function that parses ISO-8601 durations into milliseconds, with tests."`
— THING delegates to `system-engineer`; the engineer's `writeFile` output appears
under the system-spaces source tree (trace: E4 runs, 2026-07-02 session scratchpad).

## Notes

- Pre-existing behavior, NOT introduced by the reliability redesign (delegate
  `spaceDir` wiring predates it); surfaced now because live E4 was the first time
  the engineer wrote files in a workspace run.
- Fix sketch: pass the *session's* project dir (or a per-delegate scratch dir) as
  the write-resolution root in `delegate.ts`'s `injectHostTools` wiring
  (`exec/bootstrap.ts` `spaceDir` opt), keeping the agent's space dir only for
  knowledge/function loading. Add a test asserting a delegate `writeFile` never
  lands inside a system space dir.
