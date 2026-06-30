---
input:
  topic: string
  goal: string
  research: string
---

Build a brand-new specialist agent (a "space") for the user's request, ONE FILE AT A TIME,
then validate and register it so it can be run. The seed gives `topic` (the user's request,
verbatim), `goal` (what the new agent should do), and `research` — a JSON string of a cited
deep-research report ({ topic, executive_summary, findings:[{heading,detail}], conclusion,
sources:[{title,url}] }) used to write VALIDATED, SOURCED knowledge. The host runs the steps
below in order and fans the per-field / per-function steps out for you — each writes one piece.
