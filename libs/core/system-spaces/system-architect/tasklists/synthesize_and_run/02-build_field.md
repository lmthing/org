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
condition: design.reused != true
role: general
functions:
  - writeKnowledgeIndex
  - writeKnowledgeOption
---

Write ONE knowledge field's files, grounded in the `research` seed (a deep-research report OR a
summary of supplied material — either way, it is a SUMMARY, not the ground truth itself) and, when
`attachmentIds` are given, the REAL documents you can re-read yourself. A one-sentence summary is
not sufficient grounding for a SPECIFIC fact — and "specific" is not just identifier-shaped
precision (a serial number, a fault code, a date, an amount): it equally covers SCOPE, DURATION,
VALIDITY and CONDITION qualifiers — "covers X", "valid for/until", "applies while", "includes /
excludes", "expires after". A sentence that pairs a real fact with such a qualifier the material
never states is a fabricated claim wearing connective prose. If `attachmentIds` were given, read
them and confirm a specific claim actually appears in the real text before writing it — if it
doesn't, either describe the point more generally, or state the gap OUTRIGHT ("the supplied
material does not state how long/whether/under what conditions …"): an explicitly-stated gap is
load-bearing — it is what makes a later answer honestly report the fact as missing and trigger real
research, whereas a plausible qualifier silently poisons every answer that trusts this file. A
plausible-sounding invented specific is a worse failure than an honest, less detailed line. Your field is in `item` =
{ domain, field, aspects }; the space slug is `design.slug`. Reference `item.domain` / `item.field` /
`item.aspects` DIRECTLY — never alias `item` to a shorter name in a separate statement first: each
statement is its own module, and a lost or failed alias declaration turns every later use into a
"Cannot find name" error. Emit, in order:

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
writeKnowledgeIndex(design.slug, item.domain, item.field, { variable: item.field + "Knowledge", description: "<overview paragraph on the splitting axis and what each aspect is for, using only what findings/realText actually say — never a hand-listed slug menu>" });
// One option file per aspect (>=2), each grounded ONLY in findings/realText, and EVERY option file
// carries the same honest Source line (or none) — an unsourced option is how an invented qualifier
// later reads as trusted fact.
writeKnowledgeOption(design.slug, item.domain, item.field, item.aspects[0], "# " + item.aspects[0] + "\n\n<content using only what findings/realText actually say — never a specific (incl. a scope/duration/condition qualifier) neither one contains; name a gap explicitly rather than papering over it>" + srcLine);
writeKnowledgeOption(design.slug, item.domain, item.field, item.aspects[1], "# " + item.aspects[1] + "\n\n<content using only what findings/realText actually say — never a specific (incl. a scope/duration/condition qualifier) neither one contains; name a gap explicitly rather than papering over it>" + srcLine);
currentTask.resolve({ domain: item.domain, field: item.field, aspect: item.aspects[0], ok: true });
