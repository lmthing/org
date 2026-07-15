---
id: collect
output:
  candidates: array
dependsOn: []
goal: false
role: general
capabilities: []
---

Collect the personal facts currently in memory that might belong in the new app. `query` (which
describes the new table(s)) is in scope. Call `recallAll()` — it is a synchronous built-in, do NOT
`await` it — and read `.facts` (the `{ key: value }` map). This node has NO database access
(`capabilities: []`); you only READ memory here and hand the candidates downstream.

Select the entries that look like the user's OWN app data relevant to `query` (amounts, bookings,
receipts, dated events) — NOT durable preferences ("call me V", "I like window seats"), which stay
in memory. For each, emit `{ key, value }`. Emit ONE statement:

const all = recallAll();
currentTask.resolve({ candidates: Object.entries(all.facts ?? {}).filter(/* keep app-data facts relevant to query */).map(([key, value]) => ({ key, value: String(value) })) });
