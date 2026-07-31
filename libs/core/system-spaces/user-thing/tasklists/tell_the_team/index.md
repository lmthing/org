---
input:
  request: string
  substance: string
---

Somebody asked you to tell OTHER people something — people who are not reading the thread you are
standing in. `request` is what they asked, verbatim; `substance` is what actually has to be conveyed,
in plain words, because the workflow cannot see the conversation you are in.

The three steps split one job that keeps going wrong when it is improvised as a single move. Step one
decides WHERE it belongs — read-only, so it cannot post the answer into the channel it was called
from just because that channel is the one under its feet; it must find the place the subject is
actually discussed, or hand back a question. Step two writes the ONE message — also read-only, so
the wording is settled before anything can be said out loud, and it gets the direction of attribution
right: the source is the person who asked, the readers are the audience. Step three is the only node
that can speak: it posts exactly the message step two wrote, into exactly the channel step one chose,
once — and when step one did not settle on a channel it posts NOTHING and returns the question.

The goal output is `{ ok, status, channelId, detail, question }` with `status` ∈ `posted` | `ask` |
`here` | `failed`, so the caller relays a receipt, asks, or says plainly that nothing was sent.
