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

Answer the user's request (it is in `query`). Load ALL the knowledge files below; together they cover park fees AND voice-memo facts. Ground your answer in what you loaded: state only what the files explicitly state. covered:true means EVERY specific fact in `query` (the exact dollar figures, the 5,000 TZS ranger-tip question, the Maasai bracelet price, the Jevas half-board arrangement, the visitor rules) IS explicitly stated in the loaded files. If any specific fact is missing, set covered:false and say what's missing. Code:
const parkFees = await loadKnowledge('safari','ngorongoro','park-fees.md');
const maasai = await loadKnowledge('trip','voice-memo','maasai-bracelet.md');
currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });

Ground every claim in the knowledge you loaded: state ONLY what it supports. If the loaded knowledge does not answer `query`, say so plainly in your answer and state what you DO know — never infer, guess, or present a conclusion the knowledge does not state.