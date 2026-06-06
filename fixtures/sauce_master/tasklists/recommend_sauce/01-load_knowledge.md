---
id: load_knowledge
output:
  knowledge: any
  loaded: boolean
dependsOn: []
optional: false
goal: false
---

Load the cuisine knowledge for the requested cuisine. Use: const k = await loadKnowledge('sauce_techniques', 'cuisines', cuisineSlug + '.md'); where cuisineSlug is the lowercase cuisine name from the input. Resolve: currentTask.resolve({ knowledge: k, loaded: !!k })