---
id: split
output:
  subquestions: array
dependsOn: []
goal: false
role: explore
functions: []
---

Split `query` into the smallest set of self-contained sub-questions, each answerable by ONE source.
You have read-only `db` (`db.tables()`) to see what user data exists. For each sub-question decide
its owner:

- **A topic/place** → the space that owns it. Set `spaceKey` + `agent` to a registered space when one
  fits (leave both empty to let step three research it or answer generally).
- **The user's own data** (their totals, bookings, what they paid) → set `spaceKey: 'self'` — step
  three answers it from the DB/memory, never from a space.

Each sub-question string must name its subject (the fork that answers it sees only that string). Emit
ONE statement — an array of `{ q, spaceKey, agent }`:

currentTask.resolve({ subquestions: [ { q: "<sub-question>", spaceKey: "<space|self|''>", agent: "<agent or ''>" } ] });
