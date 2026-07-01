---
id: investigate
output:
  question: string
  findings: string
  sources: array
  confidence: string
  gaps: string
dependsOn: [plan]
forEach: plan.questions
optional: false
role: explore
functions:
  - webSearch
  - webFetch
prelude: |
  const question = String(item);
  const search = question ? await webSearch(question, { depth: "advanced", maxResults: 6 }) : { ok: false, answer: "", results: [] };
  const top = (search.results ?? []).slice(0, 3);
  const page1 = top[0] ? await webFetch(top[0].url, { format: "markdown" }) : { ok: false, content: "" };
  const page2 = top[1] ? await webFetch(top[1].url, { format: "markdown" }) : { ok: false, content: "" };
  const page3 = top[2] ? await webFetch(top[2].url, { format: "markdown" }) : { ok: false, content: "" };
---

You investigate ONE research question in isolation. The gathering ALREADY ran (see the prelude
results in scope): `question` is your question, `search` its web search, `top` the top 3 results,
and `page1`/`page2`/`page3` their fetched pages. Do NOT search or fetch again — your budget of one
search and three fetches is spent. Your parent sees only the object you resolve — so synthesize,
do not dump.

Write `findings`: a 5-8 sentence synthesis grounded in `search.answer` and the three fetched
pages, with concrete facts, figures, dates, and names — base it ONLY on what you actually read,
never fabricate. Build `sources` as `[{ title, url }]` from `top`.

Then assess your own evidence honestly:
- `confidence`: `"high"` if multiple fetched pages corroborate the same facts, `"medium"` if only
  one page or the search answer supported the findings, `"low"` if pages failed to fetch or were
  thin/off-topic.
- `gaps`: one sentence on what remains unknown, contested, or under-sourced for this question
  (empty string `""` only if you are genuinely confident nothing is missing).

If the search was unavailable or returned nothing, use `findings = "No sources were available for
this question."`, `sources = []`, `confidence = "low"`, `gaps = "No live sources were available."`.
Then emit ONE statement:

currentTask.resolve({ question, findings, sources, confidence, gaps });
