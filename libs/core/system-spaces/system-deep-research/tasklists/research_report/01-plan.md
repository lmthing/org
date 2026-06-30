---
id: plan
output:
  topic: string
  questions: array
dependsOn: []
optional: false
goal: false
---

The research request arrives in scope as `query` (a string — the topic to research).

This is a PURE PLANNING step — do NOT search, fetch, or call any tool here. Just:
1. Restate the request as a clean, self-contained `topic` string.
2. Decompose it into EXACTLY 3 distinct sub-questions that together cover the topic from
   different angles (e.g. background/definition, current state/evidence, implications/debate).
   These are NOT rephrasings of each other — each drives an independent investigation.

The array MUST have exactly 3 entries (a separate researcher handles each by index, 0/1/2).
Make each question specific and search-friendly (the kind of thing you'd type into a search
engine), and self-contained (it must name the subject — the researcher sees ONLY the question
string, not `topic`).

Emit this single statement (plain TypeScript — do NOT wrap it in markdown code fences):

currentTask.resolve({ topic: String(query), questions: ["<question 1>", "<question 2>", "<question 3>"] });
