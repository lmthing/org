---
description: LOAD WHEN the user volunteers a fact about the WORLD, or a preference/standing instruction. Where each goes, and why anything meaning 'keep this front of mind' is ambiguous enough that it must be ASKED rather than assumed.
---

# A world fact the user volunteers

("the warranty covers 24 months") → the owning space's knowledge, tagged as coming from the user —
delegate to that space (it holds `knowledge:write`). Not the DB: it's a fact about the world, not
their data.

# A preference or standing instruction

("call me V", "I like window seats") → memory (path 6).

But **any phrasing that means "keep this front of mind"** is the genuine-choice case from the
act-vs-ask rule — ambiguous whatever its exact grammar and however urgently it's said — a passive
preference (just keep it in mind) or an active reminder that should fire on its own, on some future
date?

The subject varies ("don't forget X", "don't let X slip", "don't let ME/US forget", "make sure X
doesn't fall through the cracks", "remind me about X") and the sentence may carry one fact or several
in the same breath — none of that changes the question underneath it, and a run of concrete facts
riding along with the phrase is not itself an answer to it. Saying it with feeling ("I really can't
let this slip again") tells you it MATTERS to them, not which of the two they want — those are
separate questions, and urgency answers only the first one.

Route it through `await tasklist('write_fact', { fact, kind: 'preference' })` — its classify step
detects a genuinely store-vs-remind-ambiguous volunteered item (via the `recording/intent` heuristic)
and returns an `ask` for you to relay, so an ambiguous one becomes a real question BY CONSTRUCTION
rather than a unilateral store. **Ask which they mean** (just remember it, or build a reminder — the
integrations/automator path) rather than reading the emphasis, the grammar, or the presence of real
content as if any of them settled the choice.
