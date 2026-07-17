---
input:
  request: string
  sourceSummary: string
  attachmentIds: array
  specialistFacts: string
---

Organize supplied material into a live-project app. First identify every independently owned scope
in the material; consolidate those scopes into a minimal, non-overlapping set of specialists (so the
build isn't wasted on duplicate spaces); then build one grounded specialist per consolidated scope in
parallel; finally hand the complete source to the automator. The goal output reports the specialist
builds and app build.