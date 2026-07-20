---
id: store
output:
  answer: string
  sources: array
  stored: boolean
dependsOn: [research]
optional: false
goal: true
role: general
capabilities:
  - knowledge:write
---

Save the researched finding into THIS space's knowledge so the next question is free, then return it. `research.answer` and `research.sources` are in scope, and `query`. The CALLER may pass `domain`/`field` naming where this finding belongs. Trust `domain`/`field` when given (non-empty strings); fall back to this space's own default ONLY when the caller passed neither. Pick a short kebab-case slug from `query`. Code:
const slug = String(query).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48) || 'finding';
const targetDomain = (typeof domain === 'string' && domain) ? domain : 'household';
const targetField = (typeof field === 'string' && field) ? field : 'electricity-ppc';
const w = writeKnowledge(targetDomain, targetField, slug, String(research.answer), { source: 'researched' });
currentTask.resolve({ answer: research.answer, sources: research.sources, stored: w.ok });