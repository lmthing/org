---
id: understand
output:
  goal: string
  constraints: string
  domainHints: string
dependsOn: []
optional: false
goal: false
---

Clarify what kind of specialist agent is needed. Determine:
- The core goal the agent should accomplish
- Any constraints (input/output format, tools available, time bounds)
- Domain hints: what knowledge or APIs the agent will need

If the goal is ambiguous or technical in nature, spawn an explore fork to investigate the codebase or web before deciding.

Report a concise summary in the output fields.
