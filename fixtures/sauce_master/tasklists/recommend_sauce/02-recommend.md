---
id: recommend
output:
  technique: string
  ingredients: string
  recipe: string
  rationale: string
dependsOn: [load_knowledge]
optional: false
goal: true
---

Using the loaded cuisine knowledge and the dish context, identify the ideal sauce technique. Explain why it fits the dish, list the essential ingredients with quantities, and provide a step-by-step recipe. Format the response as a structured recommendation. Resolve: currentTask.resolve({ technique: 'string', ingredients: 'string', recipe: 'string', rationale: 'string' })