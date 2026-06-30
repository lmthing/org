---
id: investigate_c
output:
  question: string
  findings: string
  sources: array
dependsOn:
  - plan
optional: false
goal: false
---

You are ONE of three parallel researchers. Investigate a SINGLE question in isolation:
`plan.questions[2]`. Your parent sees only the object you resolve, so synthesize — do not dump.

Emit PLAIN TypeScript statements, ONE per turn. Do NOT wrap anything in markdown code fences
(no ``` and no language tag) — fences break statement parsing here.

`webSearch` and `webFetch` are yielding host calls. Keep them FLAT at the top level, ONE per
statement, guarded with ternaries. NEVER nest a yielding call inside if/else/loops/try — code
after a yield in a nested scope does NOT re-run when the turn resumes. Stay bounded: ONE search
and at most TWO fetches. Emit these statements in order:

const question = (Array.isArray(plan.questions) && plan.questions[2]) ? String(plan.questions[2]) : "";

const search = question ? await webSearch(question, { depth: "advanced", maxResults: 5 }) : { ok: false, answer: "", results: [] };

const top = (search.results ?? []).slice(0, 2);

const page1 = top[0] ? await webFetch(top[0].url) : { ok: false, content: "" };

const page2 = top[1] ? await webFetch(top[1].url) : { ok: false, content: "" };

Now write `findings`: a 4-6 sentence synthesis grounded in `search.answer` and the fetched page
text, with concrete facts, figures, dates, and names — base it ONLY on what you actually read,
never fabricate. Build `sources` as `[{ title, url }]` from `top`. If the search was
unavailable or returned nothing (`!search.ok` or empty `results`, or `question` was empty), use
`findings = "No sources were available for this question."` and `sources = []`. Then emit:

currentTask.resolve({ question, findings, sources });
