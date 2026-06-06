---
id: load_all
output:
  cursor: any
  copilot: any
  windsurf: any
  aider: any
  codeium: any
dependsOn: []
optional: false
goal: false
---

Load all five competitor knowledge files: const c = await loadKnowledge("competitors","cursor","overview.md"); const cp = await loadKnowledge("competitors","copilot","overview.md"); const w = await loadKnowledge("competitors","windsurf","overview.md"); const a = await loadKnowledge("competitors","aider","overview.md"); const ci = await loadKnowledge("competitors","codeium","overview.md"); currentTask.resolve({ cursor: c, copilot: cp, windsurf: w, aider: a, codeium: ci });