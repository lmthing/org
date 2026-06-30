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
---

You investigate ONE research question in isolation. Your question is in `item` (a string). Your
parent sees only the object you resolve — so synthesize, do not dump.

Emit PLAIN TypeScript statements, ONE per turn. Do NOT wrap anything in markdown code fences.
`webSearch` and `webFetch` are yielding host calls — keep them FLAT at the top level, ONE per
statement, ternary-guarded. NEVER nest a yielding call inside if/else/loops/try. Stay bounded: ONE
search and at most THREE fetches. Emit, in order:

const question = String(item);

const search = question ? await webSearch(question, { depth: "advanced", maxResults: 6 }) : { ok: false, answer: "", results: [] };

const top = (search.results ?? []).slice(0, 3);

const page1 = top[0] ? await webFetch(top[0].url, { format: "markdown" }) : { ok: false, content: "" };

const page2 = top[1] ? await webFetch(top[1].url, { format: "markdown" }) : { ok: false, content: "" };

const page3 = top[2] ? await webFetch(top[2].url, { format: "markdown" }) : { ok: false, content: "" };

Now write `findings`: a 5-8 sentence synthesis grounded in `search.answer` and the THREE fetched
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
Then emit:

currentTask.resolve({ question, findings, sources, confidence, gaps });
