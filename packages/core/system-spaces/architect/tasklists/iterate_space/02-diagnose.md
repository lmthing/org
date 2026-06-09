---
id: diagnose
output:
  issues: string
  plan: string
dependsOn: [load]
optional: false
goal: false
---

Identify what needs to improve in the existing space and produce a **spec mutation
plan** — not a list of file edits, but a structured description of which spec
fields to change.

Spawn a plan fork to analyse the current spec and the user's feedback:
```typescript
const diagnosis = await fork({
  role: 'plan',
  seed: { currentSpec: load.currentSpec, dir: load.dir },
  instruction: `Analyse the current agent spec and the user feedback.
Identify specific issues (wrong system prompt, missing/incorrect functions,
bad tasklist structure, missing knowledge, etc.) and propose CONCRETE SPEC
MUTATIONS — e.g. "update systemPrompt to X", "add knowledge field Y with
option Z", "add function F with source ...", "change task instruction T".
Return issues as a bullet list and plan as a structured spec-mutation list.`,
  output: { issues: 'string', plan: 'string' }
}) as { issues: string; plan: string };
```

Show the diagnosis to the user and ask for approval:
```typescript
display(<div><h3>Diagnosis</h3><pre>{diagnosis.issues}</pre><h3>Plan</h3><pre>{diagnosis.plan}</pre></div>);
const ok = await ask(`Apply this improvement plan?`) as boolean;
```

If the user declines, resolve with `{ issues: 'user declined', plan: 'no changes' }`.
Otherwise, resolve with the diagnosis.
