---
input:
  complaint: string
---

The user has flagged a stored figure as wrong or not adding up ("that total looks too high", "the
maths doesn't match my own"). This is a DIAGNOSE-then-FIX job over their OWN data — not a conflict
between two asserted values (that is `reconcile_conflict`). `complaint` is what they said, verbatim.

Step one investigates the actual rows, names the CONCRETE cause and the exact target, and judges one
thing: **am I certain what the corrected value should be, and that they want it changed?** Step two —
reachable ONLY when that answer is yes — applies exactly the diagnosed mutation and RE-READS the
figure to prove it moved. Step three reports what changed, or, when the correct value or their intent
is genuinely ambiguous, relays a single plain question for the caller to ask before anything is
touched. The goal output is `{ ok, applied, question, detail }`.
