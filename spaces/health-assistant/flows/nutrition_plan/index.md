---
title: Nutrition Plan
description: Generate a personalized nutrition plan based on health profile, conditions, and medications
defaultAgent: nutritionist
maxCycles: 8
sink:
  name: submitNutritionPlan
  signature: (plan: { conditions: string[]; dietType: string; dailyTarget: object; foods: object; supplements: object[]; mealPlan: string; disclaimer: string }) => void
  description: Submit the personalized nutrition plan
tasks:
  assess:
    description: Load profile and identify all conditions, medications, and lab values affecting diet.
    outputSchema:
      type: object
      required: [conditions, medications, recentLabs]
      properties:
        conditions: { type: array }
        medications: { type: array }
        recentLabs: { type: array }
  identify_restrictions:
    description: Load diet-type knowledge for each condition and identify dietary restrictions and supplement interactions.
    dependsOn: [assess]
    outputSchema:
      type: object
      required: [restrictions, supplementWarnings]
      properties:
        restrictions: { type: array }
        supplementWarnings: { type: array }
  research_guidelines:
    description: Delegate nutrition research to the researcher agent for evidence-based dietary guidelines.
    dependsOn: [identify_restrictions]
    optional: true
    outputSchema:
      type: object
      properties:
        researchResults: { type: array }
  compose_plan:
    description: Compose the personalized nutrition plan with caloric target, macros, foods to include/avoid, and meal structure.
    dependsOn: [research_guidelines]
    outputSchema:
      type: object
      required: [plan]
      properties:
        plan: { type: object }
  submit:
    description: Call submitNutritionPlan.
    dependsOn: [compose_plan]
---

Two-phase nutrition planning flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Assess & Research | `assess` → `identify_restrictions` → `research_guidelines` |
| 2 — Compose & Submit | `compose_plan` → `submit` |
