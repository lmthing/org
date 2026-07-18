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

Write ONE knowledge field's files, grounded in the `research` seed (a deep-research report OR a
summary of supplied material — either way, it is a SUMMARY, not the ground truth itself) and, when
`attachmentIds` are given, the REAL documents you can re-read yourself. A one-sentence summary is
not sufficient grounding for a SPECIFIC fact (a serial number, a fault code, a date, an amount): if
`attachmentIds` were given, read them and confirm a specific claim actually appears in the real text
before writing it — if it doesn't, describe the point more generally instead of inventing the
precision the summary implied but the real document doesn't actually contain. A plausible-sounding
invented specific is a worse failure than an honest, less detailed line. Your field is in `item` =
{ domain, field, aspects }; the space slug is `design.slug`. Emit, in order:

const f = item;
const report = (() => { try { return JSON.parse(research); } catch { return { findings: [], sources: [] }; } })();
// Pull the report findings relevant to this field; ground every claim in them (or in realText below).
const findings = Array.isArray(report.findings) ? report.findings : [];
// A REAL source URL is the only honest "Source:" line — never invent one. No URL and no real
// documents behind this field means there is nothing yet worth citing; write no Source line at all
// rather than a vague phrase that reads as an authoritative report which may not exist.
const srcUrl = (Array.isArray(report.sources) && report.sources[0]) ? report.sources[0].url : "";
const srcLine = srcUrl ? ("\n\nSource: " + srcUrl) : "";
// When real documents are available, read them yourself — they are ground truth; `research` is only
// a pointer to what to look for, never a substitute for the actual text.
const ids = Array.isArray(attachmentIds) ? attachmentIds : [];
const docs = ids.length ? await Promise.all(ids.map((id: string) => readDocument(id).catch(() => ({ ok: false, text: '' })))) : [];
const realText = docs.filter((d: { ok: boolean }) => d.ok).map((d: { text?: string }) => d.text || '').join('\n\n');
// index.md body = the field OVERVIEW: GUIDANCE ONLY — the axis this field splits on and, in prose,
// what each aspect is FOR, grounded in findings/realText. Do NOT hand-list the aspect slug names —
// loadKnowledge already appends the real option list read straight off disk, so a hand-written menu
// here only drifts stale.
writeKnowledgeIndex(design.slug, f.domain, f.field, { variable: f.field + "Knowledge", description: "<overview paragraph on the splitting axis and what each aspect is for, using only what findings/realText actually say — never a hand-listed slug menu>" });
// One option file per aspect (>=2), each grounded ONLY in findings/realText, with an honest Source line (or none).
writeKnowledgeOption(design.slug, f.domain, f.field, f.aspects[0], "# " + f.aspects[0] + "\n\n<content using only what findings/realText actually say — never a specific neither one contains>" + srcLine);
writeKnowledgeOption(design.slug, f.domain, f.field, f.aspects[1], "# " + f.aspects[1] + "\n\n<content using only what findings/realText actually say — never a specific neither one contains>");
currentTask.resolve({ domain: f.domain, field: f.field, aspect: f.aspects[0], ok: true });
