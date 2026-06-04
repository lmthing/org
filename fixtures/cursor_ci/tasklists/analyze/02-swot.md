---
id: swot
output:
  swot: any
dependsOn: [load_all]
optional: false
goal: false
---

Using the loaded knowledge from task load_all, produce a SWOT analysis for Cursor vs each competitor. Structure as: { cursor_swot: { strengths: string[], weaknesses: string[], opportunities: string[], threats: string[] }, copilot_swot: {...}, windsurf_swot: {...}, aider_swot: {...}, codeium_swot: {...} }. currentTask.resolve({ swot: { cursor_swot, copilot_swot, windsurf_swot, aider_swot, codeium_swot } });