---
title: Validate Source
description: Assess the credibility, bias, factuality, and reliability of a news source or article
defaultAgent: fact-checker
maxCycles: 4

sink:
  name: submitValidation
  signature: (validation: { domain: string; credibilityScore: number; biasRating: string; factualityRating: string; assessment: string; concerns: string[]; recommendation: string }) => void
  description: Submit the source validation assessment

tasks:
  analyze:
    description: Fetch domain info and article content. Evaluate editorial standards, transparency, and bias.
    outputSchema:
      type: object
      required: [domainInfo, articleContent, claims]
      properties:
        domainInfo: { type: object }
        articleContent: { type: string }
        claims: { type: array }
  corroborate:
    description: Search for corroborating or contradicting coverage from high-credibility sources.
    dependsOn: [analyze]
    outputSchema:
      type: object
      required: [corroboration, contradictions]
      properties:
        corroboration: { type: array }
        contradictions: { type: array }
  assess:
    description: Produce the final assessment with recommendation and submit via sink.
    dependsOn: [corroborate]
---

Source validation pipeline:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Analyse | `analyze` | `fact-checker` |
| 2 — Corroborate | `corroborate` | `fact-checker` |
| 3 — Assess | `assess` | `fact-checker` |
