---
id: answer
output:
  answer: string
  sources: array
dependsOn: []
goal: true
role: explore
functions:
  - webSearch
  - webFetch
prelude: |
  const q = String(query);
  const search = q ? await webSearch(q, { depth: "basic", maxResults: 4 }) : { ok: false, answer: "", results: [] };
  const top = (search.results ?? []).slice(0, 1);
  const page = top[0] ? await webFetch(top[0].url, { format: "markdown" }) : { ok: false, content: "" };
---

Answer the question quickly and SHALLOWLY. The gathering ALREADY ran (see the prelude results in
scope): `q` is the question, `search` its single web search, and `page` the fetched top result.
Do NOT search or fetch again — your budget of one search and one fetch is spent.

Write `answer`: a concise (2-4 sentence) answer grounded in `search.answer` and the page
text — base it ONLY on what you actually read, never fabricate, and say so plainly if the evidence
is thin rather than overstating it. Build `sources` as `[{ title, url }]` from `search.results`
(up to 3). If the search was unavailable or empty, set `answer` to a brief best-effort reply noting
that live sources were unavailable and `sources = []`. Then emit ONE statement:

currentTask.resolve({ answer, sources });
