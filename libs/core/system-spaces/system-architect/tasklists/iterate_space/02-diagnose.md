---
id: diagnose
output:
  issues: string
  plan: string
dependsOn: [load]
optional: false
goal: false
role: explore
---

Identify what needs to improve in the existing space and produce a **per-file change plan** — a
structured description of which files to re-write and how. You are a READ-ONLY task: read the
space directly (you cannot write here), then resolve the diagnosis.

The space dir is `load.dir`, the agent slug `load.agentSlug`, and the user's request is the seed
`feedback`. Read the current files and decide concrete per-file changes. Code:

const instruct = readFileRaw(load.dir + "/agents/" + load.agentSlug + "/instruct.md");
const tasks = listDir(load.dir + "/tasklists");
// Identify specific issues (wrong system prompt, missing/incorrect functions, bad tasklist
// structure, missing knowledge) and propose CONCRETE PER-FILE CHANGES — e.g. "rewrite
// instruct.md systemPrompt to X", "add knowledge option dogs/breeds/terriers", "add function F",
// "rewrite task answer/01-reply instruction T". Base everything on what you actually read.
const issues = "<bullet list of concrete issues>";
const plan = "<structured per-file change list; or 'no changes' if the space is already good>";
display(<div><h3>Diagnosis</h3><pre>{issues}</pre><h3>Plan</h3><pre>{plan}</pre></div>);
currentTask.resolve({ issues, plan });
