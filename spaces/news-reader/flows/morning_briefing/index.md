---
title: Morning Briefing
description: Fetch subscribed feeds, triage articles by relevance and recency, categorise by topic, and compose a structured morning briefing
defaultAgent: curator
maxCycles: 6

sink:
  name: submitBriefing
  signature: (briefing: string) => void
  description: Submit the completed morning briefing markdown

tasks:
  fetch_feeds:
    description: Load the user's subscribed feed URLs and fetch each one. Handle failures gracefully.
    outputSchema:
      type: object
      required: [items]
      properties:
        items: { type: array }
        errors: { type: array, items: { type: string } }
  triage:
    description: Deduplicate articles, remove stale items, rank by recency and source credibility, select top N.
    dependsOn: [fetch_feeds]
    outputSchema:
      type: object
      required: [topArticles]
      properties:
        topArticles: { type: array }
        stats: { type: object }
  categorise:
    description: Group articles into topic categories (politics, technology, business, science, health, world, sports, culture).
    dependsOn: [triage]
    outputSchema:
      type: object
      required: [categories]
      properties:
        categories: { type: array }
  fetch_details:
    description: Fetch full content for the top article in each category for deeper context.
    dependsOn: [categorise]
    outputSchema:
      type: object
      required: [featured]
      properties:
        featured: { type: array }
  compose:
    description: Write the final briefing markdown with sections per category, featured articles, and source citations.
    dependsOn: [fetch_details]
    outputSchema:
      type: object
      required: [briefing]
      properties:
        briefing: { type: string }
  submit:
    description: Submit the briefing via the sink.
    dependsOn: [compose]
---

Morning briefing pipeline:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Collect | `fetch_feeds` → `triage` | `curator` |
| 2 — Organise | `categorise` → `fetch_details` | `curator` |
| 3 — Deliver | `compose` → `submit` | `curator` |
