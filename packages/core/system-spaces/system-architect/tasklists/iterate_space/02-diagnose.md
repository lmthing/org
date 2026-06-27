---
id: diagnose
output:
  issues: string
  plan: string
dependsOn: [load]
optional: false
goal: false
---

Identify what needs to improve in the existing space and produce a **per-file change
plan** — a structured description of which files to re-write and how.

Spawn a plan fork to read the space and the user's feedback:
```typescript
const diagnosis = await fork({
  role: 'plan',
  seed: { dir: load.dir, agentSlug: load.agentSlug, feedback },
  instruction: `Read the space at \`dir\` (use listDir/readFileRaw on agents/<slug>/instruct.md,
tasklists/, functions/, knowledge/) and the user feedback. Identify specific issues
(wrong system prompt, missing/incorrect functions, bad tasklist structure, missing
knowledge, etc.) and propose CONCRETE PER-FILE CHANGES — e.g. "rewrite instruct.md
systemPrompt to X", "add knowledge option dogs/breeds/terriers", "add function F with
source ...", "rewrite task answer/01-reply instruction T". Return issues as a bullet
list and plan as a structured per-file change list.`,
  output: { issues: 'string', plan: 'string' }
}) as { issues: string; plan: string };
```

Show the diagnosis, then resolve with it so the downstream tasks apply the plan:
```typescript
display(<div><h3>Diagnosis</h3><pre>{diagnosis.issues}</pre><h3>Plan</h3><pre>{diagnosis.plan}</pre></div>);
```

Resolve with the diagnosis (`{ issues, plan }`).
