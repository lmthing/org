---
id: report
output:
  summary: string
dependsOn: [execute]
optional: false
goal: true
---

Synthesize the result from the delegated agent and present it clearly to the user.

Display a structured summary:
- What agent was created (slug, title, description)
- What knowledge was researched and written into it (domains, fields, source URLs from research.sources)
- What action ran and what it returned (formatted cleanly — not a raw JSON dump)
- The space directory where the agent lives (for future iteration)

Use `display()` for the presentation. Remember via `remember()` the space dir and agent slug so the architect can iterate on it in future sessions.

Resolve with `{ summary: '<one-sentence summary of what happened and what was produced>' }`.
