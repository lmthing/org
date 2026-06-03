---
id: search_deep
dependsOn:
  - search_broad
output:
  deep_results: array
  subtopics: array
---

Based on the query from search_broad, use tavilySearch() with searchDepth='advanced' to get deeper information. Also identify 2-3 key subtopics from the broad results and search each one. Return deep_results (all results combined) and subtopics (list of subtopic strings searched).
