---
id: reason
output:
  answer: string
  sources: array
dependsOn: [ask]
goal: true
role: general
capabilities:
  - db:read
  - api:call
canDelegateTo:
  - user-memory/memory
---

Assemble the final answer. `query` (the original question) and `ask` (the array of per-sub-question
results `{ q, spaceKey, answer, sources }`) are in scope. This node holds `db:read` + `api:call`.

1. For every `ask` element whose `spaceKey` is `'self'` (the user's OWN data), get the answer NOW:
   `db.query(...)` the relevant table, or `apiCall('<endpoint>')` when the app computes the figure
   (one number, from the app's own route — never a fresh recomputation). Recall a relevant preference
   with `delegate('user-memory', 'memory', { query: '<what to recall>' })` if the answer depends on it.
   **A claim that something is or isn't stored must rest on queries you ran in THIS node**: verify
   the real table names with `db.tables()`, query every table that could plausibly hold it, and only
   then state what you found — "nothing stored" is only true after the plausible tables came back
   empty, and then say WHICH you checked. Never infer absence from a name that didn't exist or a
   query you didn't run.
2. The other `ask` elements already carry their space's `answer` and `sources` — use them as-is.
3. Reason over ALL of it and write one coherent `answer` to `query`, in plain prose. Merge every
   element's `sources` into a single `sources` array (dedup by url; may be empty).

Base the answer only on what the sources and your db/api reads actually returned; never fabricate.
`answer` is PROSE that answers `query` — never a raw structure, a table list, row counts, or any
other introspection value passed through as if it were the answer. Emit ONE statement:

currentTask.resolve({ answer: "<the unified answer>", sources: [ /* { title, url } */ ] });
