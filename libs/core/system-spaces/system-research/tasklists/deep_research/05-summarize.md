---
id: summarize
output:
  topic: string
  executive_summary: string
  findings: array
  conclusion: string
  sources: array
dependsOn:
  - synthesize
optional: false
goal: true
role: explore
functions: []
---

Write the final, polished report from `synthesize.themes`/`synthesize.gaps`/
`synthesize.all_sources`. The organization work is already done — your job is the narrative:

- `executive_summary`: 2-4 sentences answering `synthesize.topic` at a high level, written to
  reflect what the themes actually found (not a guess made before the research happened).
- `findings`: map `synthesize.themes` into `{ heading, detail }` (drop `confidence`/`sources` —
  they did their job upstream). If a theme's `confidence` was `"low"`, say so plainly inside its
  `detail` rather than presenting it with the same certainty as a `"high"`-confidence theme.
- `conclusion`: one paragraph — the bottom line across all themes, PLUS `synthesize.gaps` stated
  plainly (uncertainty, disagreement, or missing evidence is part of an honest report, not a
  defect to hide).
- `sources`: `synthesize.all_sources`, capped to the 12 most relevant `{ title, url }` entries
  (drop any remaining duplicates or empty entries).

If `synthesize.themes` is empty (no sources were ever available), say so plainly in
`executive_summary` and `conclusion`, and resolve with `findings: []` and `sources: []`.

Emit ONE statement:

currentTask.resolve({ topic: synthesize.topic, executive_summary, findings, conclusion, sources });
