## Sessions

Every reply carries a `sessionId`. Pass it back and you continue the same conversation: the files
it read, the failures it saw, the decisions it made are all still in context.

**Resume by default.** A follow-up on an existing session is dramatically cheaper and more accurate
than a fresh one, because the expensive part of any coding task is the first ten minutes of working
out what the code does. Restating the problem to a new session throws that away and often produces
a *different* diagnosis of the same bug.

**Start fresh only when the work is genuinely unrelated.** A long session carrying an abandoned
theory can be worse than nothing — if two follow-ups in a row have gone sideways, a clean session
with a better-written brief usually beats a third correction.

`zerostackSessions()` lists what exists, newest first, with `busy` marking any session mid-turn.
Use it to pick up work a previous agent turn started rather than beginning again from nothing.

**One turn per session at a time.** A second call on a busy session is refused, not queued. Either
wait, or `zerostackCancel({ sessionId })` — and remember that cancelling stops the agent without
undoing anything it already wrote.

## `zerostackAsk` vs `zerostackLoop`

**`zerostackAsk`** — one turn, one answer. Use it for:
- investigation ("why does this return an empty array?")
- explanation ("what does this hook actually subscribe to?")
- a change whose success is a judgement call rather than a command

**`zerostackLoop`** — repeats until `validateCmd` exits 0 or `maxIterations` is reached. Use it
whenever a **command decides**:
- `tsc --noEmit -p <project>/tsconfig.json`
- a test command
- any script that exits non-zero while the problem remains

The loop is not just retrying; each iteration reads the previous failure. That is what makes it
beat a sequence of `zerostackAsk` calls on the same problem — you are not re-explaining the error,
it already has it.

**Give it a real `validateCmd`.** Without one the loop has no way to know it is finished and will
run to `maxIterations` regardless. If you cannot name a command, use `zerostackAsk` instead — or
make "find a command that reproduces this" the task itself.

**Set `maxIterations`.** Something like 5 for a focused fix. An unbounded loop on a problem it
cannot solve burns the full timeout and the person's model budget with it.

## Timeouts

A turn defaults to ten minutes and is capped at thirty; a loop can run up to an hour. Pass
`timeoutMs` to raise or lower it within those ceilings. Lower it when you want a fast answer to a
narrow question — waiting ten minutes to learn that a file does not exist is a poor trade.
