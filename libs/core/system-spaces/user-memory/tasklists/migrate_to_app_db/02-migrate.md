---
id: migrate
output:
  migrated: number
  migratedKeys: array
dependsOn: [collect]
goal: false
role: general
capabilities:
  - db:read
  - db:write
---

Insert the collected facts into the app's database. `collect.candidates` (an array of `{ key, value }`)
and `query` are in scope. This is the ONLY node with `db:write`. Use `db.tables()` to see the app's
tables and pick the one `query` points at; for each candidate that fits its columns, `db.insert` a
row (first `db.query` to avoid inserting a duplicate that's already there). Shape each value to the
table's columns — skip a candidate that has no sensible home rather than forcing it.

Track which memory keys you actually wrote so the next step can forget exactly those. Emit ONE
statement resolving `{ migrated: <count inserted>, migratedKeys: [<the keys you inserted>] }`.
Never report a migration you did not perform.
