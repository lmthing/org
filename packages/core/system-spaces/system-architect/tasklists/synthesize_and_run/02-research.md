---
id: research
output:
  knowledge: object
  sources: string
dependsOn: [understand]
optional: true
goal: false
---

Gather real domain knowledge from the web so the synthesized agent ships WITH
researched knowledge it can `loadKnowledge()` at runtime.

This step is OPTIONAL and must degrade gracefully — if webSearch returns no
results or TAVILY_API_KEY is not configured, resolve with
`{ knowledge: [], sources: 'none' }` so the pipeline continues without knowledge.

**Yield-safety rules (CRITICAL):**
- `webSearch` and `webFetch` are yielding calls — keep them FLAT at top level.
- NEVER nest a yielding call inside if/else/try/catch/loops — statements after
  a yield in a nested scope do NOT re-run when the turn resumes.
- Guard with ternaries. Run at most 2-3 searches total.

Pattern:
```typescript
// Derive 1-3 focused search queries from understand.domainHints
const q1 = understand.domainHints + ' reference guide best practices';
const r1 = await webSearch(q1);
const top = r1 && r1.results ? r1.results.slice(0, 2) : [];
display(<p>Found {top.length} sources for "{understand.domainHints}"</p>);

const url1 = top[0] ? top[0].url : '';
const page1 = url1 ? await webFetch(url1) : '';

const url2 = top[1] ? top[1].url : '';
const page2 = url2 ? await webFetch(url2) : '';
```

Distill the fetched content into a `knowledge` array matching the KnowledgeSpec
shape (the same shape accepted by scaffoldSpace). Each entry is one domain/field
with 1–N focused option files. Keep options short and attributed.

Example output shape:
```typescript
const knowledge = top.length === 0 ? [] : [{
  domain: '<short_domain_slug>',      // e.g. "chess_rules"
  field: '<field_slug>',              // e.g. "pieces"
  type: 'string',
  variable: 'piecesKnowledge',
  default: 'overview',
  description: 'Movement rules for each chess piece.',
  options: [
    {
      slug: 'overview',
      content: '# Piece Overview\n\n<distilled facts>\n\nSource: ' + url1,
    },
    {
      slug: 'special_moves',
      content: '# Special Moves\n\n<castling, en passant, promotion>\n\nSource: ' + url2,
    },
  ],
}];
```

At runtime the synthesized agent loads it with:
  `await loadKnowledge('chess_rules', 'pieces', 'overview.md')`
Note the `.md` suffix in the option arg.

Resolve with:
- `knowledge`: the KnowledgeSpec[] array (empty array if no useful results)
- `sources`: comma-separated source URLs, or 'none'
