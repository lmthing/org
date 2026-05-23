---
title: Deep Research
description: End-to-end research flow with explicit tasklist DAG and per-step specialist agents
defaultAgent: searcher
sink:
  name: submitBrief
  signature: (markdown: string) => void
  description: Submit the final markdown brief and end the session
tasks:
  plan:
    description: Pick a research mode, decompose the question into 1–3 search subqueries, choose freshness/topic.
    outputSchema:
      type: object
      required: [mode, subqueries]
      properties:
        mode: { type: string }
        subqueries: { type: array, items: { type: string } }
        freshness: { type: string }
        topic: { type: string }
  search:
    description: Run webSearch for each subquery; concatenate raw hits.
    dependsOn: [plan]
    outputSchema:
      type: object
      required: [rawResults]
      properties:
        rawResults: { type: array }
  triage:
    description: Canonicalize URLs, dedupe, drop low-signal domains, rank by authority + score, slice top N for reading.
    dependsOn: [search]
    outputSchema:
      type: object
      required: [topUrls]
      properties:
        topUrls: { type: array }
  read:
    description: readDocument on each topUrl with a per-doc budget; capture {sourceId, title, url, text, error?} into excerpts.
    dependsOn: [triage]
    outputSchema:
      type: object
      required: [excerpts]
      properties:
        excerpts: { type: array }
  extract:
    description: From excerpts, extract a structured list of {claim, sourceId, evidenceSnippet} entries that will back the brief.
    dependsOn: [read]
    outputSchema:
      type: object
      required: [claims]
      properties:
        claims: { type: array }
  synthesize:
    description: Draft the markdown brief in the required output format, citing [source-N] for every claim.
    dependsOn: [extract]
    outputSchema:
      type: object
      required: [brief]
      properties:
        brief: { type: string }
  verify:
    description: Self-check the draft — every claim cited, disagreements flagged, sources list complete. Return the validated brief.
    dependsOn: [synthesize]
    outputSchema:
      type: object
      required: [brief, citationsOk]
      properties:
        brief: { type: string }
        citationsOk: { type: boolean }
  submit:
    description: Call the flow's sink with the validated brief.
    dependsOn: [verify]
---

Three-phase research procedure driven by an 8-node task DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Plan & gather | `plan` → `search` → `triage` → `read` | `searcher` |
| 2 — Extract claims | `extract` | `reader` |
| 3 — Synthesize & submit | `synthesize` → `verify` → `submit` | `synthesizer` |

Each cycle's step file documents what tasks to start/finish via the registered `tasklist` handle. The runtime enforces dependency order and validates each task's output against its schema.
