---
input:
  request: string
  registeredSpaces: string
  attachmentIds: array
  specialistFacts: string
---

Grow an EXISTING project with a genuinely NEW area the user wants to keep and track — the
incremental sibling of `organize_material` (which partitions a whole supplied dump at once). `request`
is the user's message verbatim; `registeredSpaces` is a short list of the specialist spaces this
project already has (so a new area is not confused with one already covered); `attachmentIds` and
`specialistFacts` carry any supplied files and the vision/audio-only facts that only a specialist
could read.

Step one ASSESSES the addition: it names the new area's topic, decides whether it is a genuinely NEW
kind of thing the project had no specialist for (versus another row in an area already covered), and
frames the app request. Step two — a fixed step that runs whenever step one judged the area new, so
the specialist decision can never be silently skipped — creates ONE grounded specialist space for the
area via the architect (idempotent: an existing same-topic space is reused, not duplicated). Step
three builds the app part (table + page + any reminder) into the live project via the automator. The
goal output reports what was added.
