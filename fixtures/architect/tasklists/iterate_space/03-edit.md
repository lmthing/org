---
id: rescaffold
output:
  dir: string
  agentSlug: string
  changed: boolean
dependsOn: [diagnose]
optional: false
goal: false
condition: "diagnose.plan != 'no changes'"
---

Apply the approved improvement plan by **mutating the reconstructed spec** and
re-scaffolding idempotently — `scaffoldSpace` overwrites existing files, so the
space stays canonical and consistent with what a fresh synthesis would produce.

**DO NOT use `editFile` or `writeFileRaw` to hand-patch individual files.** Route
every change through the spec so scaffold and iterate always stay in sync.

Steps:

1. Start with `load.currentSpec` as the base.
2. Apply the approved mutations from `diagnose.plan`:
   - Update `systemPrompt`, `agentTitle`, `agentSlug` if instructed.
   - Add, replace, or remove entries in `functions`, `knowledge`, `components`,
     `dependencies`, `actions`, `tasklists`.
   - For knowledge improvements: if the plan calls for fresh web research, run
     `await webSearch(...)` and `await webFetch(...)` (FLAT, ternary-guarded) to
     gather updated content, then build new/updated KnowledgeSpec entries.
3. Re-scaffold with the mutated spec:
   ```typescript
   const res = scaffoldSpace(load.dir, newSpec);
   ```
4. If `res.ok` is false, display `res.error` and resolve with
   `{ dir: load.dir, agentSlug: load.agentSlug, changed: false }`.
5. On success, resolve with
   `{ dir: load.dir, agentSlug: newSpec.agentSlug, changed: true }`.

Yield-safety: any `await webSearch` / `await webFetch` in step 2 must be FLAT
at the top level, guarded with ternaries — never inside if/else/try/loop blocks.
