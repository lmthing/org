---
id: write_agent
output:
  ok: boolean
  agentSlug: string
dependsOn: [design, build_field, build_function]
role: general
functions:
  - writeAgentFile
---

Write the agent header — charter.md + instruct.md — with writeAgentFile. The slug is
`design.slug`. `build_field` is the array of knowledge fields actually written
({ domain, field, aspect, ok }); `build_function` is the array of functions written
({ name, ok }). DERIVE every ref from what was actually written — never invent a ref. Emit:

const kfields = Array.isArray(build_field) ? build_field.filter((x: { ok: boolean }) => x.ok) : [];
const knowledgeRefs = kfields.map((x: { domain: string; field: string }) => x.domain + "/" + x.field);
const fnNames = (Array.isArray(build_function) ? build_function.filter((x: { ok: boolean }) => x.ok) : []).map((x: { name: string }) => x.name);
const w = writeAgentFile(design.slug, {
  agentSlug: design.slug,
  agentTitle: "<Title Case name>",
  // charter = fork-safe identity: 2-3 sentences on WHO the agent is + its domain + one guardrail.
  // No ask/delegate/UI/routing instructions here.
  charter: "<2-3 sentence identity + domain + a 'never fabricate' guardrail>",
  // systemPrompt = top-level orchestration: run the action tasklist, then display the result.
  systemPrompt: "You answer the user's request (in `query`) about <domain>. Run your action's tasklist, then display the result with built-in components. Code: const r = await tasklist('" + design.actionId + "', { query }); then display(...) the answer.",
  knowledge: knowledgeRefs,
  functions: fnNames,
  actions: [{ id: design.actionId, label: "<Label>", description: "<what the action does>", tasklist: design.actionId }],
});
currentTask.resolve({ ok: w.ok, agentSlug: design.slug });
