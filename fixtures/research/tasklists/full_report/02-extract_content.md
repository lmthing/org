---
id: extract_content
dependsOn:
  - gather_sources
output:
  summaries: array
  key_facts: array
---

For each source from gather_sources, fetch its content using fetchPage() and summarize it using summarizeText(). Extract 3-5 key facts. Return the summaries and key facts arrays.
