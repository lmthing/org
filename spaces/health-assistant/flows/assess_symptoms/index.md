---
title: Assess Symptoms
description: Evaluate symptoms for urgency and recommend appropriate care level
defaultAgent: triage
maxCycles: 6
sink:
  name: submitTriageAssessment
  signature: (assessment: { symptoms: string; urgency: string; reasoning: string; recommendation: string; disclaimer: string }) => void
  description: Submit the triage assessment
tasks:
  gather:
    description: Gather symptom details from the user via ask(). Collect onset, severity, duration, location, associated symptoms.
    outputSchema:
      type: object
      required: [symptoms, severity]
      properties:
        symptoms: { type: string }
        severity: { type: number }
        onset: { type: string }
        duration: { type: string }
        associatedSymptoms: { type: array, items: { type: string } }
  contextualize:
    description: Load relevant medical history to contextualize symptoms.
    dependsOn: [gather]
    outputSchema:
      type: object
      required: [relevantHistory]
      properties:
        relevantHistory: { type: object }
  evaluate:
    description: Apply urgency criteria and specialty-specific red flags to determine urgency level.
    dependsOn: [contextualize]
    outputSchema:
      type: object
      required: [urgency, reasoning]
      properties:
        urgency: { type: string }
        reasoning: { type: string }
  recommend:
    description: Determine recommended care setting and next steps based on urgency level.
    dependsOn: [evaluate]
    outputSchema:
      type: object
      required: [recommendation, careSetting]
      properties:
        recommendation: { type: string }
        careSetting: { type: string }
  submit:
    description: Call submitTriageAssessment.
    dependsOn: [recommend]
---

Two-phase triage flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Gather & Evaluate | `gather` → `contextualize` → `evaluate` |
| 2 — Recommend & Submit | `recommend` → `submit` |
