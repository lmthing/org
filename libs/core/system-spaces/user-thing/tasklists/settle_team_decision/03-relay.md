---
id: relay
output:
  status: string
  question: string
  options: array
  whoDecides: string
  detail: string
dependsOn: [frame, check_settled]
goal: true
role: explore
functions: []
capabilities: []
---

Merge the branches into one verdict. `frame` is always in scope. **`check_settled` runs only when
`frame.verdict` is `"theirs"`, so branch on `frame.verdict` FIRST and never read `check_settled`
before you know it ran** — when it was skipped it is not there at all.

This node holds nothing: no data, no channels, no way to act or speak. Its only output is what the
caller must do next.

1. `frame.verdict === "mine"` → `{ status: 'proceed', question: '', options: [], whoDecides: '',
   detail: frame.reason }`. The caller carries on and says what it assumed.
2. Otherwise, if `check_settled.alreadySettled` is `true` → `{ status: 'settled', question: '',
   options: [], whoDecides: frame.whoDecides, detail: check_settled.priorDecision }`. The caller tells
   them what already stands and acts on THAT, instead of asking again.
3. Otherwise → `{ status: 'ask', question: frame.question, options: frame.options, whoDecides:
   frame.whoDecides, detail: frame.reason }`.

On the `ask` path, pass `question` and `options` through **unchanged**. Do not soften them, do not
merge two options into one, do not add a recommendation, and do not move the question into `detail` —
`detail` is the reason it is being asked, and the caller has to be able to put `question` to them
word for word. A question that arrives blunted is one the reader answers without seeing what it
costs.

Emit ONE statement:

currentTask.resolve({ status: "<ask|proceed|settled>", question: "<the question or ''>", options: [ /* the options, unchanged */ ], whoDecides: "<label, 'everyone' or ''>", detail: "<why>" });
