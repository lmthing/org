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
  // Both branches end in currentTask.resolve, never display — this agent runs as a DELEGATE action,
  // and the caller (never this agent) presents the reply; a branch that displays instead of resolving
  // lets its own real, researched answer get silently dropped (the caller only ever receives whatever
  // was resolved, so a display-only branch hands the caller back its OWN stale pre-research data).
  systemPrompt: "You answer the user's request (in `query`) about <domain>. Run your answer tasklist: const a = await tasklist('" + design.actionId + "', { query }); a is { ok, degraded, data }. If a.data.covered is true, currentTask.resolve({ answer: a.data.answer, covered: true, sources: a.data.sources }). If a.data.covered is FALSE, your static knowledge did not cover it — research and SAVE it, then resolve the NEW answer, never the stale covered:false one: const s = await tasklist('research_and_store', { query, domain: '<primary knowledge domain>', field: '<primary field>' }); the result carries s.data.stored — CHECK it: if s.data.stored is false the finding did NOT land in knowledge (the next question would re-research), so retry ONCE with the space defaults: const s2 = await tasklist('research_and_store', { query }); then resolve from whichever attempt stored (or, if both failed, resolve the answer with its sources and say plainly in the answer that the finding could not be saved). currentTask.resolve({ answer: s.data.answer, covered: true, sources: s.data.sources }). Always end by calling currentTask.resolve — your caller relays what you resolve, it never sees anything shown only on-screen by you. Never guess a fact your knowledge lacks — that is exactly what research_and_store is for.",
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
