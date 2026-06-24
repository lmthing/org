# Opt-in update of PVC system spaces when the image ships changes

## Intended design

System spaces are materialized into `<root>/system/` on the user's persistent
volume (PVC) on first boot. This is deliberate: each user owns their copy, and a
**new image must not silently overwrite it**. The current behavior already
honors this — `runtimeNeedsInit()` (`packages/cli/src/cli/runtime-init.ts`) only
materializes when the `thing` system space is *absent*, so an existing PVC copy
survives image upgrades untouched.

## Gap

There is no way to *deliberately* pull in updated system spaces. If a new image
changes a system agent (e.g. `thing`), users who already have a populated
`system/` keep the old version forever, with no signal that an update exists and
no path to adopt it.

## Desired behavior

- On startup, compare the image's shipped system spaces (the bundled
  `defaultSystemSpaceDirs()` source) against the PVC's `<root>/system/` —
  e.g. a content hash / version manifest per space.
- If they differ, surface it to the user (a banner / settings affordance in the
  agent-ui shell) — **do not auto-apply**.
- On explicit confirm, re-materialize (overwrite) the affected system spaces in
  the PVC; otherwise leave the user's copy as-is.
- Consider per-space granularity (update `thing` but keep a locally-customized
  `engineer`, etc.).

## Notes

- `materializeRuntime()` already overwrites via `cpSync` when called, so the
  apply step exists; what's missing is (a) change detection and (b) the
  user-facing prompt + an endpoint to trigger it.
- Keep the first-boot auto-materialize (empty `system/`) as-is — that's
  initialization, not an update.
