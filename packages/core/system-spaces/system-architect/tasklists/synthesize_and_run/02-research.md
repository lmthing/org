---
id: research
output:
  knowledge: array
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

Distill the fetched content into a `knowledge` array matching the KnowledgeSpec shape
(consumed by the build step's writeKnowledgeIndex/writeKnowledgeOption). Each entry is one
domain/field. **Structure each field as: an OVERVIEW (goes in the field's `index.md`) PLUS
2–4 option files, each covering a DIFFERENT ASPECT of the field.** Do NOT put the overview
in an option file and do NOT create a single `overview.md` option — the overview is the
`description`, and the options are distinct aspects (e.g. for "pieces": `movement`, `value`,
`special_moves` — never `overview`). Keep each option short and attributed.

Example output shape:
```typescript
const knowledge = top.length === 0 ? [] : [{
  domain: '<short_domain_slug>',      // e.g. "chess_rules"
  field: '<field_slug>',              // e.g. "pieces"
  type: 'string',
  variable: 'piecesKnowledge',
  default: 'movement',               // a real aspect slug (NOT "overview")
  // `description` is the field OVERVIEW (becomes index.md body). It must SUMMARIZE ALL the
  // options below — a short paragraph that introduces each aspect so the agent knows what
  // each option covers and which to load. The agent always sees this; it loads aspects on demand.
  description: 'Chess pieces are defined by three things: how each one MOVES (movement), how much each is worth (value), and the SPECIAL MOVES some can make (castling, en passant, promotion). Load the matching option for detail.',
  options: [   // 2–4 DISTINCT aspects — NOT an "overview" option
    { slug: 'movement', content: '# Movement\n\n<how each piece moves>\n\nSource: ' + url1 },
    { slug: 'value', content: '# Relative Value\n\n<pawn=1, knight/bishop=3…>\n\nSource: ' + url1 },
    { slug: 'special_moves', content: '# Special Moves\n\n<castling, en passant, promotion>\n\nSource: ' + url2 },
  ],
}];
```

At runtime the synthesized agent sees the overview (index body) in its prompt and loads a
specific aspect with `await loadKnowledge('chess_rules', 'pieces', 'movement.md')` (note the
`.md` suffix, and the slug is a real aspect — never `overview`).

**Build `knowledge` as ONE array literal and resolve in the SAME statement.** Do NOT declare an
empty `const knowledge = []` and then `.push()` to it across later statements — variables do not
persist between evals unless re-bound, and a `.push()` inside an `if`/`for` block is lost when the
turn resumes (you'll hit `'knowledge' is not defined`). Assemble everything inline:

```typescript
const knowledge = top.length === 0 ? [] : [
  { domain: '...', field: '...', type: 'string', variable: '...', default: 'overview',
    description: '...', options: [{ slug: 'overview', content: '...Source: ' + url1 }] },
];
currentTask.resolve({ knowledge, sources: knowledge.length ? allSources.join(', ') : 'none' });
```

Resolve with:
- `knowledge`: the KnowledgeSpec[] array (empty array if no useful results)
- `sources`: comma-separated source URLs, or 'none'
