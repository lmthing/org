---
id: report
output:
  ok: boolean
  applied: boolean
  question: string
  detail: string
dependsOn: [diagnose, fix]
goal: true
role: explore
functions: []
---

Report the outcome to the caller. `diagnose` is always in scope. The `fix` node ran ONLY when the
diagnosis was high-confidence — a low-confidence diagnosis SKIPS it, so on that path `fix` is not a
variable you have (it is absent from your inputs). Branch on `diagnose.confidence` and emit the ONE
matching `resolve` — do NOT reference `fix` on the low-confidence path, where it does not exist. This
is pure reasoning: resolve only, write nothing.

- **`diagnose.confidence` is `'high'`** — the correction ran and `fix` is in scope. Report it:

  currentTask.resolve({ ok: fix.applied, applied: fix.applied, question: '', detail: fix.detail });

- **`diagnose.confidence` is `'low'`** — nothing was changed; relay the open question so the caller
  ASKS the user before anything is touched:

  currentTask.resolve({ ok: false, applied: false, question: diagnose.question, detail: diagnose.detail });

Emit exactly ONE of those two `currentTask.resolve({...})` statements — the one that matches
`diagnose.confidence`.
