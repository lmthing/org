---
input:
  request: string
  background: string
---

Somebody has asked for something that cannot be carried out without making a choice — and the choice
may not be yours to make. `request` is what they asked, verbatim; `background` is what you already
know that bears on it, including any requirement somebody else on the team has stated.

The failure this exists to prevent is subtle: recognising perfectly well that a decision belongs to
the people, and then *writing the question down as a remark* — which reaches nobody, waits for
nothing, and is answered, if at all, as an unrelated new conversation. So this workflow can neither
act nor speak. Step one decides whether looking can settle it or only a preference can, and — when it
is genuinely theirs — writes the question and the concrete alternatives. Step two checks whether the
team already settled this, because asking a closed question a second time reopens it. Step three
merges the branches into one verdict.

The goal output is `{ status, question, options, whoDecides, detail }` with `status` ∈ `ask` |
`proceed` | `settled`. A `status: 'ask'` is not a sentence to relay — it is a question the caller must
actually PUT to them and then wait for.
