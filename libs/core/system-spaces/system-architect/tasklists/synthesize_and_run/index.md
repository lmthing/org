---
input:
  topic: string
  goal: string
  research: string
  attachmentIds: array?
---

Build a brand-new specialist agent (a "space") for the user's request, ONE FILE AT A TIME,
then validate and register it so it can be run. The seed gives `topic` (the user's request,
verbatim), `goal` (what the new agent should do), `research` — a JSON string of a cited
deep-research report ({ topic, executive_summary, findings:[{heading,detail}], conclusion,
sources:[{title,url}] }) used to write VALIDATED, SOURCED knowledge — and, when the material
came from supplied files rather than the open web, `attachmentIds` naming the ORIGINAL documents
so a knowledge-writing step can re-read the real text itself instead of trusting a lossy summary
alone for a specific fact (a code, a serial number, a date). The host runs the steps below in
order and fans the per-field / per-function steps out for you — each writes one piece.
