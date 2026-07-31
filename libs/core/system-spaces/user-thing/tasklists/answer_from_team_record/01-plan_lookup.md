---
id: plan_lookup
output:
  sources: array
  restated: string
dependsOn: []
goal: false
role: explore
functions: []
capabilities:
  - team:read
  - db:read
---

Work out WHERE the answer is recorded. Do not answer the question here — this node only points at
places. `question` is in scope.

1. `const ctx = await teamContext();` — who is asking and where from. `await teamMembers()` when the
   question is about a PERSON: match the name they used to a directory entry, so later steps look for
   the right `label` and `handle` rather than a spelling that appears nowhere.
2. `await teamChannels()` — every channel the person asking can see. A channel they cannot see does
   not exist for this question, and there is no way to widen that.
3. `db.tables()` — the workspace's own data. When the question is about the state of a thing the app
   tracks, the table is the CURRENT answer and a channel is only how it got there.
4. **The thread you are standing in is not a source.** What somebody said a moment ago may already
   have been superseded, and a question of this shape is usually asked precisely because the asker
   was not in the room where it was settled.

Emit `sources` — at most FOUR, most likely first, each an object:

- `{ kind: 'channel', id: '<channel id>', name: '<channel name>', why: '<what makes this the room>' }`
- `{ kind: 'table', id: '<real table name from db.tables()>', name: '<same>', why: '<what it holds>' }`

Only ids you actually saw in `teamChannels()` / `db.tables()` — a guessed name typechecks and then
silently returns nothing, which is indistinguishable from a genuine absence.

`restated` is the question as ONE self-contained sentence naming its subject, because each reading
step sees only that string and never the original conversation. Emit ONE statement:

currentTask.resolve({ sources: [ /* { kind, id, name, why } */ ], restated: "<the question, self-contained>" });
