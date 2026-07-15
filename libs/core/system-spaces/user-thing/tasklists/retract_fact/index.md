---
input:
  fact: string
---

The user is RETRACTING something they told us before ("cancel that €50, I never paid it"). Find the
row it created and HARD-delete it, then report what was removed. `fact` describes what to undo. Step
one locates the row; step two removes it with `db.remove` (a hard delete — no soft/void flag, per the
product rule). The goal output is `{ ok, removed, detail }`.
