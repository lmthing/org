---
id: consolidate_scopes
output:
  scopes: array
dependsOn: [inventory]
role: plan
functions: []
prelude: |
  const consolidationGuide = await loadKnowledge('organizing', 'split');
---

Consolidate the inventoried scopes into the MINIMAL set of distinct specialists. `inventory`
(`inventory.scopes`, each `{ topic, goal, research }`) and `consolidationGuide` (the organizing guide —
apply its "Consolidate to the minimal specialist set" rules) are in scope. THINKING step — no writers,
no delegation.

`inventory.scopes` almost always OVER-SPLITS, and every extra specialist is a full research + build
that costs time and can fail — so collapse the list HARD, following the guide:

- **Same subject → one.** Two scopes naming the same real-world subject or place — even with different
  wording, or one tacking on a nearby landmark, or one covering a FACET of the other (fees vs rules vs
  tips vs logistics for the same place) — are ONE specialist. Merge them: keep the clearer topic, union
  their `goal` and `research`.
- **Drop the redundant generic.** A broad/catch-all scope whose material the specific scopes already
  carry adds nothing — drop it, keep the specifics. (Only if the specifics are empty and just the broad
  one has substance, keep the broad one instead.)
- **Justify every split.** For each pair you keep SEPARATE, you must be able to say in one line why the
  user would ask them different questions. If you can't, they are one — merge them.

Return the smallest set that still covers every subject the user would ask about — typically a handful,
never a near-duplicate pair. Preserve each surviving scope's `{ topic, goal, research }` shape. Emit
exactly one statement:

```typescript
currentTask.resolve({
  scopes: [
    { topic: '<distinct subject>', goal: '<what this specialist advises on>', research: '<merged research notes>' },
  ],
});
```
