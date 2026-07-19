---
id: answer
output:
  answer: string
  covered: boolean
  sources: array
dependsOn: []
optional: false
goal: true
role: explore
---

Answer the user's request (it is in `query`). Load the knowledge you need, then resolve a markdown answer grounded in it and `query`. Ground every claim in the knowledge you loaded: state ONLY what it supports. If the loaded knowledge does not answer `query`, set covered:false and say so plainly — never infer or guess. Set covered:true only if the knowledge genuinely answered the question; covered:false if it did not. Code:
const k = await loadKnowledge('mortgage','greek-residential','loan-balance-and-amortization.md');
currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });