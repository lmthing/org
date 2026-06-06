---
id: extract_facts
dependsOn:
  - search_broad
  - search_deep
output:
  key_facts: array
  citations: array
---

From all search results (search_broad.results and search_deep.deep_results), use extractKeyFacts() on each result's content and title. Collect all facts (up to 15). For each source used, create a citation with formatCitation(). Return key_facts array and citations array.
