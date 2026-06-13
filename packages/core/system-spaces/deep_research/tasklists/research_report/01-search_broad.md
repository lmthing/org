---
id: search_broad
output:
  results: array
  answer: string
  query: string
---

Use tavilySearch() to search broadly for the `topic` variable (available in scope). Use searchDepth='basic' and maxResults=8. Return the full results array, the AI answer, and the query used (the topic itself).

IMPORTANT: tavilySearch() never throws — on failure it returns `{ results: [], error: "..." }`. If `results` is empty or `error` is set, do NOT retry endlessly: resolve immediately with `results: []`, `answer: "Search unavailable: " + (result.error ?? "no results")`, and `query: topic`. The downstream tasks handle empty results gracefully. Always call currentTask.resolve() this turn.
