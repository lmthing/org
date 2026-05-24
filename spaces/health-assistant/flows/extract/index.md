---
title: Extract Document
description: Analyze a medical document image, extract structured data, and save to health profile
defaultAgent: extractor
maxCycles: 6
sink:
  name: submitExtraction
  signature: (result: { category: string; data: object; saved: boolean }) => void
  description: Submit the extracted and saved document record
tasks:
  classify:
    description: Determine the document type (lab results, prescription, doctor notes, medication label, imaging report, vaccination, allergy, surgical report, discharge summary, referral, vital signs).
    outputSchema:
      type: object
      required: [category, confidence]
      properties:
        category: { type: string }
        confidence: { type: number }
  load_guidance:
    description: Load the relevant extraction guidance from knowledge based on the classified document type.
    dependsOn: [classify]
    outputSchema:
      type: object
      required: [guidanceLoaded]
      properties:
        guidanceLoaded: { type: boolean }
        category: { type: string }
  extract:
    description: Call analyzeImage with the document image and type-specific extraction prompt. Parse the response into structured data.
    dependsOn: [load_guidance]
    outputSchema:
      type: object
      required: [rawExtraction]
      properties:
        rawExtraction: { type: object }
  validate:
    description: Validate the extracted data has required fields for its category. Flag missing or unclear values.
    dependsOn: [extract]
    outputSchema:
      type: object
      required: [validatedData, issues]
      properties:
        validatedData: { type: object }
        issues: { type: array, items: { type: string } }
  save:
    description: Save the validated record to the health profile via saveRecord. Display the extraction result.
    dependsOn: [validate]
    outputSchema:
      type: object
      required: [saved]
      properties:
        saved: { type: boolean }
        recordId: { type: string }
  submit:
    description: Call submitExtraction with the final result.
    dependsOn: [save]
---

Two-phase document extraction flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Identify & Extract | `classify` → `load_guidance` → `extract` |
| 2 — Validate & Save | `validate` → `save` → `submit` |
