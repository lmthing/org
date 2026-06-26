---
id: build
output:
  spaceDir: string
  agentSlug: string
  actionId: string
  ok: boolean
  errors: string
dependsOn: [understand, research]
optional: false
goal: false
---

Build the specialist agent **one file at a time** using the per-file builder functions,
then validate. There is NO giant spec object — you write each file with a small call and
get immediate feedback (a broken function is rejected by typecheck the moment you write it).

## Step 1 — Decide the space directory (do this first, ONE statement)

```typescript
const base = process.env.LMTHING_PROJECT_SPACES_DIR ?? (process.env.LMTHING_SPACE_DIR ? process.env.LMTHING_SPACE_DIR.replace(/\/[^/]+\/?$/, '') : '/tmp/architect-spaces');
const agentSlug = '<short_lowercase_slug>';   // e.g. "board-game-explainer"
const dir = base + '/' + agentSlug;
```

## Step 2 — Write the files (each call writes exactly ONE file; all are SYNC, no await)

Write in any order; `validateSpace` at the end checks the whole thing. Each builder returns
`{ ok, ... }` — check `.ok` and fix before continuing. Available builders:

- `writeAgentFile(dir, { agentSlug, agentTitle, systemPrompt, knowledge?, functions?, components?, actions, defaultAction?, canDelegateTo? })`
  — the agent's `instruct.md`. List the knowledge refs (`"<domain>/<field>"` field-level, or
  `"<domain>/<field>/<option>"` to preload an option into the prompt), function names, and
  component names you WILL add; declare your `actions` (each `{ id, label, description, tasklist }`).
  `canDelegateTo` is optional (delegation targets like `"space/agent"` or `"agent#action"`).
  **systemPrompt: 2-3 imperative sentences** describing what the agent IS and its domain — NEVER a
  numbered "## Process". If you include knowledge, the systemPrompt must tell the agent to call
  `await loadKnowledge('<domain>', '<field>', '<option>.md')` (note the `.md` suffix).
- `writeTaskFile(dir, tasklist, { id, instruction, output, dependsOn?, goal?, optional?, condition? })`
  — one task file. Mark exactly ONE task per tasklist `goal: true` (its output is the final answer).
  **Every task instruction MUST end with an explicit `currentTask.resolve({...})`** filling the
  fields named in its `output`. One task is enough for most agents.
- `writeKnowledgeIndex(dir, domain, field, { variable, default?, type?, description })` — the field manifest.
- `writeKnowledgeOption(dir, domain, field, slug, content)` — one option `.md` (markdown body, no frontmatter).
- `writeFunctionFile(dir, name, source)` — one space function. Single-export TS, NO imports, host
  primitives only. Returns `{ ok, errors }`; if `ok` is false, read `errors` and rewrite. Only add a
  function if domain logic genuinely can't use readFileRaw/writeFileRaw/execShell/fetch/process.env.
- `writeComponentFile(dir, 'view'|'form', name, source)` — ONLY when the built-in catalog (~30 display
  + ~33 form components: Stack, Table, Callout, Form, Select…) can't express the UI. Usually skip this.

**Thread the researched knowledge in** (guard it — research is optional and may be empty/salvaged):
```typescript
const kn = Array.isArray(research?.knowledge) ? research.knowledge : [];
// then, for each entry, writeKnowledgeIndex(...) + writeKnowledgeOption(...) per option,
// and include the "<domain>/<field>" ref in writeAgentFile's `knowledge` list.
```

## Step 3 — Validate (the gate)

```typescript
const v = validateSpace(dir);
```

`validateSpace` checks every declared function/knowledge/component/tasklist exists and that each
tasklist has exactly one `goal: true` task. If `v.ok` is false, read `v.errors`, fix the offending
file with the matching builder, and re-run `validateSpace`.

## Step 4 — Resolve

```typescript
currentTask.resolve({
  spaceDir: dir,
  agentSlug,
  actionId: '<your first action id>',
  ok: v.ok,
  errors: v.ok ? '' : v.errors.join('; '),
});
```

Do NOT call `delegate()` here — it is not available in fork context. The register + execute steps
that follow handle live registration and running.
