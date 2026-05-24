---
title: Check Drug Interactions
description: Check all medications in the user's profile for drug-drug, drug-food, drug-supplement, and drug-condition interactions
defaultAgent: pharmacist
maxCycles: 6
sink:
  name: submitInteractionReport
  signature: (report: { medications: string[]; interactions: object[]; summary: string; disclaimer: string }) => void
  description: Submit the completed interaction report
tasks:
  load_medications:
    description: Load all medications and conditions from the user's health profile.
    outputSchema:
      type: object
      required: [medications, conditions]
      properties:
        medications: { type: array }
        conditions: { type: array }
  categorize:
    description: Categorize medications by drug class and identify interaction pairs to check.
    dependsOn: [load_medications]
    outputSchema:
      type: object
      required: [drugClasses, pairsToCheck]
      properties:
        drugClasses: { type: array }
        pairsToCheck: { type: array }
  check_pairs:
    description: Delegate research on each interaction pair to verify interactions and severity.
    dependsOn: [categorize]
    outputSchema:
      type: object
      required: [interactions]
      properties:
        interactions: { type: array }
  compile_report:
    description: Compile all interactions into a severity-rated report.
    dependsOn: [check_pairs]
    outputSchema:
      type: object
      required: [report]
      properties:
        report: { type: object }
  submit:
    description: Call submitInteractionReport.
    dependsOn: [compile_report]
---

Two-phase interaction check flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Load & Categorize | `load_medications` → `categorize` → `check_pairs` |
| 2 — Report & Submit | `compile_report` → `submit` |
