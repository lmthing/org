---
input:
  query: string
---

Move the user's personal facts out of memory and into a project app's database, now that an app
exists to hold them. THING delegates this right after building the app's tables; `query` describes
the new table(s) and what belongs in them. Step one collects the candidate facts from memory; step
two inserts the ones that fit into the DB; step three forgets the migrated keys, so each fact now
lives in the app the user will actually open — not stranded in memory where later facts became rows.
The goal output is `{ ok, migrated, forgotten }`.
