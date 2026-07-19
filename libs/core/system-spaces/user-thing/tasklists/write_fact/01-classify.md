---
id: classify
output:
  target: string
  reason: string
  table: string
  operation: string
  rowId: string
  spaceKey: string
  agent: string
  question: string
dependsOn: []
goal: false
role: explore
functions: []
---

Decide WHERE this fact belongs — and, when it belongs in the DB, WHETHER it is a new record or a
correction to an existing one. `fact` and `kind` are in scope. You have read-only `db` here
(`db.tables()`, `db.query(...)`) — use it to see whether this project already has an app and whether
any table has a natural home for the fact. You CANNOT write here; your only exit is a classification.

**First, check for a genuinely ambiguous VOLUNTEERED intent.** Some stated items are not a plain fact
to file at all — their intended future behaviour is unstated, and only the user's preference settles
it. `await loadKnowledge('recording', 'intent')` and then `await loadKnowledge('recording', 'intent',
'default')`, and read the returned guide: it tells you which volunteered items are genuinely ambiguous
(a passive fact to keep vs. an active reminder that must fire on its own later — with a required slot
like WHEN left unspecified) and which are plain declarative facts to STORE without asking. If — and
ONLY if — the guide's ambiguity signals fire, pick `target: "ask"` and set `question` to a single
plain sentence naming the TWO things you could do (just record it, or set a reminder).

**A "keep this front of mind" / "don't forget" / "don't let this slip" phrasing with the future
behaviour left unstated is the ambiguous case, and that ambiguity BINDS: pick `target: "ask"` EVEN IF
the item also carries a concrete storable value** (a price, a fee, a payment). A riding amount does
NOT downgrade such an item to a plain fact — its home is where the value goes AFTER they answer
remember-vs-remind, not a licence to store it now and skip the ask. Capture the value in `reason`, but
still ask. The "plain declarative fact with a determinable home → store it, do not ask" carve-out
applies ONLY to items with NO keep-in-mind phrasing; never fold a keep-in-mind item into a
loosely-matching table to avoid asking.

Otherwise pick exactly one `target`:

- **`memory`** — a preference or standing instruction about the user, OR a personal fact when
  `db.tables()` is empty (no app exists yet, so the DB cannot hold it). This is the default for
  anything personal before an app exists.
- **`db`** — a personal fact AND an existing table clearly fits it. Set `table` to that table's
  name (from `db.tables()`), then settle `operation`:
  - **`operation: "insert"`** — a **newly-reported** amount or record (something they say they just
    paid, spent, added, or did) that had no prior row. Step two inserts a NEW row; leave `rowId` `""`.
    This is the default for a stated new fact — do NOT fold it into an existing row's field.
  - **`operation: "update"`** — ONLY when they are **correcting** what a SPECIFIC existing row already
    holds ("it was actually X, not Y"). `db.query(table, ...)` to FIND that exact row and set `rowId`
    to its `id`. If you cannot pin a single existing row, it is not an update — use `insert`.
- **`space`** — a fact about the WORLD/a topic the user is volunteering (not their own data). Set
  `spaceKey` and `agent` to the space that owns the topic if one is registered; leave them empty if
  none fits (step two will note it).
- **`ask`** — the ambiguous-intent case above, OR a personal fact that clearly belongs in the app but
  NO existing table fits it. Set `question` to a one-line ask (name the two interpretations, or offer
  to add a place for it). Do NOT invent a table.

Write a one-sentence `reason`. Leave any field you don't use as an empty string (`operation` and
`rowId` are `""` unless `target` is `db`). Emit ONE statement:

currentTask.resolve({ target: "<memory|db|space|ask>", reason: "<why>", table: "<table or ''>", operation: "<insert|update or ''>", rowId: "<row id for update or ''>", spaceKey: "<space or ''>", agent: "<agent or ''>", question: "<ask text or ''>" });
