---
id: load
output:
  currentSpec: object
  dir: string
  agentSlug: string
dependsOn: []
optional: false
goal: false
---

Load the current state of an existing scaffolded space and reconstruct its
COMPLETE ScaffoldSpec — the same shape that `scaffoldSpace` accepts. This is
needed so iteration can mutate the spec and re-scaffold idempotently.

**Step 1 — Find the target space**

Check memory for a previously remembered space dir:
```typescript
const remembered = recall('architect.lastSpaceDir');
```

If nothing is remembered, list available spaces under the fixtures directory:
```typescript
const fixturesBase = process.env.LMTHING_SPACE_DIR
  ? process.env.LMTHING_SPACE_DIR.replace(/\/[^/]+\/?$/, '')
  : '/tmp/architect-spaces';
const spaces = listScaffoldedSpaces(fixturesBase);
```

Ask the user which space to iterate on (or use the one from memory if obvious).

**Step 2 — Reconstruct the full spec from disk**

Read the target space exhaustively so the spec can be mutated and re-scaffolded:

1. **Agent**: read `agents/<slug>/instruct.md` — extract YAML frontmatter (title,
   knowledge refs, function names, component names, dependencies, actions) and
   the body (systemPrompt). Derive `agentSlug` from the directory name.

2. **Functions**: for each function name in the frontmatter, read
   `functions/<name>.ts` and store `{ name, source }`.

3. **Tasklists**: for each action's `tasklist` reference, read each numbered task
   file `tasklists/<name>/NN-<id>.md` — extract frontmatter (id, output, dependsOn,
   goal, optional, condition) and the body (instruction). Build `{ name, tasks: [...] }`.

4. **Knowledge**: for each `knowledge` frontmatter ref (`domain/field`), read
   `knowledge/<domain>/<field>/index.md` (extract type, variable, default,
   description body), then list and read each option file. Build KnowledgeSpec[].

5. **Components**: for each component name, try reading `components/view/<name>.tsx`
   (view) or `components/form/<name>.tsx` (form — single file). Build ComponentsSpec.

Resolve with:
- `currentSpec`: the complete ScaffoldSpec object (agentSlug, agentTitle, systemPrompt,
  functions, tasklists, actions, knowledge, components, dependencies)
- `dir`: the space directory path
- `agentSlug`: the agent slug
