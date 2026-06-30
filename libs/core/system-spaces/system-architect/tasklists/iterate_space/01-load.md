---
id: load
output:
  dir: string
  agentSlug: string
  actionId: string
  summary: string
dependsOn: []
optional: false
goal: false
role: explore
---

Locate the existing scaffolded space to iterate on and read enough of it to summarize
its current state. You do NOT need to reconstruct a full spec — iteration re-writes only
the affected files with the per-file builders.

**Step 1 — Find the target space**

The seed provides `spaceKey` (a dir or key). If it's empty, check memory, then list spaces:
```typescript
const remembered = recall('architect.lastSpaceDir');
// listScaffoldedSpaces() resolves the project spaces dir itself — you never compute a
// path or touch process.env. Each result has { name (slug), dir (absolute), agents }.
const spaces = listScaffoldedSpaces();
```
Resolve the target dir from `spaceKey` (verbatim if set), else `remembered`, else ask the user
which of `spaces` to iterate on.

**Step 2 — Read the agent header**

Read `agents/<slug>/instruct.md` (use `listDir`/`readFileRaw` to find the agent slug from the
`agents/` dir). Extract the agent slug, its first action id (the `- id:` under `actions:`), and a
one-line summary of the current systemPrompt + actions for the diagnose step.

Resolve with:
- `dir`: the space directory path
- `agentSlug`: the agent slug (from the `agents/<slug>` dir name)
- `actionId`: the first action's id (used later to re-run the agent)
- `summary`: a short human-readable description of the current agent
