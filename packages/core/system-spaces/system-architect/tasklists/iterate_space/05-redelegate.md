---
id: redelegate
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
dependsOn: [reregister, load]
optional: false
goal: true
---

Package the execution parameters so the calling session can re-run the updated agent and
verify the improvements took effect.

**DO NOT call delegate() here — it is not available in fork context.** The session that called
`tasklist()` will delegate using the returned params (the architect's JOB 2 turn 2).

Update memory so future iteration sessions can find this space:
```typescript
remember('architect.lastSpaceDir', reregister.spaceKey);
remember('architect.lastAgentSlug', reregister.agentSlug);
```

Resolve with the params — use `load.actionId` (the agent's action discovered at load) and the
seed `feedback` as the re-run query:
```typescript
currentTask.resolve({
  spaceKey: reregister.spaceKey,
  agentSlug: reregister.agentSlug,
  actionId: load.actionId,
  query: feedback,
});
```
