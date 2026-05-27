---
title: Track Health Trends
description: Analyze trends in vital signs and lab values over time
defaultAgent: tracker
maxCycles: 6
sink:
  name: submitTrendReport
  signature: (report: { metrics: object[]; summary: string; flaggedConcerns: string[]; disclaimer: string }) => void
  description: Submit the trend analysis report
tasks:
  load_metrics:
    description: Load all time-series health data from the profile (vitals, labs, medications).
    outputSchema:
      type: object
      required: [metrics, dateRange]
      properties:
        metrics: { type: array }
        dateRange: { type: object }
  analyze_trends:
    description: For each metric, compute trend direction, rate of change, and deviation from reference ranges.
    dependsOn: [load_metrics]
    outputSchema:
      type: object
      required: [trends, flaggedConcerns]
      properties:
        trends: { type: array }
        flaggedConcerns: { type: array, items: { type: string } }
  generate_report:
    description: Generate a visual trend report with timeline and summary.
    dependsOn: [analyze_trends]
    outputSchema:
      type: object
      required: [report]
      properties:
        report: { type: object }
  submit:
    description: Call submitTrendReport.
    dependsOn: [generate_report]
---

Two-phase trend tracking flow:

| Phase (cycle) | Tasks |
|----------------|-------|
| 1 — Load & Analyze | `load_metrics` → `analyze_trends` |
| 2 — Report & Submit | `generate_report` → `submit` |
