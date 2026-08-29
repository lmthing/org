---
input:
  missing: array?
  errors: array?
  note: string?
---

Repair a LIVE project that already has real tables and pages — fix broken artifacts and author the
ones a page or the shell references but that were never written — WITHOUT re-running
`build_live_project` (no `read_sources`, no re-planning, no touching what already works). This is the
`build_live_project` caller's ONLY correct move once an app exists and something in it is wrong; see
`system-appbuilder/agents/automator/instruct.md`.

Pass `missing`/`errors` straight from a `build_live_project` (or a prior `repair_live_project`)
envelope when you have one — `diagnose` merges them with its own fresh scan rather than trusting them
blindly, because the live project may have changed since that envelope was produced. Omit both for an
arbitrary later repair ("the payment toggle is broken") — `diagnose` computes everything fresh from the
app's own build/view/render checks, exactly as `build_live_project`'s `verify` gate does.
