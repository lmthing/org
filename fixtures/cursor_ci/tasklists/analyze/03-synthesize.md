---
id: synthesize
output:
  winner: string
  reasoning: string
  recommendation: string
dependsOn: [swot]
optional: false
goal: true
---

Based on the SWOT from task swot, determine the winner and produce: { winner: string, reasoning: string, recommendation: string }. The winner should be the tool with the strongest overall competitive position. Reasoning should be 2-3 sentences. Recommendation should be a 1-paragraph strategic recommendation for Cursor. currentTask.resolve({ winner, reasoning, recommendation });