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

Answer the user's request (it is in `query`). Load the knowledge file that best matches the domain and detail `query` asks about, then resolve a markdown answer grounded in it. Pick from these real files:
// await loadKnowledge('dar-es-salaam','city-guide','kivukoni-fish-market.md');
// await loadKnowledge('dar-es-salaam','transport','zanzibar-ferry.md');
// await loadKnowledge('dar-es-salaam','accommodation','sunny-shore-bb.md');
// await loadKnowledge('dar-es-salaam','itinerary','aug17-arrival.md');
Ground every claim in the knowledge you loaded: state ONLY what it explicitly states. covered:true means the loaded text EXPLICITLY states the specific fact(s) `query` asks for (the exact number, duration, date, price, or condition asked about). Text that merely covers the same topic without stating the asked fact is NOT coverage — set covered:false and say plainly what is missing. Never stretch adjacent detail into the missing specific — that gap is exactly what the research fallback is for.
Code:
const k = await loadKnowledge(/* pick the domain/field/aspect that matches query */);
// Parse k for the facts query asks. If the exact specific fact is there, covered:true.
// If the topic is mentioned but the EXACT fact is missing, covered:false and state the gap.
currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });

Ground every claim in the knowledge you loaded: state ONLY what it supports. If the loaded knowledge does not answer `query`, say so plainly in your answer and state what you DO know — never infer, guess, or present a conclusion the knowledge does not state.