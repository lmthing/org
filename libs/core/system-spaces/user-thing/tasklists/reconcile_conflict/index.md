---
input:
  claim: string
  existing: object
---

Two sources disagree about the same fact and we must decide which stands. `claim` is the new/asserted
value (with, ideally, where it came from); `existing` describes what is already stored and where.
Step one gathers the competing values and each one's PROVENANCE; step two applies the precedence
**user-asserted > DB > researched > guess** — and when two EQUALLY authoritative sources collide, it
does not pick silently, it returns a decision to ask the user. The goal output is `{ decision, winner,
detail }` where `decision` ∈ `keep` | `replace` | `ask`.
