---
id: execute
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
  ok: boolean
  errors: string
dependsOn: [register, build]
optional: false
goal: true
---

Package the execution parameters so the calling session can delegate. This is the GOAL
task — it ALWAYS runs and ALWAYS resolves a uniform result (success OR a structured
failure). It must NEVER be skipped, so it carries no `condition:` — a skipped goal would
collapse the whole tasklist to a silent `null` for the caller.

**DO NOT call delegate() here — it is not available in fork context.** The session that
called `tasklist()` will delegate using the returned params, but only when `ok` is true.

Resolve immediately with a discriminated result. On success, hand back the live keys; on
failure, hand back the reason (from build/register) so the caller can show it instead of
delegating to a space that doesn't exist:

```typescript
const ok = register.ok === true && register.spaceKey !== '';
currentTask.resolve({
  spaceKey: register.spaceKey,
  agentSlug: register.agentSlug,
  actionId: build.actionId,
  query: goal,
  ok,
  errors: ok ? '' : (build.ok ? (register.error || 'registration failed') : build.errors),
});
```
