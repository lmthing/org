---
id: scope
output:
  topic: string
  landscape: string
  seedSources: array
dependsOn: []
optional: false
goal: false
role: explore
functions:
  - webSearch
prelude: |
  const topic = String(query);
  const overview = topic ? await webSearch(topic, { depth: "basic", maxResults: 8 }) : { ok: false, answer: "", results: [] };
  const recent = topic ? await webSearch(topic + " latest developments", { depth: "basic", maxResults: 5, topic: "news" }) : { ok: false, answer: "", results: [] };
---

You survey the topic before anyone commits to a plan. This is BROAD reconnaissance, not deep
reading — snippets only, no page fetches. The searches ALREADY ran (see the prelude results in
scope): `topic` is the request, `overview` is a broad search, `recent` is a news-biased search.

Write `landscape`: a 4-6 sentence survey of what this topic actually contains — key terms,
named entities/organizations, sub-topics, and any notable recent development — grounded ONLY in
`overview.answer`/`recent.answer` and the result titles/snippets you actually saw. This is
reconnaissance for the planner, not a final answer — note what looks well-covered vs. thin, never
fabricate beyond what the snippets show.

Build `seedSources` as `[{ title, url }]` from the combined top results of `overview` and `recent`
(dedupe by URL, cap at 8). If both searches were unavailable or empty, set `landscape` to a brief
note that live search was unavailable and `seedSources = []`. Then emit:

currentTask.resolve({ topic, landscape, seedSources });
