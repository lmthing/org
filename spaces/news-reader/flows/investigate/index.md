---
title: Investigate Story
description: Deep-dive into a news story — gather multiple sources, cross-reference facts, identify discrepancies, and produce a detailed report
defaultAgent: investigator
maxCycles: 8

sink:
  name: submitInvestigation
  signature: (report: string) => void
  description: Submit the investigation report as markdown

tasks:
  search:
    description: Cast a wide net — search for the story across multiple providers with varied queries.
    outputSchema:
      type: object
      required: [articles]
      properties:
        articles: { type: array }
        queryVariations: { type: array, items: { type: string } }
  triage_sources:
    description: Rank sources by credibility. Select top 5–8 for deep reading. Discard low-credibility duplicates.
    dependsOn: [search]
    outputSchema:
      type: object
      required: [topUrls]
      properties:
        topUrls: { type: array }
        skippedCount: { type: number }
  read:
    description: Fetch full article content from each selected source in parallel.
    dependsOn: [triage_sources]
    outputSchema:
      type: object
      required: [excerpts]
      properties:
        excerpts: { type: array }
  extract:
    description: Extract entities and verifiable claims from each article. Tag each claim with its source.
    dependsOn: [read]
    outputSchema:
      type: object
      required: [claims, entities]
      properties:
        claims: { type: array }
        entities: { type: array }
  cross_reference:
    description: Cross-reference claims across sources. Identify confirmed, disputed, and unverified claims.
    dependsOn: [extract]
    outputSchema:
      type: object
      required: [confirmed, disputed, unverified]
      properties:
        confirmed: { type: array }
        disputed: { type: array }
        unverified: { type: array }
  synthesize:
    description: Write the investigation report with confidence-tagged claims and source citations.
    dependsOn: [cross_reference]
    outputSchema:
      type: object
      required: [report]
      properties:
        report: { type: string }
  submit:
    description: Submit the report via the sink.
    dependsOn: [synthesize]
---

Investigation pipeline with 7-node DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Gather | `search` → `triage_sources` → `read` | `investigator` |
| 2 — Analyse | `extract` → `cross_reference` | `investigator` |
| 3 — Report | `synthesize` → `submit` | `investigator` |
