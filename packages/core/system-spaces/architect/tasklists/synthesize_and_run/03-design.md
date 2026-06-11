---
id: design
output:
  spec: object
dependsOn: [understand, research]
optional: false
goal: false
---

Design the specialist agent spec based on the understood goal, constraints,
domain hints, AND the researched knowledge from the research step.

The spec must match the `scaffoldSpace` signature:
```
{
  agentSlug: string,             // short lowercase slug, e.g. "board-game-explainer"
  agentTitle: string,            // human-readable title
  systemPrompt: string,          // 2-4 concise imperative sentences
  functions?: [{ name, source }],  // only for logic system tools can't do
  knowledge?: [{                 // from research.knowledge — thread it in directly
    domain, field, type?, variable, default?, description,
    options: [{ slug, content }]
  }],
  components?: {                 // only if a custom view or form is needed
    view?: [{ name, source }],   // components/view/<name>.tsx — read-only display
    form?: [{ name, web, ink }], // web.tsx + ink.tsx — no node_modules needed
  },
  dependencies?: ["space/agent"], // other spaces this agent delegates to
  actions: [{ id, label, description, tasklist }],
  tasklists: [{
    name: string,
    tasks: [{ id, instruction, output: {field: type}, dependsOn?, goal?, optional?, condition? }]
  }]
}
```

**Threading knowledge:**
- Set `spec.knowledge = research.knowledge` (the distilled KnowledgeSpec[]).
- For every knowledge field included, the synthesized agent's systemPrompt MUST
  instruct it to call `await loadKnowledge('<domain>', '<field>', '<option>.md')`
  — note the `.md` suffix on the option arg.
- Make this explicit in the systemPrompt so the agent knows to load and use it.

**Components:** only when the agent must render a custom display or collect
structured user input via a form. View components are pure read-only TSX with
no imports except built-in React/Ink types. Form components have a web.tsx
(React) and ink.tsx (Ink CLI) pair. Do NOT generate package.json — components
transpile at render without node_modules.

**Design principles:**
- **systemPrompt: 2-3 imperative sentences only** — describe what the agent IS
  and what domain it works in. NEVER add `## Process`, numbered steps, or
  "1. Call loadKnowledge..." instructions. Those belong in task instructions,
  not the system prompt. The runtime preamble already tells agents to use
  `tasklist()` — a process-heavy systemPrompt overrides that and causes loops.
  ✗ Wrong: "You are X. ## Your Process: 1. Load knowledge. 2. If found..."
  ✓ Right: "You are a board game rules expert. Explain any game's rules in a
  structured format using pre-researched knowledge where available."
- One tasklist action is sufficient for most synthesized agents.
- Exactly one task must have `goal: true`.
- **Every task instruction must end with an explicit `currentTask.resolve({...})`
  call** containing the fields declared in the task's `output:` frontmatter.
  The model will loop forever if it doesn't resolve. Example:
  ```
  Load the rules with loadKnowledge('domain','field','<option>.md').
  Resolve: currentTask.resolve({ rules: loadedContent, found: true })
  ```
- Custom functions only if domain logic genuinely can't use readFileRaw,
  writeFileRaw, execShell, fetch, webSearch, process.env. Functions must be
  single-export TS with NO import statements — there is no pre-register syntax
  check; a broken function only fails when invoked. Keep them tiny and pure.

**This is a pure synthesis step — do NOT call webSearch, webFetch, listDir,
readFile, execShell, or any other I/O tools here.** The research task has already
gathered all external knowledge. Use the upstream outputs directly:
- `understand.goal`, `understand.constraints`, `understand.domainHints`
- `research.knowledge` → set `spec.knowledge = research.knowledge`

Build the complete spec object, then resolve:
```typescript
const spec = {
  agentSlug: '...',
  // ... all fields
  knowledge: research.knowledge,
};
currentTask.resolve({ spec });
```
