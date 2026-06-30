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
---

Answer the question quickly with a SHALLOW search. The question is in scope as `query` (a
string). Do ONE web search and read at most ONE page, then synthesize a concise answer.

Emit PLAIN TypeScript statements, ONE per turn. Do NOT wrap anything in markdown code fences.
`webSearch`/`webFetch` are yielding host calls — keep them FLAT at the top level, one per
statement, ternary-guarded. NEVER nest a yield inside if/else/loops/try. Emit, in order:

const q = String(query);

const search = q ? await webSearch(q, { depth: "basic", maxResults: 4 }) : { ok: false, answer: "", results: [] };

const top = (search.results ?? []).slice(0, 1);

const page = top[0] ? await webFetch(top[0].url, { format: "markdown" }) : { ok: false, content: "" };

Now write `answer`: a concise (2-4 sentence) answer grounded in `search.answer` and the page
text — base it ONLY on what you actually read, never fabricate, and say so plainly if the evidence
is thin rather than overstating it. Build `sources` as `[{ title, url }]` from `search.results`
(up to 3). If the search was unavailable or empty, set `answer` to a brief best-effort reply noting
that live sources were unavailable and `sources = []`. Then emit:

currentTask.resolve({ answer, sources });
