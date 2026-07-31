---
variable: appBuildingAutomation
description: The detail behind "when X happens, do Y" — event hooks (the one-hook direct-insert shape, the handler ctx, and when the rule genuinely needs a MODEL rather than a filter), and scheduled work (a cron emitter def with a cursor for polling, versus a cron hook for a scheduled agent run).
---

# Automation — hooks, emitter defs, and schedules

Two aspects, and which one you need is decided by WHERE the trigger comes from:

- something HAPPENS and you react to it — an inbound integration event, a write to one of this
  project's own tables → `event-hooks`;
- the CLOCK is the trigger — poll a source every 30 minutes, run an agent nightly → `scheduling`.

Load the one that matches before you write the hook or the def. Both carry shapes that fail
silently when they are guessed: a hook on an event nothing emits loads fine and never fires, and a
cron that re-implements its own cadence in the handler skips every catch-up run.
