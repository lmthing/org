---
id: resolve
output:
  decision: string
  winner: string
  detail: string
dependsOn: [gather]
goal: true
role: explore
functions: []
---

Apply the precedence. The `gather` result (`claimValue`/`claimSource`, `existingValue`/`existingSource`)
is in scope. This is PURE reasoning — resolve only, write nothing.

Rank sources: **user (4) > db (3) > researched (2) > guess (1)**.

- The claim's source outranks the existing one → `decision: 'replace'`, `winner: claimValue`.
- The existing source outranks the claim → `decision: 'keep'`, `winner: existingValue`.
- They are EQUALLY authoritative (same rank) and the values differ → do NOT pick: `decision: 'ask'`,
  `winner: ''`, and in `detail` give the user both values and their sources so the caller can ask
  which is right.

Put a one-sentence explanation in `detail`. Emit ONE statement:

currentTask.resolve({ decision: "<keep|replace|ask>", winner: "<the winning value or ''>", detail: "<explanation, incl. both values when asking>" });
