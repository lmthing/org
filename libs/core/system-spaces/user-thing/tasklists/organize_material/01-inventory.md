---
id: inventory
output:
  scopes: array
role: explore
functions: []
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
---

Split the supplied material into the real-world SUBJECTS a specialist should advise on. The host has
already read every supplied document into `documents`; `request`, `sourceSummary`, `attachmentIds`,
and `specialistFacts` are also in scope, and the source text is authoritative over the short summary.

**You do not carry the splitting rules yourself — they live in loadable knowledge, so the right
heuristic for THIS kind of material is always available.** Work in two reads, then resolve:

1. **See the menu + the default axis.** `await loadKnowledge('organizing', 'split')` returns the index:
   the universal rule (a specialist is a subject the user would ASK for advice on; a category of their
   own records — costs, dates, payments, photos, contacts, a list/tracker/dashboard/overview — is app
   DATA, a table, never a specialist) and the list of available domain guides on its `Guides:` line.
2. **Load the guide(s) for this material — by the EXACT name printed on that line, never a guessed
   synonym.** From what `documents` actually contain and what `request` asks, pick the name(s) that
   literally appear after `Guides:` in the text you were just given — read the line itself; do not
   infer a plausible-sounding domain word that isn't on it (a word like "inventory", "sales", or
   "studio" is not a guide just because it sounds related to the material). Load each:
   `await loadKnowledge('organizing', 'split', '<exact-name-from-the-line>')` (a mixed pile loads
   several). If nothing on the line fits, load `'default'` directly — one clean read beats a guessed
   name that fails and falls back anyway. Read that guidance — it tells you the axis this domain splits
   on and which of its parts are subjects vs. mere records.

Then split accordingly and emit exactly ONE `currentTask.resolve({ scopes: [...] })`. For each scope
emit `{ topic, goal, research }`, where `research` is a JSON-stringifiable object with `topic`,
`executive_summary`, `findings`, `conclusion`, and empty `sources` (supplied material is not web
research). Ground every finding only in the supplied document text and `specialistFacts`. Combine parts
that serve one continuous purpose; do not split a subject merely because it carries several kinds of
records; each supplied fact belongs to one scope only.