---
id: execute
output:
  result: object
dependsOn: [register]
optional: false
goal: false
---

Delegate to the registered agent and collect its result.

Use the `spaceKey` and `agentSlug` from the register step, and the `goal` and `constraints` from the understand step as context.

Call the agent's first action (the one you designed). Pass the original goal as the query:
```typescript
const result = await delegate(register.spaceKey, register.agentSlug, '<actionId>', {
  query: understand.goal,
  context: { constraints: understand.constraints }
}) as Record<string, unknown>;
```

If the delegate rejects (throws), catch the error and resolve with `{ result: { error: errorMessage } }`.

On success, resolve with `{ result }`.
