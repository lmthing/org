---
title: Investigate
description: Research a medical condition, medication, or treatment from trusted sources with cited findings
defaultAgent: researcher
maxCycles: 8
sink:
  name: submitResearch
  signature: (report: { topic: string; summary: string; findings: object[]; sources: object[]; disclaimer: string }) => void
  description: Submit the completed medical research report
tasks:
  plan:
    description: Decompose the medical question into 1-3 targeted search queries and select trusted sources.
    outputSchema:
      type: object
      required: [queries, sources]
      properties:
        queries: { type: array, items: { type: string } }
        sources: { type: array, items: { type: string } }
  delegate_search:
    description: Delegate to the research space searcher agent for each query. Collect and dedupe results.
    dependsOn: [plan]
    outputSchema:
      type: object
      required: [searchResults]
      properties:
        searchResults: { type: array }
  delegate_read:
    description: Delegate to the research space reader agent for top results. Extract key medical content.
    dependsOn: [delegate_search]
    outputSchema:
      type: object
      required: [excerpts]
      properties:
        excerpts: { type: array }
  submit:
    description: Synthesize findings and call submitResearch.
    dependsOn: [delegate_read]
---

Two-phase research flow delegating to the research space:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Plan & Search & Read | `plan` → `delegate_search` → `delegate_read` |
| 2 — Synthesize & Submit | `submit` |
