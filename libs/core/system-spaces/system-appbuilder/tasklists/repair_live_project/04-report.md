---
id: report
output:
  ok: boolean
  fixed: array
  authored: array
  stillBroken: array
  stillMissing: array
dependsOn: [diagnose, fix_broken, author_missing]
goal: true
role: general
functions: []
---

Report HONESTLY — the GOAL task, which ALWAYS runs. `fix_broken` ({ path, ok }[]) and `author_missing`
({ kind, name, ok }[]) are per-item results; neither ran at all when `diagnose` found nothing of that
class (an empty array is the healthy, common case, never a fault by itself).

Resolve `ok` true only when every `fix_broken` entry and every `author_missing` entry landed
(`ok: true`) — a single `false` anywhere means the app still has a residual problem, and that must be
surfaced, never smoothed over. Carry the specific paths/names that did NOT land in `stillBroken`
(from `fix_broken`) and `stillMissing` (from `author_missing`) so the caller can decide whether to
invoke `repair_live_project` again (cheap — it only touches what is still wrong) rather than guessing.
Emit one statement:

```typescript
const fixedResults = Array.isArray(fix_broken) ? fix_broken : [];
const authoredResults = Array.isArray(author_missing) ? author_missing : [];
const fixed = fixedResults.filter((r: { ok: boolean }) => r.ok).map((r: { path: string }) => r.path);
const stillBroken = fixedResults.filter((r: { ok: boolean }) => !r.ok).map((r: { path: string }) => r.path);
const authored = authoredResults.filter((r: { ok: boolean }) => r.ok).map((r: { kind: string; name: string }) => `${r.kind}:${r.name}`);
const stillMissing = authoredResults.filter((r: { ok: boolean }) => !r.ok).map((r: { kind: string; name: string }) => `${r.kind}:${r.name}`);
currentTask.resolve({
  ok: stillBroken.length === 0 && stillMissing.length === 0,
  fixed,
  authored,
  stillBroken,
  stillMissing,
});
```
