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

Analyze the seed variables and produce a structured summary of what needs to be built.

The seed provides `goal` (string) and `constraints` (string array). Read them and output:
- `goal`: a refined one-sentence goal describing the specialist agent's purpose
- `constraints`: a comma-separated summary of the key constraints
- `domainHints`: the key domain knowledge or APIs the synthesized agent will need (e.g. "BGG XML API v2, player count + playtime filters")

**DO NOT implement the agent. DO NOT write application logic, arrays, functions, or any code that solves the domain problem.** This is a pure analysis step — read the seed, summarize, resolve.

DO NOT call webSearch, webFetch, listDir, or spawn forks. The goal is already provided; no web research is needed here.

When done:
```typescript
currentTask.resolve({ goal, constraints, domainHints });
```
