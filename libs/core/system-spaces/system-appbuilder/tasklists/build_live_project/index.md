---
input:
  query: string
  attachmentIds: array
---

Build a complete live-project app from supplied material. The workflow reads the attachments, writes
source-derived tables and rows, then writes an API and page that make those rows openable. Each node
has one bounded responsibility, so the build does not depend on a model continuing a long freeform
program after earlier writes.