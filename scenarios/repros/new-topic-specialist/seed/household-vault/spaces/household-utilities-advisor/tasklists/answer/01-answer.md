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
const k_electricity_ppc = await loadKnowledge('household','electricity-ppc','provider-details.md');
const k_water_eydap = await loadKnowledge('household','water-eydap','provider-details.md');
const k_gas_heron = await loadKnowledge('household','gas-heron','provider-details.md');
const k_payment_method = await loadKnowledge('household','payment-method','bank-account.md');
currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });