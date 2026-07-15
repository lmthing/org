---
input:
  fact: string
  kind: string
---

Record a fact the user just STATED into the right one of the three stores — the DB (their own app
data), a space's knowledge (a fact about the world), or user memory (a preference, or any personal
fact before an app exists). `fact` is the thing they said, verbatim; `kind` is a hint
(`personal` | `world` | `preference`). Step one classifies WHERE it belongs; step two writes it
there (or reports that the user must be asked first — e.g. it's personal but there's no table for it
yet). The goal output is `{ ok, target, detail }` so the caller can confirm what changed.
