---
title: Recipe Discovery
description: Search the web for recipes, read top results in parallel, compare variants, and save the best
defaultAgent: recipe-researcher
maxCycles: 8
sink:
  name: submitDiscoveredRecipe
  signature: (recipe: object) => void
  description: Submit the selected and normalized recipe for saving
tasks:
  plan_search:
    description: Decompose the user's dish request into 1–3 search queries and select search strategy.
    outputSchema:
      type: object
      required: [queries, strategy]
      properties:
        queries: { type: array, items: { type: string } }
        strategy: { type: string }
        freshness: { type: string }
  search:
    description: Run web searches via research space searcher for each query; collect and dedupe result URLs.
    dependsOn: [plan_search]
    outputSchema:
      type: object
      required: [topUrls]
      properties:
        topUrls: { type: array, items: { type: string } }
        rawResults: { type: array }
  read_parallel:
    description: Fork one reader per top URL to extract recipe content in parallel.
    dependsOn: [search]
    outputSchema:
      type: object
      required: [rawRecipes]
      properties:
        rawRecipes: { type: array }
  compare:
    description: Compare extracted recipes on ingredient count, technique complexity, source authority, and user preferences. Rank them.
    dependsOn: [read_parallel]
    outputSchema:
      type: object
      required: [rankedRecipes]
      properties:
        rankedRecipes: { type: array }
  select_and_save:
    description: Ask the user to pick a recipe, normalize it, and save to the session space.
    dependsOn: [compare]
    outputSchema:
      type: object
      required: [selectedRecipe]
      properties:
        selectedRecipe: { type: object }
---

Two-phase recipe discovery driven by a 5-node task DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Search & read | `plan_search` → `search` → `read_parallel` | `recipe-researcher` |
| 2 — Compare & save | `compare` → `select_and_save` | `recipe-researcher` |

`read_parallel` spawns one fork per URL (up to 5) so all page reads happen concurrently.
