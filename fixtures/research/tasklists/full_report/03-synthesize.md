---
id: synthesize
dependsOn:
  - extract_content
goal: true
output:
  title: string
  executive_summary: string
  main_findings: array
  conclusion: string
---

Synthesize the extracted content into a coherent research report. Based on the summaries and key_facts from extract_content, write a title, executive summary (2-3 sentences), 3-5 main findings, and a conclusion. currentTask.resolve() with the structured output.
