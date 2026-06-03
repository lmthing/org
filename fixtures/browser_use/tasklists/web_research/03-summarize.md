---
id: summarize
dependsOn:
  - visit_pages
  - search
goal: true
output:
  title: string
  summary: string
  key_points: array
  sources: array
---

Based on the combined_text from visit_pages and search_results from search, write a comprehensive summary of the `query` topic. Return a title, 2-3 sentence summary, 5 key_points (strings), and sources (list of visited URLs).
