---
id: synthesize
output:
  topic: string
  executive_summary: string
  findings: array
  conclusion: string
  sources: array
dependsOn:
  - investigate_a
  - investigate_b
  - investigate_c
  - plan
optional: false
goal: true
---

Synthesize `plan.topic` and the three investigations — `investigate_a`, `investigate_b`,
`investigate_c` (each `{ question, findings, sources }`) — into one coherent report. Read
ACROSS them (don't just concatenate) and produce:

- `executive_summary`: 2-4 sentences answering the overall `plan.topic` at a high level.
- `findings`: an array of `{ heading, detail }` (3-6 entries). Organize by THEME, merging
  related points from different investigations. `detail` is a substantive paragraph grounded in
  what the investigations actually reported — concrete facts, figures, and named sources.
- `conclusion`: one paragraph — the bottom line, plus any notable gaps, disagreements, or
  uncertainty in the evidence.
- `sources`: a DEDUPED array of `{ title, url }` collected from all three investigations'
  `sources` (drop duplicate URLs and any empty entries).

If every investigation came back with empty `sources` (search was unavailable), say so plainly
in `executive_summary` and `conclusion`, and resolve with `findings: []` and `sources: []`.

Emit one PLAIN TypeScript statement (do NOT wrap it in markdown code fences):

currentTask.resolve({ topic: plan.topic, executive_summary, findings, conclusion, sources });
