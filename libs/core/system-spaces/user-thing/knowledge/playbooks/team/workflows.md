---
description: LOAD WHEN a team asks you to TELL people something, to say what was DECIDED or where something got to, or when carrying out the request would make a choice that is genuinely the team's. Their inputs, their result shapes, and what to do with each.
---

# Three team jobs that are workflows, not improvisations

Each of these goes wrong the same way when it is improvised inside one turn, so each has a tasklist
that makes the part that goes wrong a separate, unavoidable step. Reach for them only in a team
workspace (no `teamContext` in your types ⇒ no team, and none of these apply).

- **They ask you to tell OTHER people something** ("let the others know", "can you flag this to
  whoever is on it") → `await tasklist('tell_the_team', { request: '<their message, verbatim>',
  substance: '<what actually has to be conveyed, in plain words>' })`. The workflow cannot see this
  conversation, so `substance` is how it learns what happened. It chooses the channel with the log in
  front of it, writes ONE message with the attribution the right way round, and posts it once — the
  three things in points 2, 3 and 7 of `('playbooks','team','conduct')`, done in that order by steps
  that physically cannot do each other's job. Read its result and relay it in a line: `posted` ⇒ say
  which channel; `ask` ⇒ put its `question` to them with `ask()`; `here` ⇒ tell them the people they
  mean are already reading this, so there is nothing to send. Never report a send it did not make.
- **They ask about the workspace itself** — who owns something, where it got to, what was decided,
  whether it was done → `await tasklist('answer_from_team_record', { question: '<their message,
  verbatim>' })`. Not the conversation in front of you: they are asking precisely because they were
  not in the room where it was settled, and what you can see may have been superseded since. It reads
  the channels and tables that would hold it and answers from those. Its `checked` is what makes
  "there is no record of that" sayable — pass that on with the answer, and never say it without one.
- **Carrying out their request would make a choice that is genuinely the team's** → `await
  tasklist('settle_team_decision', { request: '<their message, verbatim>', background: '<what you
  know that bears on it, including any requirement somebody has already stated>' })`. Then act on
  `status`: `proceed` ⇒ carry on and say what you assumed; `settled` ⇒ tell them what already stands
  and act on that; **`ask` ⇒ your very next statement is a real `await ask(...)` carrying its
  `question` and `options`.** Recognising that a decision is theirs and then WRITING THE QUESTION
  DOWN is not asking — a displayed question ends the turn, reaches nobody, and gets answered, if at
  all, as an unrelated new conversation. Only `ask()` waits.

The medium an existing app was built in is one of these: changing a `*.tsx` app to `*.view.json`
specs (or the reverse) reverses a requirement somebody stated, so it is `settle_team_decision`, not
your call — see `('playbooks','building','spec-app')`.
