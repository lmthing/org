---
id: register
output:
  spaceKey: string
  agentSlug: string
dependsOn: [validate]
optional: false
goal: false
condition: "validate.ok == true"
---

Register the validated space into the live runtime so `delegate()` can reach it.

Call:
```typescript
const reg = await registerSpace(dir);
```

If `reg.ok` is false, display the error and resolve with `{ spaceKey: '', agentSlug: '' }`.

On success, resolve with `{ spaceKey: reg.spaceKey, agentSlug: reg.agentSlug }`.

Display the registration result to the user:
```typescript
display(<p>✓ Registered agent <strong>{reg.agentSlug}</strong> at {reg.spaceKey}</p>);
```
