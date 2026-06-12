---
id: extract_facts
dependsOn:
  - search_broad
  - search_deep
output:
  key_facts: array
  citations: array
---

`extractKeyFacts(content, title)` and `formatCitation(title, url)` are ALREADY
provided as in-scope functions — call them directly. Do NOT redefine them, and do
NOT write any `function` declarations (multi-line definitions break statement
parsing). Use only the single-statement code below, adapting nothing:

```typescript
const all = [...((search_broad as any).results ?? []), ...((search_deep as any).deep_results ?? [])];
const key_facts = all.flatMap((r: any) => extractKeyFacts(String(r.content ?? ""), String(r.title ?? ""))).slice(0, 15);
const citations = all.slice(0, 15).map((r: any) => formatCitation(String(r.title ?? ""), String(r.url ?? "")));
currentTask.resolve({ key_facts, citations });
```

`extractKeyFacts` returns `Array<{ fact, source }>`; `formatCitation` returns a
string. Emit those four statements and nothing else.
