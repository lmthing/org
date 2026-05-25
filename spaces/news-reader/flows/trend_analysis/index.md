---
title: Trend Analysis
description: Analyse trending topics, track media coverage patterns, identify emerging stories, and visualise narrative evolution
defaultAgent: analyst
maxCycles: 6

sink:
  name: submitTrendReport
  signature: (report: string) => void
  description: Submit the trend analysis report as markdown

tasks:
  collect:
    description: Search for the topic across multiple time windows to establish coverage volume baseline.
    outputSchema:
      type: object
      required: [timeWindows]
      properties:
        timeWindows: { type: array }
        topic: { type: string }
  extract_signals:
    description: Extract entities from all collected articles. Identify high-frequency and emerging entities.
    dependsOn: [collect]
    outputSchema:
      type: object
      required: [entities, entityFrequency]
      properties:
        entities: { type: array }
        entityFrequency: { type: array }
  analyse_framing:
    description: Compare how different outlets frame the topic. Detect bias patterns and narrative shifts.
    dependsOn: [extract_signals]
    outputSchema:
      type: object
      required: [outletFraming, narrativeTimeline]
      properties:
        outletFraming: { type: array }
        narrativeTimeline: { type: array }
  synthesize:
    description: Write the trend analysis report with volume charts, entity analysis, framing comparison, and outlook.
    dependsOn: [analyse_framing]
    outputSchema:
      type: object
      required: [report]
      properties:
        report: { type: string }
  submit:
    description: Submit the report via the sink.
    dependsOn: [synthesize]
---

Trend analysis pipeline with 5-node DAG:

| Phase (cycle) | Tasks | Agent |
|---------------|-------|-------|
| 1 — Collect | `collect` → `extract_signals` | `analyst` |
| 2 — Analyse | `analyse_framing` | `analyst` |
| 3 — Report | `synthesize` → `submit` | `analyst` |
