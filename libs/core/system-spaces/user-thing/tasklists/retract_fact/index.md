---
input:
  fact: string
---

The user is RETRACTING something they told us before ("cancel that €50, I never paid it"). Find
exactly what it created and undo exactly that, then report what was removed. `fact` describes what
to undo. Step one locates the target and settles its GRAIN — a whole row, or a piece inside a
bigger record's column (a remark in a notes field must never take its record down with it) — and
refuses to guess: anything but exactly-one-match comes back as a question. Step two hard-deletes a
confirmed row (`db.remove`, no soft/void flag, per the product rule) or clears just the confirmed
field, and proves nothing beyond the target went. The goal output is `{ ok, removed, detail }`.
