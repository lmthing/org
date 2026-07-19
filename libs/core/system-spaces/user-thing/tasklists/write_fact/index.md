---
input:
  fact: string
  kind: string
---

Record a fact the user just STATED into the right one of the three stores — the DB (their own app
data), a space's knowledge (a fact about the world), or user memory (a preference, or any personal
fact before an app exists). `fact` is the thing they said, verbatim; `kind` is a hint
(`personal` | `world` | `preference`). Step one classifies WHERE it belongs and, for a DB fact,
WHETHER it is a new record (`insert`) or a correction to an existing one (`update`) — and it
flags a genuinely ambiguous volunteered intent (a passive fact to keep vs. an active reminder that
must fire on its own later) as an `ask` instead of storing it unilaterally. Step two LOCATES the
one row a correction refers to — by the identifying attributes the user actually referenced — and
refuses to guess: anything but exactly-one-match comes back as a question, never a write to the
nearest-looking row. Step three writes where classify decided (and, for an update, ONLY the row
locate confirmed) and RE-READS to prove the row landed (or reports that the user must be asked
first — e.g. it's personal but there's no table for it yet). The goal output is `{ ok, target,
detail }` so the caller can confirm what changed — or relay the question via `ask()`.
