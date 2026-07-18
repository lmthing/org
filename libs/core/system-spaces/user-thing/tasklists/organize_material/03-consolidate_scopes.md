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

Consolidate the inventoried scopes into the MINIMAL set of distinct specialists. `inventory` (an array
of `{ topic, goal, research }`, one entry per subject `enumerate` named — each already built its own
scope independently, so a genuinely distinct part never went missing here) and `consolidationGuide`
(the organizing guide — apply its "Consolidate to the minimal specialist set" rules) are in scope.
THINKING step — no writers, no delegation.

`inventory` names subjects one at a time upstream, so it can still carry genuine near-duplicates — the
same real-world subject named twice in different words, or a broad catch-all sitting next to the
specifics it already covers. Collapse those HARD, following the guide (but a distinct subject with few
facts is not a near-duplicate — do not merge it away just because its `research` is short):

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
