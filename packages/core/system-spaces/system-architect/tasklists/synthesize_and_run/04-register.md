---
id: register
output:
  spaceKey: string
  agentSlug: string
  ok: boolean
  error: string
dependsOn: [build]
optional: false
goal: false
---

Register the validated space into the live runtime so `delegate()` can reach it.

This task ALWAYS runs (no `condition:`) so the goal task downstream is never silently
skipped — when the build failed, short-circuit here and pass the reason through.

**Yield-safety:** `registerSpace` is a yielding call — keep it FLAT at the top level and
guard it with a ternary (NEVER inside `if`/`try`). Skip registration entirely when the
build didn't validate:

```typescript
const reg = build.ok
  ? await registerSpace(build.spaceDir)
  : { ok: false, spaceKey: '', agentSlug: '', error: build.errors };
```

Then resolve with a uniform shape (display the outcome to the user):

```typescript
display(reg.ok
  ? <p>✓ Registered agent <strong>{reg.agentSlug}</strong> at {reg.spaceKey}</p>
  : <p>✗ Not registered — {build.ok ? reg.error : build.errors}</p>);

currentTask.resolve({
  spaceKey: reg.ok ? reg.spaceKey : '',
  agentSlug: reg.ok ? reg.agentSlug : '',
  ok: reg.ok === true,
  error: reg.ok ? '' : (build.ok ? (reg.error || 'registration failed') : build.errors),
});
```
