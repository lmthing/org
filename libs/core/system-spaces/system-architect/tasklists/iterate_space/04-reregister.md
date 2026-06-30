---
id: reregister
output:
  spaceKey: string
  agentSlug: string
  ok: boolean
  error: string
dependsOn: [edit]
optional: false
goal: false
---

Re-register the edited space into the live runtime.

`registerSpace(dir)` calls `loadSpace(dir)` fresh every time and OVERWRITES the
prior registration — functions, components, and knowledge are all reloaded
immediately. **No session restart is required.**

This task ALWAYS runs (no `condition:`) so the goal task downstream is never silently
skipped — when the edit didn't validate, short-circuit here and pass the reason through.

**Yield-safety:** keep `registerSpace` FLAT at top level, ternary-guarded:

```typescript
const reg = edit.ok
  ? await registerSpace(edit.dir)
  : { ok: false, spaceKey: '', agentSlug: '', error: edit.errors };

display(reg.ok
  ? <p>✓ Re-registered <strong>{reg.agentSlug}</strong> — all changes live.</p>
  : <p>✗ Not re-registered — {edit.ok ? reg.error : edit.errors}</p>);

currentTask.resolve({
  spaceKey: reg.ok ? reg.spaceKey : '',
  agentSlug: reg.ok ? reg.agentSlug : '',
  ok: reg.ok === true,
  error: reg.ok ? '' : (edit.ok ? (reg.error || 'registration failed') : edit.errors),
});
```
