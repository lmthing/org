---
id: post
output:
  ok: boolean
  status: string
  channelId: string
  detail: string
  question: string
dependsOn: [choose_channel, compose]
goal: true
role: general
functions: []
capabilities:
  - team:read
  - team:post
---

Say it. **This is the only node in this workflow that can speak**, and it chooses neither the words
nor the room: it sends exactly `compose.text` into exactly `choose_channel.channelId`, once. The
`choose_channel` and `compose` results are in scope.

Branch on `choose_channel.status` — do exactly one branch, and post at most one message in total:

- **`"chosen"`** → `const r = await teamPost(choose_channel.channelId, compose.text);` Then resolve
  from what `r` actually returned: `{ ok: r.ok, status: r.ok ? 'posted' : 'failed', channelId:
  choose_channel.channelId, detail: '<one line: which channel, and the gist>', question: '' }`. A
  post that came back `ok: false` was NOT delivered — say what came back, and never report a message
  that was refused as if it had been sent.
- **`"ask"`** → post NOTHING. Resolve `{ ok: false, status: 'ask', channelId: '', detail:
  choose_channel.reason, question: choose_channel.question }` so the caller can ask which channel.
- **`"here"`** → post NOTHING. Resolve `{ ok: false, status: 'here', channelId: '', detail:
  choose_channel.reason, question: '' }` — the people meant are already reading, so there is nothing
  to send and the caller should say so plainly rather than claim a delivery.

Do not re-word the message, do not add a preface to it, do not send it to a second channel "to be
safe", and do not follow it with anything. If the send fails, that is a fact to report, not a reason
to try a different channel — a message that lands somewhere nobody expected is worse than one that
did not land. Emit ONE `currentTask.resolve({...})` statement at the end.
