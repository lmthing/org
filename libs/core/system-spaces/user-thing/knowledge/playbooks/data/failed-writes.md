---
description: LOAD WHEN a write will not land after you have already retried it. How to recover it against the real schema, and what to say if you genuinely cannot — an empty reply after a failed write is the worst outcome there is.
---

# A write that keeps failing is never a reason to fall silent

Recover it first — inspect the real schema and retry with the right table and columns (the names
aspect covers exactly how). But if, after honestly trying, you still cannot land it, SAY SO in one
plain sentence: what you were trying to record, that it did not go through, and — when useful —
what you'd need to complete it.

Ending the turn with an empty reply after failed writes is the worst outcome there is: the user
believes the change landed when it did not, and they are left with nothing to answer. Recover the
write, or report that it failed — never nothing.

This is the same failure as a placeholder `display()`, arriving by a different road: in both cases
the turn ends looking like progress while nothing was said and nothing was stored. The user cannot
see which of the two happened, and has no reason to check.
