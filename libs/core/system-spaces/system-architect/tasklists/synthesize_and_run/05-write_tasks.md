---
id: write_tasks
output:
  ok: boolean
dependsOn: [design, write_agent, build_field]
role: general
functions:
  - writeTaskFile
---

Write the new agent's TWO tasklists, both driven by SMALL models, so every instruction must be
SHORT, code-first, autonomous (use the injected `query`, never ask), and end with
currentTask.resolve. Build REAL loadKnowledge lines from a field that was actually written
(`build_field`) — the answer task's Code MUST call `loadKnowledge(domain, field)` FIRST to get
the real option list (`build_field` writes >= 2 aspect files per field, never just one), then
tell the model to load the exact aspect(s) BY NAME from what that call returns, never a single
hardcoded aspect. NEVER angle-bracket placeholders; writeTaskFile rejects those.

**1. The answer tasklist** (`design.actionId`) — a single goal task that answers from static
knowledge AND reports whether the knowledge actually COVERED the question (so the agent can escalate
to research when it did not). **2. The `research_and_store` tasklist** — two nodes: research the web,
then persist the finding into this space's knowledge with `writeKnowledge` (own-space, gated by the
`knowledge:write` cap the agent now holds), so a repeat question is free. Emit:

const written = Array.isArray(build_field) ? build_field.filter((x: { ok: boolean }) => x.ok) : [];
const bf = written[0];
const dom = bf ? bf.domain : "";
const fld = bf ? bf.field : "";
const loadLine = bf ? ("const menu = await loadKnowledge('" + dom + "','" + fld + "');\n") : "";
const grounding = "Ground every claim in the knowledge you loaded: state ONLY what it explicitly states. covered:true means the loaded text EXPLICITLY states the specific fact(s) `query` asks for (the exact number, duration, date, price, or condition asked about). Text that merely covers the same topic without stating the asked fact is NOT coverage — set covered:false and say plainly what is missing. Never stretch adjacent detail into the missing specific — that gap is exactly what the research fallback is for. ";
const answerInstruction = "Answer the user's request (it is in `query`). " + (loadLine ? "First see the field's real option list — Code:\n" + loadLine + "Then load the exact aspect(s) that list names as loadKnowledge's third argument, choosing by what `query` actually asks (load more than one aspect if more than one applies) — never invent or guess a name past what the list gave you. Resolve a markdown answer grounded in what you loaded. " + grounding : "Resolve a markdown answer to `query`, covered:true. Code:\n") + "currentTask.resolve({ answer: 'your full markdown answer', covered: true, sources: [] });";
const wa = writeTaskFile(design.slug, design.actionId, {
  id: "answer",
  instruction: answerInstruction,
  output: { answer: "string", covered: "boolean", sources: "array" },
  role: "explore",
  goal: true,
});
const wr1 = writeTaskFile(design.slug, "research_and_store", {
  id: "research",
  instruction: "Research the answer to `query` on the live web. Call webSearch(query) then webFetch the top result's url, and resolve a concise answer grounded ONLY in what you read, with sources. Code:\nconst s = await webSearch(String(query), { depth: 'basic', maxResults: 4 });\nconst top = (s.results || [])[0];\nconst page = top ? await webFetch(top.url, { format: 'markdown' }) : { content: '' };\ncurrentTask.resolve({ answer: 'a concise answer grounded in what you read', sources: (s.results || []).slice(0,3).map(function(r){ return { title: r.title, url: r.url }; }) });",
  output: { answer: "string", sources: "array" },
  role: "explore",
  functions: ["webSearch", "webFetch"],
});
const wr2 = writeTaskFile(design.slug, "research_and_store", {
  id: "store",
  instruction: "Save the researched finding into THIS space's knowledge so the next question is free, then return it. `research.answer` and `research.sources` are in scope, and `query`. The CALLER may pass `domain`/`field` naming where this finding belongs — a specific topic call ALWAYS names the field it's about, so it lands where a later read for that SAME topic will look, not wherever the space's first-ever knowledge happened to be filed. Trust `domain`/`field` when given (non-empty strings); fall back to this space's own default ONLY when the caller passed neither. Pick a short kebab-case slug from `query`. Code:\nconst slug = String(query).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48) || 'finding';\nconst targetDomain = (typeof domain === 'string' && domain) ? domain : '" + dom + "';\nconst targetField = (typeof field === 'string' && field) ? field : '" + fld + "';\nconst w = writeKnowledge(targetDomain, targetField, slug, String(research.answer), { source: 'researched' });\ncurrentTask.resolve({ answer: research.answer, sources: research.sources, stored: w.ok });",
  output: { answer: "string", sources: "array", stored: "boolean" },
  role: "general",
  capabilities: ["knowledge:write"],
  dependsOn: ["research"],
  goal: true,
});
currentTask.resolve({ ok: wa.ok && wr1.ok && wr2.ok });
