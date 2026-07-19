---
id: diagnose
output:
  cause: string
  table: string
  targetIds: array
  fixAction: string
  targetValue: string
  confidence: string
  question: string
  detail: string
dependsOn: []
goal: false
role: explore
functions: []
---

Investigate the flagged figure and settle TWO things: what is wrong, and whether you are CERTAIN what
the corrected value should be. `complaint` is in scope, and you have read-only `db` (`db.tables()`,
`db.query`) — you can inspect the data but you CANNOT write here, so your only exit is a diagnosis.

Read the rows that feed the flagged figure. Do not stop at one query: a cause often hides in a
child/line-item row (`db.query('<table>', { include: ['<relation>'] })`), in a roll-up that is being
summed alongside the very parts it already contains, or under a different word form than the one you
searched for. Name the CONCRETE cause and pin the exact target:

- `cause` — one sentence naming what is wrong (a duplicated row, a line item double-counted next to
  the total it belongs to, a stale value, an arithmetic slip).
- `table` + `targetIds` — the table and the row id(s), as strings, that the fix touches.
- `fixAction` — `update` (rewrite a field), `remove` (delete a row), or `none` (nothing to change).
- `targetValue` — the corrected value as a string when `fixAction` is `update` (else `''`).

Then judge `confidence`:

- **`high`** — the figure is provably wrong by inspection (a duplication, an arithmetic error, a
  value the rows themselves contradict) AND exactly one correction makes it right: one cause, one set
  of rows, one resulting value. You can state what the value SHOULD be and defend it from the rows,
  and the user already asked for it to be right — carrying it out is a mechanism, not a choice.
- **`low`** — you cannot settle it by looking alone: more than one row could be the culprit, more
  than one plausible correction exists, or making it right would require CHOOSING something only the
  user's preference decides (not something the data can tell you). Set `question` to a single plain
  sentence naming the alternatives for the caller to ask. Leave `fixAction: 'none'`.

Never claim `high` for a correction you cannot defend from the rows — a guess you are confident about
is still `low`. Emit ONE statement:

currentTask.resolve({ cause: "<what's wrong>", table: "<table or ''>", targetIds: [/* ids or empty */], fixAction: "<update|remove|none>", targetValue: "<corrected value or ''>", confidence: "<high|low>", question: "<one-sentence ask, or ''>", detail: "<what you found>" });
