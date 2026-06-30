---
id: write_tasks
output:
  ok: boolean
dependsOn: [design, write_agent, build_field]
role: general
functions:
  - writeTaskFile
---

Write the new agent's action tasklist (named `design.actionId`) as a SINGLE goal task. The
slug is `design.slug`. The task runs in a fork driven by a SMALL model, so its instruction
must be SHORT, code-first, autonomous (use the injected `query`, never ask), and end with
currentTask.resolve.

Build a REAL loadKnowledge line from a field that was actually written (`build_field`) — NEVER
write angle-bracket placeholders like loadKnowledge('<domain>',…); writeTaskFile rejects those.
Emit:

const written = Array.isArray(build_field) ? build_field.filter((x: { ok: boolean }) => x.ok) : [];
const bf = written[0];
const loadLine = bf ? ("const k = await loadKnowledge('" + bf.domain + "','" + bf.field + "','" + bf.aspect + ".md');\n") : "";
const instruction = "Answer the user's request (it is in `query`). " + (loadLine ? "Load the knowledge you need, then resolve a structured markdown answer grounded in it and `query`. Code:\n" + loadLine : "Resolve a structured markdown answer to `query`. Code:\n") + "currentTask.resolve({ answer: 'your full markdown answer' });";
const w = writeTaskFile(design.slug, design.actionId, {
  id: "answer",
  instruction: instruction,
  output: { answer: "string" },
  role: "explore",
  goal: true,
});
currentTask.resolve({ ok: w.ok });
