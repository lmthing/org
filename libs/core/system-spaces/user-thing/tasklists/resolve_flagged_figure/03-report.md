---
id: report
output:
  ok: boolean
  applied: boolean
  question: string
  decision: object
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

- **`diagnose.confidence` is `'high'`** — the fix node ran and `fix` is in scope. It has one of three
  outcomes, all captured by passing its fields straight through: it APPLIED the change (`fix.applied` is
  true, `fix.question` is empty), it found nothing to change (`fix.applied` false, `fix.question` empty,
  `fix.detail` explains the figure was already correct), or it could not safely apply the change and is
  ASKING (`fix.question` is a non-empty question for the user). Relay `fix.question` verbatim — when it
  is set, the caller must ask the user and, on a yes, re-invoke with the confirmed `decision`:

  currentTask.resolve({ ok: fix.applied, applied: fix.applied, question: fix.question, decision: fix.decision, detail: fix.detail });

- **`diagnose.confidence` is `'low'`** — nothing was changed; relay the open question so the caller
  ASKS the user before anything is touched:

  currentTask.resolve({ ok: false, applied: false, question: diagnose.question, decision: {}, detail: diagnose.detail });

Emit exactly ONE of those two `currentTask.resolve({...})` statements — the one that matches
`diagnose.confidence`.
