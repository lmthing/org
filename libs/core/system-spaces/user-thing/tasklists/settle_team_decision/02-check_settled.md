---
id: check_settled
condition: frame.verdict == 'theirs'
output:
  alreadySettled: boolean
  priorDecision: string
  checked: string
dependsOn: [frame]
goal: false
role: explore
functions: []
capabilities:
  - team:read
---

Before these people are asked to decide something, find out whether they already did. `request`,
`background` and the `frame` result (including the `question` about to be put to them) are in scope.
You are read-only.

`await teamChannels()`, then read a page of each channel where this subject would have been settled
(`await teamHistory(id, { limit: 50 })`, oldest-first, so the LAST word on it is the one that
stands). A decision that was made and then reversed is `alreadySettled: false` on the old terms —
what stands is the reversal, and that is what belongs in `priorDecision`.

Resolve:

- **`alreadySettled: true`** — the record shows they chose. Put in `priorDecision` what was decided,
  who decided it and roughly when, in one sentence. Re-asking a question these people have closed is
  not caution: it reopens something they finished, and it tells them you were not listening.
- **`alreadySettled: false`** — nothing in what you read settles it. Say in `checked` exactly which
  channels and how many messages, because that is what makes it safe to ask.

Do not resolve `true` on the strength of somebody merely PROPOSING it or agreeing it was a good idea;
a decision is somebody with the standing to make it saying what will happen. Emit ONE statement:

currentTask.resolve({ alreadySettled: <true|false>, priorDecision: "<what was decided, by whom, when — or ''>", checked: "<the channels and message counts you read>" });
