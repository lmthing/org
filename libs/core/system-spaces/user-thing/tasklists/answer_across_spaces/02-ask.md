---
id: ask
output:
  q: string
  spaceKey: string
  answer: string
  sources: array
dependsOn: [split]
forEach: split.subquestions
goal: false
role: general
canDelegateTo:
  - "registered:*"
---

Answer ONE sub-question. `item` (`{ q, spaceKey, agent }`) and `index` are in scope. Do one thing:

- If `item.spaceKey` is `'self'` or empty → this is the user's OWN data or has no owning space; do
  NOT delegate. Resolve a passthrough so step three answers it: `{ q: item.q, spaceKey: item.spaceKey,
  answer: '', sources: [] }`.
- Otherwise → ask the owning space: `const r = await delegate(item.spaceKey, item.agent, { query: item.q });`
  Read `r` and resolve `{ q: item.q, spaceKey: item.spaceKey, answer: '<what the space answered, in
  prose>', sources: <r.sources ?? []> }`.

Never fabricate a space answer. Emit ONE `currentTask.resolve({...})` statement.
