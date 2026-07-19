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

Answer the user's request (it is in `query`). Load the knowledge you need, then resolve a markdown answer grounded in it and `query`. Ground every claim in the knowledge you loaded: state ONLY what it explicitly states. covered:true means the loaded text EXPLICITLY states the specific fact(s) `query` asks for (the exact number, duration, date, price, or condition asked about). Text that merely covers the same topic without stating the asked fact is NOT coverage — set covered:false and say plainly what is missing. Never stretch adjacent detail into the missing specific — that gap is exactly what the research fallback is for. Code:
const k = await loadKnowledge('arusha','arrival','dar-flight.md');
currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });

Ground every claim in the knowledge you loaded: state ONLY what it supports. If the loaded knowledge does not answer `query`, say so plainly in your answer and state what you DO know — never infer, guess, or present a conclusion the knowledge does not state.