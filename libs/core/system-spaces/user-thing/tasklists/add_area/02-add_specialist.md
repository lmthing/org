---
id: add_specialist
output:
  ok: boolean
  spaceKey: string
  detail: string
dependsOn: [assess]
condition: "assess.isNewArea == true"
goal: false
role: general
functions: []
canDelegateTo:
  - system-architect/architect#synthesize_and_run
---

Create ONE grounded specialist space for the new area. This node runs ONLY when `assess` judged the
area genuinely new (`assess.isNewArea == true`) — it is a fixed DAG step, so the decision to build the
specialist is never left to a stochastic in-turn choice. `assess` (`topic`, `goal`, `groundingFacts`),
`attachmentIds` and `specialistFacts` are in scope.

The supplied material is the source — do NOT research. Seed the concrete facts into the architect
handoff so the specialist is grounded (and pass `attachmentIds` so it can re-read the real documents
for a specific identifier/date/value the summary only implies). The architect is idempotent for a
topic: if a same-topic space already exists it is reused, not duplicated. `research` MUST be a JSON
string. Emit exactly one self-contained statement that delegates and resolves without relying on a
later statement or cross-turn variable:

currentTask.resolve(await delegate('system-architect', 'architect', 'synthesize_and_run', { query: 'Build a specialist space for ' + String(assess.topic) + '.', context: { topic: String(assess.topic), goal: String(assess.goal), research: JSON.stringify({ topic: String(assess.topic), executive_summary: String(assess.goal), findings: [{ heading: String(assess.topic), detail: String(assess.groundingFacts || '') + (specialistFacts ? ('\n' + String(specialistFacts)) : '') }], conclusion: '', sources: [] }), attachmentIds } }).then((result) => { const built = (result && result.data) ? result.data : { ok: false, spaceKey: '', errors: 'the architect returned no result' }; return { ok: !!(result && result.ok === true && built.ok === true), spaceKey: String(built.spaceKey || ''), detail: String(built.errors || 'built the specialist for ' + String(assess.topic)) }; }));
