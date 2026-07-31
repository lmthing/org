---
id: choose_channel
output:
  status: string
  channelId: string
  channelName: string
  reason: string
  question: string
dependsOn: []
goal: false
role: explore
functions: []
capabilities:
  - team:read
---

Decide WHERE this belongs. You are read-only here: you cannot post, so nothing you write is seen by
anyone — which is the point. The choice is made before anything can be said out loud.

`request` (what they asked for, verbatim) and `substance` (what has to be conveyed) are in scope.

1. `const here = await teamContext();` — the channel and thread you were called FROM.
2. `const channels = await teamChannels();` — every channel the person who asked can see. You cannot
   choose one that is not in this list, and you must not invent an id.
3. **The channel you were called from is the one place the answer is almost never.** Everybody in it
   is already reading this conversation, so saying it again there tells nobody anything. "Let the
   others know" means the others are somewhere else.
4. Work out which channel actually discusses this subject — do not go by name alone. For each
   plausible candidate read a page of its log (`await teamHistory(candidate.id, { limit: 30 })`) and
   look for whether this subject, these people, or this work already live there. A channel where the
   subject has never come up is a worse choice than asking.

Then resolve exactly one status:

- **`"chosen"`** — one channel is clearly where this subject belongs. Set `channelId` and
  `channelName` from the list you read, and put in `reason` the evidence you saw there (what you read
  that makes it the right room), not a guess from its name.
- **`"ask"`** — two or more are equally plausible, or none of them fits. Set `question` to one plain
  sentence naming the candidates by name so the person can pick, and leave `channelId` empty. Asking
  which channel costs one message; announcing something in the wrong room cannot be taken back.
- **`"here"`** — the only place this could go is the channel you were already called from. Then it is
  not a message to send at all: say so in `reason`. Claiming you have told people, in the room where
  they are already reading, is worse than doing nothing — they now believe it is handled.

Never resolve `"chosen"` with the channel from `here` — that is the `"here"` status, and calling it a
post makes a no-op look like an action. Emit ONE statement:

currentTask.resolve({ status: "<chosen|ask|here>", channelId: "<id or ''>", channelName: "<name or ''>", reason: "<why, from what you read>", question: "<the pick-a-channel question or ''>" });
