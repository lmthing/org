---
title: Search News
description: Search the web for specific news topics with filtering, categorisation, and source validation
defaultAgent: curator
maxCycles: 4

sink:
  name: submitResults
  signature: (results: { query: string; articles: Array<{ title: string; url: string; snippet: string; source: string; publishedAt?: string; credibility?: number }>; summary: string }) => void
  description: Submit the search results with source validation

tasks:
  search:
    description: Run the news search with appropriate freshness, domain filters, and query expansion.
    outputSchema:
      type: object
      required: [articles]
      properties:
        articles: { type: array }
        query: { type: string }
  validate:
    description: Check credibility of each source domain. Flag low-credibility sources.
    dependsOn: [search]
    outputSchema:
      type: object
      required: [articles]
      properties:
        articles: { type: array }
  present:
    description: Format the validated results and submit via sink.
    dependsOn: [validate]
---

Two-phase news search with source validation:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Search & validate | `search` → `validate` | `curator` |
| 2 — Present | `present` | `curator` |
