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
({ name, ok }). DERIVE every ref from what was actually written — never invent a ref.

Every synthesized agent gets `capabilities: ['knowledge:write']` so that when a later question
falls OUTSIDE its static knowledge it can research the answer and PERSIST it (its
`research_and_store` action), instead of guessing — the next time that question is free. Give the
agent BOTH actions: its normal `answer` action, and `research_and_store`. Its top-level prompt runs
`answer` first, and only if the knowledge did not cover the question does it fall back to researching
and storing.

The `synthesize_and_run` call itself is SETUP, not a question to answer. It must create and register
the specialist, then return its coordinates; it MUST NOT delegate to the newly-created agent during
setup. Running it on the setup topic tests an incomplete seed rather than serving a user question,
and can trigger unnecessary web research. Emit:

const kfields = Array.isArray(build_field) ? build_field.filter((x: { ok: boolean }) => x.ok) : [];
const knowledgeRefs = kfields.map((x: { domain: string; field: string }) => x.domain + "/" + x.field);
const fnNames = (Array.isArray(build_function) ? build_function.filter((x: { ok: boolean }) => x.ok) : []).map((x: { name: string }) => x.name);
const w = writeAgentFile(design.slug, {
  agentSlug: design.slug,
  agentTitle: "<Title Case name>",
  // charter = fork-safe identity: 2-3 sentences on WHO the agent is + its domain + one guardrail.
  // No ask/delegate/UI/routing instructions here.
  charter: "<2-3 sentence identity + domain + a 'never fabricate' guardrail>",
  // systemPrompt = top-level orchestration: answer from knowledge; on a gap, research + store, then answer.
  systemPrompt: "You answer the user's request (in `query`) about <domain>. FIRST run your answer tasklist: const a = await tasklist('" + design.actionId + "', { query }); a is { ok, degraded, data }. If a.data.covered is true, display a.data.answer + a.data.sources next turn. If a.data.covered is FALSE, your static knowledge did not cover it — research and SAVE it, then answer: const s = await tasklist('research_and_store', { query, domain: '<primary knowledge domain>', field: '<primary field>' }); display s.data.answer + s.data.sources. Never guess a fact your knowledge lacks — that is exactly what research_and_store is for.",
  knowledge: knowledgeRefs,
  functions: fnNames,
  capabilities: ["knowledge:write"],
  actions: [
    { id: design.actionId, label: "<Label>", description: "<what the action does>", tasklist: design.actionId },
    { id: "research_and_store", label: "Research and store", description: "Research a question the static knowledge does not cover and save the finding into this space's knowledge.", tasklist: "research_and_store" },
  ],
  defaultAction: design.actionId,
});
currentTask.resolve({ ok: w.ok, agentSlug: design.slug });
