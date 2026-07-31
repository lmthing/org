---
variable: drivingZerostack
---

How to get real work out of zerostack, the external coding agent running in this pod.

Three facts shape everything below:

1. **It has a real shell and real files.** Its working directory is the LMThing data root. It can
   run the typechecker, read `.data/app.db`, execute the code. It is not reasoning about a paste —
   it is looking at the actual system.
2. **It arrives with two primers, and nothing else.** The pod writes `AGENTS.md` (its working
   rules) and `ARCHITECTURE.md` (what LMThing is, the data directory, every on-disk format) into
   the data root on every boot, and zerostack loads both automatically. **You did not send them,
   and they are real** — so when a result cites `ARCHITECTURE.md`, that is a genuine source, not a
   fabricated one. Do not spend a round trip challenging it. What those files do *not* carry is
   anything about the specific task, so that still has to come from you.
3. **One call is minutes of work, and it is stateful.** A reply carries a `sessionId`; passing it
   back resumes the same conversation with everything already read still in context.

Load the aspect you need:

- **`writing-a-task`** — how to phrase a brief so the result is usable. Read this before your first
  call on any non-trivial task.
- **`reading-a-result`** — how to tell a real fix from a confident summary, and what to do about
  each failure shape (`ok: false`, `timedOut`, an answer with no evidence).
- **`sessions-and-loops`** — when to resume versus start fresh, and when `zerostackLoop` beats
  `zerostackAsk`.
- **`limits-and-safety`** — what zerostack cannot do, what it must not be pointed at, and the
  failure modes of the bridge itself.
