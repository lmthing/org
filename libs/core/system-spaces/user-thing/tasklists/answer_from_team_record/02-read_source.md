---
id: read_source
output:
  kind: string
  id: string
  found: boolean
  findings: string
  checked: string
dependsOn: [plan_lookup]
forEach: plan_lookup.sources
goal: false
role: explore
functions: []
capabilities:
  - team:read
  - db:read
---

Read ONE place and report what it says about the question. `item` (`{ kind, id, name, why }`),
`index` and `plan_lookup.restated` are in scope. You are read-only.

- **`item.kind === 'channel'`** → `const h = await teamHistory(item.id, { limit: 50 });` The messages
  come back oldest-first, so the LAST thing said on a subject is the one that stands. Page back once
  with `{ before: '<the oldest id you have>' }` only when the trail plainly continues past the
  beginning of what you read. Set `checked` from what the call told you:
  `'#' + h.channelName + ', last ' + h.returned + ' messages'`.
- **`item.kind === 'table'`** → `db.query(item.id, ...)` — query broadly and read the rows, rather
  than guessing a filter that proves nothing when it comes back empty. Set `checked` to the table
  name and how many rows you looked at.

Then EXTRACT. `findings` is what bears on `plan_lookup.restated` and nothing else: who said or did
it, when, and what was settled — plus, when the record shows the answer CHANGED, both the earlier and
the later state so the next step can say which stands now. One decisive line quoted with its author
and day is worth having; a replay of the conversation is not an answer and must never be passed on as
one. Nothing that bears on the question means `found: false` — and then `checked` still says exactly
what you read, because "I looked in these two places and it is not there" is a real answer and "there
is no record" on its own is not.

Emit ONE statement:

currentTask.resolve({ kind: item.kind, id: item.id, found: <true|false>, findings: "<what it says about the question, or ''>", checked: "<what you actually read>" });
