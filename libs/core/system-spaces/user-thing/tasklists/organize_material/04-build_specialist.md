---
id: build_specialist
output:
  topic: string
  ok: boolean
  errors: string
dependsOn: [consolidate_scopes]
forEach: consolidate_scopes.scopes
role: general
functions: []
canDelegateTo:
  - system-architect/architect#synthesize_and_run
---

Build ONE specialist from an inventoried scope. `item` is `{ topic, goal, research }`. The supplied
material is the source, so do not research. Pass the ORIGINAL `attachmentIds` (in scope from the
outer tasklist seed) through too — `research` is only a summary, and the architect can re-read the
real documents themselves to ground a specific fact (a code, a number, a date) instead of inventing
one the summary merely implied. Emit exactly one self-contained statement: delegate to the architect
with the item directly, then resolve the result without relying on a later statement or cross-turn
variable:

currentTask.resolve(await delegate('system-architect', 'architect', 'synthesize_and_run', { query: 'Build a specialist space for ' + String(item.topic) + '.', context: { topic: String(item.topic), goal: String(item.goal), research: item.research, attachmentIds } }).then((result) => { const built = (result && result.data) ? result.data : { ok: false, errors: 'the architect returned no result' }; return { topic: String(item.topic), ok: !!(result && result.ok === true && built.ok === true), errors: String(built.errors || '') }; }));