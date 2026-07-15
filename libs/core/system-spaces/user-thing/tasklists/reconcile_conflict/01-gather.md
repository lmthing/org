---
id: gather
output:
  claimValue: string
  claimSource: string
  existingValue: string
  existingSource: string
dependsOn: []
goal: false
role: explore
functions: []
---

Pin down the two values and each one's PROVENANCE. `claim` and `existing` are in scope; you have
read-only `db` to check a stored value if needed. Classify each source as exactly one of:
`user` (the user asserted it), `db` (it's a stored row), `researched` (it came from a web lookup —
a knowledge file whose body begins with `> source: researched`), or `guess` (a model inference with
no cited source).

Note: a knowledge fact carries its provenance as a leading `> source: …` blockquote written by
`writeKnowledge` — `from the user` ⇒ `user`, `researched` ⇒ `researched`.

Emit ONE statement:

currentTask.resolve({ claimValue: "<the asserted value>", claimSource: "<user|db|researched|guess>", existingValue: "<the stored value>", existingSource: "<user|db|researched|guess>" });
