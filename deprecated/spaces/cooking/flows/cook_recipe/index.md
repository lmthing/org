---
title: Cook Recipe
description: Guided cooking flow — plan, scale, prep, cook, and plate a dish step-by-step
defaultAgent: chef
maxCycles: 12
sink:
  name: submitCookingReport
  signature: (report: { dish: string; outcome: string; notes: string }) => void
  description: Submit the completed cooking session report
tasks:
  clarify:
    description: Ask for the dish name (if not provided), serving count, and dietary restrictions. Confirm before proceeding.
    outputSchema:
      type: object
      required: [dish, servings]
      properties:
        dish: { type: string }
        servings: { type: number }
        restrictions: { type: array, items: { type: string } }
  source_recipe:
    description: Retrieve the recipe — from session space if saved, or delegate to recipe-researcher to find it online.
    dependsOn: [clarify]
    outputSchema:
      type: object
      required: [recipe]
      properties:
        recipe: { type: object }
  scale:
    description: Scale ingredient quantities to the requested serving count using scaleRecipe().
    dependsOn: [source_recipe]
    outputSchema:
      type: object
      required: [scaledIngredients]
      properties:
        scaledIngredients: { type: array }
  nutrition_check:
    description: Run a parallel nutritional analysis and dietary restriction fit-check via forks.
    dependsOn: [scale]
    optional: true
    outputSchema:
      type: object
      properties:
        nutritionSummary: { type: object }
        fitCheckPassed: { type: boolean }
        warnings: { type: array, items: { type: string } }
  prep:
    description: Guide through all prep steps — mise en place, chopping, marinating. Display each step and wait for user confirmation.
    dependsOn: [scale]
    outputSchema:
      type: object
      required: [prepComplete]
      properties:
        prepComplete: { type: boolean }
        userNotes: { type: string }
  cook:
    description: Walk through each cooking step with timing. Display active timers, temperatures, and technique cues. Ask for confirmation at key checkpoints.
    dependsOn: [prep]
    outputSchema:
      type: object
      required: [cookComplete]
      properties:
        cookComplete: { type: boolean }
        adjustments: { type: array, items: { type: string } }
  plate:
    description: Provide plating guidance and presentation tips for the dish. Ask for a photo or satisfaction rating.
    dependsOn: [cook]
    outputSchema:
      type: object
      required: [rating]
      properties:
        rating: { type: number }
        feedback: { type: string }
  report:
    description: Assemble and submit the cooking report including outcome, user notes, and any recipe adjustments worth saving.
    dependsOn: [plate, nutrition_check]
---

Three-phase guided cooking session driven by an 8-node task DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Setup | `clarify` → `source_recipe` → `scale` | `chef` |
| 2 — Prep & Cook | `nutrition_check` (parallel) + `prep` → `cook` | `chef` + `nutritionist` (fork) |
| 3 — Plate & Report | `plate` → `report` | `chef` |

The `nutrition_check` task is **optional** — if it fails or the user skips it, the `prep` and `cook` chain continues unblocked.
