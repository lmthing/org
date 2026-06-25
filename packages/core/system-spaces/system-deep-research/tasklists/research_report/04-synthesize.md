---
id: synthesize
dependsOn:
  - extract_facts
  - search_broad
goal: true
output:
  executive_summary: string
  main_findings: array
  conclusion: string
  sources_used: array
---

Synthesize all research into a report structure. Using search_broad.answer (if available), extract_facts.key_facts, and extract_facts.citations:
1. Write an executive summary (2-3 sentences) 
2. Extract 5 main findings from the key facts
3. Write a conclusion paragraph
4. List the sources_used (from citations)

Call currentTask.resolve() with the synthesized report data.
