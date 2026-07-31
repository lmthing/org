---
variable: drivingZerostack
---

How to get real work out of zerostack, the external coding agent running in this pod.

Three facts shape everything below:

1. **It has a real shell and real files.** Its working directory is the LMThing data root. It can
   run the typechecker, read `.data/app.db`, execute the code. It is not reasoning about a paste —
   it is looking at the actual system.
2. **It has never seen this codebase.** It is a strong general engineer with no LMThing knowledge
   beyond a short primer the pod writes into `AGENTS.md`. Everything specific — where a thing
   lives, what "fixed" means here, which failure modes are common — has to come from you.
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
