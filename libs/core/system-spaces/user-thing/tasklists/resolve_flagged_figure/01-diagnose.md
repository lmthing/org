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
summed alongside the very parts it already contains, in the SAME logical item recorded in TWO tables
that both feed the total (a cross-table duplicate), in a value stored in one unit/currency but summed
as another, or under a different word form than the one you searched for. Name the CONCRETE cause and
pin the exact target:

- `cause` — one sentence naming what is wrong (a duplicated row, the same charge counted in two
  tables that both feed the total, a line item double-counted next to the total it belongs to, a
  value summed in the wrong unit/currency, a stale value, an arithmetic slip).
- `table` + `targetIds` — the table and the row id(s), as strings, that the fix touches.
- `fixAction` — `update` (rewrite a field), `remove` (delete a row), or `none` (nothing to change).
- `targetValue` — the corrected value as a string when `fixAction` is `update` (else `''`).

Then judge `confidence`:

- **`high`** — you can name the ONE corrected value and defend it, because EITHER of these holds:
  - **(a) the user stated or confirmed the target value, and exactly one candidate correction
    reproduces it.** When they told you what the figure SHOULD be, that target SELECTS the mechanism:
    if several ways to fix it are conceivable but only one yields their stated number, the choice is
    already made — pick that one. Several candidate mechanisms is NOT ambiguity once a stated target
    picks between them.
  - **(b) the correction is arithmetically or structurally determined** — a provable duplicate (the
    same row or the same charge counted twice), a mis-sum, a line item double-counted next to its
    own total, a value summed in the wrong unit/currency. The rows themselves force one resulting
    value; no preference is involved.

  In both, the user already asked for it to be right, so carrying it out is a mechanism, not a choice.
- **`low`** — GENUINE ambiguity you cannot settle by looking: no stated target AND no arithmetic
  tie-break, so more than one plausible correction survives; the correct value is unknown; or making
  it right would require CHOOSING something only the user's preference decides (not something the data
  or a stated target can tell you). Set `question` to a single plain sentence naming the alternatives
  for the caller to ask. Leave `fixAction: 'none'`.

Never claim `high` for a correction you cannot defend from the rows or a value the user stated — a
guess you are confident about is still `low`. Emit ONE statement:

currentTask.resolve({ cause: "<what's wrong>", table: "<table or ''>", targetIds: [/* ids or empty */], fixAction: "<update|remove|none>", targetValue: "<corrected value or ''>", confidence: "<high|low>", question: "<one-sentence ask, or ''>", detail: "<what you found>" });
