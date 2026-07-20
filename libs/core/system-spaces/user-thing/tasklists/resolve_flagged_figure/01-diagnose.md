---
id: diagnose
output:
  cause: string
  table: string
  targetIds: array
  fixAction: string
  targetValue: string
  figureSpec: object
  assertedTarget: string
  duplicateOf: array
  confidence: string
  question: string
  detail: string
dependsOn: []
goal: false
role: explore
functions: []
---

Investigate the flagged figure and settle TWO things: what is wrong, and whether you are CERTAIN what
the corrected value should be. `complaint` is in scope, and you have read-only `db`
(`db.tables()`, `db.query`) — you can inspect the data but you CANNOT write here, so your only exit is a
diagnosis. The fix node that runs after you VERIFIES your diagnosis in code before it writes, so it needs
you to hand down not just the target but HOW the figure is computed and WHAT it should become.

**If `decision` is already in scope** — the caller previously proposed a fix, asked the user, and is
re-invoking with the confirmed action (`decision = { table, targetIds, fixAction, targetValue,
figureSpec, assertedTarget }`, `approved: true`) — do NOT re-investigate anything. The choice is already
made and confirmed. Echo it straight through: resolve with `confidence: 'high'`, copy `decision`'s
`table`/`targetIds`/`fixAction`/`targetValue`/`figureSpec`/`assertedTarget`, `cause: 'user-confirmed'`,
`duplicateOf: []`, `question: ''`. Re-diagnosing a confirmed decision from the raw complaint is exactly
the destructive re-litigation this contract exists to prevent.

Otherwise, read the rows that feed the flagged figure. Do not stop at one query: a cause often hides in a
child/line-item row (`db.query('<table>', { include: ['<relation>'] })`), in a roll-up summed alongside
the very parts it already contains, in the SAME logical item recorded in TWO tables that both feed the
total (a cross-table duplicate), in a value stored in one unit/currency but summed as another, or under a
different word form than the one you searched for. Name the CONCRETE cause and pin the exact target:

- `cause` — one sentence naming what is wrong (a duplicated row, the same charge counted in two tables
  that both feed the total, a line item double-counted next to the total it belongs to, a value summed
  in the wrong unit/currency, a stale value, an arithmetic slip).
- `table` + `targetIds` — the table and the row id(s), as strings, the fix touches.
- `fixAction` — `update` (rewrite a field), `remove` (delete a row), or `none` (nothing to change).
- `targetValue` — the corrected value as a string when `fixAction` is `update` (else `''`).

Then hand the fix node the machine-checkable EVIDENCE for your diagnosis — this is what lets it verify in
code instead of trusting prose. Describe the figure GENERICALLY from the rows; never a domain constant:

- `figureSpec` — HOW the flagged figure is computed as a single-table aggregate:
  `{ op, column, filter }` where `op` is one of `sum` / `count` / `avg` / `min` / `max`, `column` is the
  aggregated column, and `filter` is the query filter that selects the rows it spans (`{}` for all). Read
  these OFF the data you inspected — e.g. a displayed total that sums a `costs` amount column over one
  currency is `{ op: 'sum', column: '<the amount column>', filter: { <currency col>: '<value>' } }`. If
  the figure is NOT a single-table aggregate (a cross-table roll-up, or a value an app endpoint derives
  in a way you cannot reduce to `{op,column,filter}`), emit `figureSpec: {}` — the fix node will then
  refuse to auto-delete and ask the user first, which is the safe outcome.
- `assertedTarget` — the value the user stated the figure SHOULD be, as a string, when they gave one
  (“should be around 3344” → `'3344'`); else `''`.
- `duplicateOf` — ONLY for a `remove` justified as a structural duplicate: the peer row id (as a string)
  that each `targetIds` entry duplicates, in the SAME order as `targetIds` (so the fix node can confirm
  the peer really exists and matches on the figure column before deleting). Else `[]`.

**Two things the fix node enforces in code, so diagnose accordingly:**

1. **A `remove` is auto-applied ONLY when you prove it is a DUPLICATE via `duplicateOf`.** A deletion
   justified merely as "the total is too high and dropping this row makes it match" is NOT auto-applied —
   a legitimate row can reach the target by coincidence — so it is confirmed with the user first. So for
   a genuine double-count, NAME the redundant peer in `duplicateOf` and it lands in one step; and never
   reach for `remove` just to force a total to a number.
2. **Ground the figure in its ACTUAL current value — do not invent a basis that makes the complaint
   true.** Read how the app really computes the flagged figure (its own total/endpoint, the currency or
   filter it actually applies) and let `figureSpec` reproduce THAT. Do not hypothesise a broader basis
   (e.g. summing across currencies that the app tracks separately) just because it makes the user's
   complaint come out right. If the figure as genuinely computed ALREADY equals the user's target, the
   honest diagnosis is `fixAction: 'none'` — a user can be mistaken that a correct total is wrong, and
   confirming "it's already right" is a valid, non-destructive outcome.

Then judge `confidence`:

- **`high`** — you can name the ONE corrected value and defend it, because EITHER of these holds:
  - **(a) the user stated or confirmed the target value, and exactly one candidate correction reproduces
    it.** When they told you what the figure SHOULD be, that target SELECTS the mechanism. Several
    candidate mechanisms is NOT ambiguity once a stated target picks between them.
  - **(b) the correction is arithmetically or structurally determined** — a provable duplicate (the same
    row or the same charge counted twice), a mis-sum, a line item double-counted next to its own total, a
    value summed in the wrong unit/currency. The rows themselves force one resulting value.

  In both, the user already asked for it to be right, so carrying it out is a mechanism, not a choice.
- **`low`** — GENUINE ambiguity you cannot settle by looking: no stated target AND no arithmetic
  tie-break, so more than one plausible correction survives; the correct value is unknown; or making it
  right would require CHOOSING something only the user's preference decides. Set `question` to a single
  plain sentence naming the alternatives for the caller to ask. Leave `fixAction: 'none'`.

Never claim `high` for a correction you cannot defend from the rows or a value the user stated — a guess
you are confident about is still `low`. Even on `high`, the fix node re-checks your `figureSpec` in code
and will fall back to asking the user if it cannot verify your target reproduces — so give it an honest
`figureSpec`. Emit ONE statement:

currentTask.resolve({ cause: "<what's wrong>", table: "<table or ''>", targetIds: [/* ids or empty */], fixAction: "<update|remove|none>", targetValue: "<corrected value or ''>", figureSpec: { /* {op,column,filter} or {} */ }, assertedTarget: "<stated target or ''>", duplicateOf: [/* peer ids or empty */], confidence: "<high|low>", question: "<one-sentence ask, or ''>", detail: "<what you found>" });
