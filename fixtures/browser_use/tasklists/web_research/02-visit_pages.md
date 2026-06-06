---
id: visit_pages
dependsOn:
  - search
output:
  pages: array
  combined_text: string
---

For each of the top 3 results from search.search_results, use navigatePage() to visit the URL. Extract text from each page with extractText(). Return pages array (with url, title, text) and combined_text of all pages concatenated.
