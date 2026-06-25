---
id: redelegate
output:
  summary: string
dependsOn: [reregister]
optional: false
goal: true
---

Re-run the updated agent via `delegate()` to verify the improvements took effect.

Use the `spaceKey` and `agentSlug` from the reregister step:
```typescript
const result = await delegate(reregister.spaceKey, reregister.agentSlug, '<actionId>', {
  query: '<original task goal>',
  context: {}
});
```

Display the new result clearly. If the previous result is available in context,
show a before/after comparison of what changed.

Update memory so future iteration sessions can find this space:
```typescript
remember('architect.lastSpaceDir', reregister.spaceKey);
remember('architect.lastAgentSlug', reregister.agentSlug);
```

Resolve with `{ summary: '<one-sentence summary of what improved>' }`.
