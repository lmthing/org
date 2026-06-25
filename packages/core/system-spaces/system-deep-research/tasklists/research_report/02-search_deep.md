---
id: search_deep
dependsOn:
  - search_broad
output:
  deep_results: array
  subtopics: array
---

Use tavilySearch() with searchDepth='advanced' to get deeper information on `search_broad.query`. Identify AT MOST 2 key subtopics from `search_broad.results` and search each one (so no more than 3 tavilySearch calls total — keep it bounded). Return deep_results (all results combined) and subtopics (list of subtopic strings searched).

IMPORTANT: tavilySearch() never throws — on failure it returns `{ results: [], error: "..." }`. If a call fails or returns empty, just skip it and continue with whatever you have. If `search_broad.results` was empty, resolve immediately with `deep_results: []` and `subtopics: []`. NEVER retry a failed search more than once. You MUST call currentTask.resolve({ deep_results, subtopics }) this turn — do not keep searching.
