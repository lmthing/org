---
id: build_field
output:
  domain: string
  field: string
  aspect: string
  ok: boolean
dependsOn: [design]
forEach: design.fields
optional: true
role: general
functions:
  - writeKnowledgeIndex
  - writeKnowledgeOption
---

Write ONE knowledge field's files, grounded in the deep-research report (the validated, sourced
knowledge is already in the `research` seed; you have only the knowledge-writing tools). Your field is in `item` =
{ domain, field, aspects }; the space slug is `design.slug`. Emit, in order:

const f = item;
const report = (() => { try { return JSON.parse(research); } catch { return { findings: [], sources: [] }; } })();
// Pull the report findings + source URLs relevant to this field; cite real sources, never fabricate.
const findings = Array.isArray(report.findings) ? report.findings : [];
const srcUrl = (Array.isArray(report.sources) && report.sources[0]) ? report.sources[0].url : "the research report";
// index.md body = the field OVERVIEW: a short paragraph introducing EACH aspect, drawn from `findings`.
writeKnowledgeIndex(design.slug, f.domain, f.field, { variable: f.field + "Knowledge", description: "<overview paragraph introducing every aspect, grounded in the report>" });
// One option file per aspect (>=2), each a distinct sub-topic grounded in `findings`, with a Source line.
writeKnowledgeOption(design.slug, f.domain, f.field, f.aspects[0], "# " + f.aspects[0] + "\n\n<content grounded in the report>\n\nSource: " + srcUrl);
writeKnowledgeOption(design.slug, f.domain, f.field, f.aspects[1], "# " + f.aspects[1] + "\n\n<content grounded in the report>");
currentTask.resolve({ domain: f.domain, field: f.field, aspect: f.aspects[0], ok: true });
