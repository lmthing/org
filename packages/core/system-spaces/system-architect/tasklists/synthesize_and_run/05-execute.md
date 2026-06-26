---
id: execute
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
dependsOn: [register, build]
optional: false
goal: true
condition: "register.spaceKey != ''"
---

Package the execution parameters so the calling session can delegate.

**DO NOT call delegate() here — it is not available in fork context.** The session that called `tasklist()` will delegate using the returned params.

Resolve immediately with:
```typescript
currentTask.resolve({
  spaceKey: register.spaceKey,
  agentSlug: register.agentSlug,
  actionId: build.actionId,
  query: goal,
});
```
