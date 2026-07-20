---
input:
  complaint: string
  decision: object?
---

The user has flagged a stored figure as wrong or not adding up ("that total looks too high", "the
maths doesn't match my own"). This is a DIAGNOSE-then-FIX job over their OWN data — not a conflict
between two asserted values (that is `reconcile_conflict`). `complaint` is what they said, verbatim.

Step one investigates the actual rows, names the CONCRETE cause and the exact target, and hands the fix
node the machine-checkable evidence for its diagnosis (how the figure is computed, the asserted target).
Step two is a CODE node — the host runs it, so its safety check cannot be skipped. It applies the
diagnosed mutation ONLY when it can verify in code that the change is correct and unambiguous; when the
change would not move the figure it reports "already correct" and deletes nothing; and when it cannot
verify the change (or more than one row could be the cause) it writes nothing and returns a `question`.
Step three reports what changed, or relays that question for the caller to ask.

**Confirming a proposed change.** When step two returns a `question`, the caller relays it and — on the
user's yes — RE-INVOKES this tasklist with the confirmed action as `decision`
(`{ table, targetIds, fixAction, targetValue, approved: true }`), NOT a fresh free-text complaint. On
that pass the diagnosis is echoed through unchanged and the fix is applied — the confirmation is the
authority, and re-diagnosing a settled decision from prose is exactly the destructive mistake this
avoids. The goal output is `{ ok, applied, question, detail }`.
