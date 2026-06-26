---
id: redelegate
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
  ok: boolean
  errors: string
dependsOn: [reregister, load]
optional: false
goal: true
---

Package the execution parameters so the calling session can re-run the updated agent and
verify the improvements took effect. This is the GOAL task — it ALWAYS runs and ALWAYS
resolves a uniform result (success OR a structured failure). It carries no `condition:` so
it can never be skipped (a skipped goal collapses the whole tasklist to a silent `null`).

**DO NOT call delegate() here — it is not available in fork context.** The session that called
`tasklist()` will delegate using the returned params, but only when `ok` is true.

On success, update memory so future iteration sessions can find this space (guard so a failed
re-register doesn't poison memory):
```typescript
const ok = reregister.ok === true && reregister.spaceKey !== '';
ok ? remember('architect.lastSpaceDir', reregister.spaceKey) : undefined;
ok ? remember('architect.lastAgentSlug', reregister.agentSlug) : undefined;
```

Resolve with the params — use `load.actionId` (the agent's action discovered at load) and the
seed `feedback` as the re-run query:
```typescript
currentTask.resolve({
  spaceKey: reregister.spaceKey,
  agentSlug: reregister.agentSlug,
  actionId: load.actionId,
  query: feedback,
  ok,
  errors: ok ? '' : (reregister.error || 'edit or re-registration failed'),
});
```
