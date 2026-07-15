---
id: classify
output:
  target: string
  reason: string
  table: string
  spaceKey: string
  agent: string
  question: string
dependsOn: []
goal: false
role: explore
functions: []
---

Decide WHERE this fact belongs. `fact` and `kind` are in scope. You have read-only `db` here
(`db.tables()`, `db.query(...)`) — use it to see whether this project already has an app and whether
any table has a natural home for the fact.

Pick exactly one `target`:

- **`memory`** — a preference or standing instruction about the user, OR a personal fact when
  `db.tables()` is empty (no app exists yet, so the DB cannot hold it). This is the default for
  anything personal before an app exists.
- **`db`** — a personal fact AND an existing table clearly fits it. Set `table` to that table's
  name (from `db.tables()`); step two will insert or update the row.
- **`space`** — a fact about the WORLD/a topic the user is volunteering (not their own data). Set
  `spaceKey` and `agent` to the space that owns the topic if one is registered; leave them empty if
  none fits (step two will note it).
- **`ask`** — a personal fact that clearly belongs in the app but NO existing table fits it. Set
  `question` to a one-line ask offering to add a place for it. Do NOT invent a table.

Write a one-sentence `reason`. Leave any field you don't use as an empty string. Emit ONE statement:

currentTask.resolve({ target: "<memory|db|space|ask>", reason: "<why>", table: "<table or ''>", spaceKey: "<space or ''>", agent: "<agent or ''>", question: "<ask text or ''>" });
