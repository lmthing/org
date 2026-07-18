---
input:
  request: string
  sourceSummary: string
  attachmentIds: array
  specialistFacts: string
---

Organize supplied material into a live-project app. First NAME every independently owned SUBJECT in
the material (an enumeration pass, so a distinct part with few facts never quietly gets folded into a
bigger one); build one grounded scope per named subject, each its own independent pass; consolidate
those scopes into a minimal, non-overlapping set of specialists (so the build isn't wasted on genuine
duplicate spaces); then build one grounded specialist per consolidated scope in parallel; finally hand
the complete source to the automator. The goal output reports the specialist builds and app build.