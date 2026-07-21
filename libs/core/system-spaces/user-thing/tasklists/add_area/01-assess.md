---
id: assess
output:
  topic: string
  goal: string
  isNewArea: boolean
  groundingFacts: string
  appRequest: string
dependsOn: []
goal: false
role: explore
functions: []
---

Assess the addition the user is introducing. `request` (their message, verbatim), `registeredSpaces`
(the specialist spaces this project already has), `attachmentIds` and `specialistFacts` are in scope.
You have read-only `db` here (`db.tables()`, `db.query(...)`) — you CANNOT write. Your only exit is
this assessment.

Decide whether this addition is a genuinely NEW AREA that deserves its own specialist space. The same
split test that partitions a bulk dump applies here to ONE addition: `await loadKnowledge('organizing', 'split')`
to read the menu, then `await loadKnowledge('organizing', 'split', '<the closest guide>')` for the
matching domain guide, and apply its SUBJECT-vs-record-type distinction.

A new area is one the project has NO owning specialist for AND that is a distinct kind of thing with
its own standing rules, contacts, or knowledge the user will keep coming back to — not merely another
record in a table an existing area already covers, and not a one-off remark. Compare the topic against
`registeredSpaces` and the existing `db.tables()`: if a registered space already owns this topic, or
the addition is just more data for an area already covered, it is NOT a new area (`isNewArea: false`).
When the addition genuinely opens a new area no existing space owns, `isNewArea: true`.

Set `topic` to a short name for the area, `goal` to a one-line description of what a specialist for it
should be able to answer, and `groundingFacts` to the concrete facts from `request`/`specialistFacts`
that ground the area (identifiers, dates, names, values — verbatim), so a later step can seed the
specialist and the app without re-reading. Set `appRequest` to a one-line, self-contained instruction
for building the app part (the table/page and any reminder the user asked for). Emit ONE statement:

currentTask.resolve({ topic: "<area name>", goal: "<what its specialist answers>", isNewArea: <true|false>, groundingFacts: "<verbatim grounding facts>", appRequest: "<one-line app build instruction>" });
