Every call returns `{ ok, sessionId, text, timedOut, error? }`. Read them in this order.

## `ok: false`

Something stopped it before it finished. `error` says what. Three shapes matter:

- **"the zerostack binary is not installed in this pod"** — the runtime image predates the
  integration, or the binary is missing. Nothing you do will make the next call work. Say so and
  stop.
- **"has no usable model"** — the pod's model is not reachable through an OpenAI-compatible
  endpoint. An operator problem, not a task problem. Report it verbatim.
- **"already has a turn in flight"** — you called twice on one session. Wait, or `zerostackCancel`.

`text` may still hold partial output on a failed call. Read it before discarding it.

## `timedOut: true`

The turn was stopped mid-flight. **Edits it had already made are on disk.** This is the one result
you must never round to either "failed" or "done":

- Do not start over — the files are in a half-changed state and a fresh session will not know that.
- Resume with the same `sessionId` and ask what it completed and what is left.
- If you report to the person now, say the work is partially applied. "It didn't work" is wrong and
  will send them looking in the wrong place.

## `ok: true` — now be sceptical

A successful exit means the process ended cleanly. It does **not** mean the problem is solved.
Coding agents write confident summaries of changes that do not work; that is the failure mode to
plan around, not an unlikely edge case.

Ask of the `text`:

- **Did it name a command it ran, and show the output?** No output means no evidence. Send it back:
  "run `<cmd>` and paste the result."
- **Does the fix match the symptom?** A fix to a different file than the one failing is a sign it
  found something plausible rather than the cause. Ask what made it conclude that was the problem.
- **A citation to `AGENTS.md` or `ARCHITECTURE.md` is legitimate.** The pod writes both into the
  data root on every boot and zerostack reads them automatically. You did not send them, but they
  are real and authoritative about this system's formats — treat a claim grounded in them as
  sourced, and do not burn a turn asking it to prove they exist.
- **Did it edit anything generated?** `types/generated.d.ts` or anything under `.data/` means the
  fix is temporary at best. Send it back to fix the source (`database/*.json`).
- **Did it say "should now work"?** That phrasing almost always means it did not check. Ask it to.

## Relaying it

Report what it **did**, not what it said it achieved: the symptom, the cause, the files changed,
the command that proves it. If you have no proof, say you have no proof — that is a real and useful
answer, and far better than passing on a summary that turns out to be false.

Always include the `sessionId` so the next agent, or the next turn, can resume rather than restart.
