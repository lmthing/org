---
id: answer
output:
  answer: string
  found: boolean
  checked: string
dependsOn: [plan_lookup, read_source]
goal: true
role: explore
functions: []
capabilities:
  - team:read
---

Write the answer. `question`, `plan_lookup` and `read_source` (one element per place that was read)
are in scope. This is pure reasoning — you write nothing and say nothing out loud.

1. **Answer the CURRENT state.** Where two elements disagree, the more recent record is what stands
   now; say what it changed from and roughly when, rather than presenting the superseded version as
   though it were current. A thing that was open when somebody last mentioned it in conversation may
   have been settled since — that is exactly why the record was read.
2. **Name people the way the directory does** — `await teamMembers()` and use each person's `label`.
   Never a handle you inferred, never the local part of an email.
3. **`found: false` is a legitimate answer, and it has a price: you must say what was looked in.**
   Merge every element's `checked` into `checked` and put it in the prose too — "nothing about it in
   #<channel> (last 50 messages) or <table>". A bare "no decision yet" / "nothing recorded" asserts
   something about the world that only a search can support, and when it is wrong it is worse than no
   answer: the person acts on it.
4. **`answer` is prose the asker can read and act on.** Not a transcript, not a list of messages, not
   rows, not the `read_source` array passed through. At most one decisive line quoted, attributed to
   the person who said it and when. If the answer turns on something that was never written down
   anywhere, say that — that is a finding, not a failure.

Base every clause on what `read_source` actually returned; never fill a gap with what the question
implies the answer probably is. Emit ONE statement:

currentTask.resolve({ answer: "<the answer, in prose>", found: <true|false>, checked: "<every place that was read>" });
