---
id: report
output:
  ok: boolean
  summary: string
dependsOn: [assess, add_specialist, build_app]
goal: true
role: explore
functions: []
---

Report what was added, merging both branches. `assess`, `add_specialist` (may be absent — it only ran
for a genuinely new area) and `build_app` are in scope. Do not write anything here; just summarise the
outcome for the caller to relay.

Compose one plain sentence for the user: what area was added, whether a specialist space now covers it
(from `add_specialist` when present), and that the app part is ready to open. Set `ok` true when the
app part built and — if the area was new — the specialist was created. Emit ONE statement:

currentTask.resolve({ ok: !!(build_app && build_app.ok) && (!assess || assess.isNewArea !== true || !!(add_specialist && add_specialist.ok)), summary: "<one sentence: the new area, its specialist if any, and that it's ready to open>" });
