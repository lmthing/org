---
title: Meal Plan
description: Build a personalised weekly meal plan with shopping list, considering pantry stock and dietary constraints
defaultAgent: chef
maxCycles: 12
sink:
  name: submitMealPlan
  signature: (plan: { meals: object[]; shoppingList: object[] }) => void
  description: Submit the final weekly meal plan and shopping list
tasks:
  gather_constraints:
    description: Ask the user for number of people, dietary restrictions, cuisine preferences, cooking time budget per day, and which meals to cover (breakfast/lunch/dinner).
    outputSchema:
      type: object
      required: [people, mealTypes, restrictions]
      properties:
        people: { type: number }
        mealTypes: { type: array, items: { type: string } }
        restrictions: { type: array, items: { type: string } }
        cuisinePrefs: { type: array, items: { type: string } }
        maxMinutesPerDay: { type: number }
  check_pantry:
    description: Load the current pantry snapshot (if available) and flag items expiring within 3 days as "use soon".
    dependsOn: [gather_constraints]
    optional: true
    outputSchema:
      type: object
      properties:
        pantrySnapshot: { type: object }
        useSoonItems: { type: array, items: { type: string } }
  propose_meals:
    description: Fork one worker per day of the week to propose meals concurrently, respecting constraints and pantry stock.
    dependsOn: [gather_constraints, check_pantry]
    outputSchema:
      type: object
      required: [meals]
      properties:
        meals: { type: array }
  review_plan:
    description: Display the proposed plan and ask the user to approve, swap, or adjust individual meals.
    dependsOn: [propose_meals]
    outputSchema:
      type: object
      required: [approvedMeals]
      properties:
        approvedMeals: { type: array }
  shopping_list:
    description: Aggregate all ingredient requirements across approved meals, diff against pantry stock, and produce a consolidated shopping list grouped by category.
    dependsOn: [review_plan, check_pantry]
    outputSchema:
      type: object
      required: [shoppingList]
      properties:
        shoppingList: { type: array }
  submit:
    description: Submit the final plan and shopping list.
    dependsOn: [shopping_list]
---

Three-phase meal planning driven by a 6-node task DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Constraints & pantry | `gather_constraints` → `check_pantry` | `chef` + `pantry-manager` |
| 2 — Plan & review | `propose_meals` → `review_plan` | `chef` (7 parallel forks) |
| 3 — Shopping & submit | `shopping_list` → `submit` | `chef` + `pantry-manager` |
