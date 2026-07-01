---
id: plan
output:
  topic: string
  questions: array
dependsOn: [scope]
optional: false
goal: false
role: explore
functions: []
---

This is a PURE PLANNING step — you have no search/fetch tools here, just reason and resolve.
`scope.topic` and `scope.landscape` are in scope: the landscape is a real survey of what's out
there, not a guess — use it, don't ignore it.

Decompose `scope.topic` into **6-8** distinct sub-questions that together cover it from different
angles. Default to this taxonomy (drop an angle only if `scope.landscape` shows it genuinely does
not apply to this topic):

1. Background / definition — what it is, origin, core mechanics.
2. Current state / evidence — the data, adoption, or status as of now.
3. Key players / case studies — the named organizations, people, or concrete examples.
4. Risks / criticism / debate — documented downsides, controversy, or open disagreement.
5. Outlook / future implications — where it's heading, what experts expect next.
6. A topic-specific angle suggested by something concrete in `scope.landscape` that the taxonomy
   above doesn't already cover.

These are NOT rephrasings of each other — each drives an independent investigation that runs in
parallel and sees ONLY its own question string, not `topic` or `scope.landscape`. So make every
question specific, search-friendly, and self-contained: it must name the subject.

Emit this single statement:

currentTask.resolve({ topic: scope.topic, questions: ["<question 1>", "<question 2>", "<question 3>", "<question 4>", "<question 5>", "<question 6>"] });
