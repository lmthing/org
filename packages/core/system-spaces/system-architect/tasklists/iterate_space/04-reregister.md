---
id: reregister
output:
  spaceKey: string
  agentSlug: string
dependsOn: [edit]
optional: false
goal: false
condition: "edit.ok == true"
---

Re-register the edited space into the live runtime.

`registerSpace(dir)` calls `loadSpace(dir)` fresh every time and OVERWRITES the
prior registration — functions, components, and knowledge are all reloaded
immediately. **No session restart is required.**

```typescript
const reg = await registerSpace(edit.dir);
```

If `reg.ok` is false, display the error and resolve with
`{ spaceKey: '', agentSlug: '' }`.

On success, resolve with `{ spaceKey: reg.spaceKey, agentSlug: reg.agentSlug }` and display:
```typescript
display(<p>✓ Re-registered <strong>{reg.agentSlug}</strong> — all changes live.</p>);
```
