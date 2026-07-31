---
input:
  question: string
---

Answer a question about the shared workspace itself — who owns something, where something got to,
what was decided, whether a thing was done — from the workspace's OWN record rather than from the
conversation in front of you. `question` is what was asked, verbatim.

The conversation you are standing in is the least reliable source there is for this: it holds one
person's view, it may be a thread nobody else was in, and the thing being asked about was very
probably settled somewhere else and possibly changed since. So step one works out WHERE the answer
would be recorded (which channels, which tables) without answering it; step two reads each of those
places in parallel and EXTRACTS what bears on the question; step three reasons over what was actually
read and writes one answer.

Every node is read-only — this workflow cannot change anything and cannot say anything out loud.

The goal output is `{ answer, found, checked }`. `checked` is what was genuinely read, and it is
required precisely so "there is no record of that" can only be said by something that looked.
