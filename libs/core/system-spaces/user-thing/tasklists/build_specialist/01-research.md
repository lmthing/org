---
id: research
output:
  report: object
dependsOn: []
optional: true
goal: false
role: explore
functions: []
canDelegateTo:
  - system-research/researcher#deep_research
prelude: |
  const researchEnv = request ? await delegate('system-research', 'researcher', 'deep_research', { query: String(request) }) : { ok: false, degraded: true, data: {} };
---

Package the domain research for the build step. The deep research ALREADY ran (see the prelude
result in scope): `researchEnv` is the researcher's envelope `{ ok, degraded, data }` — `data` is
the cited report ({ topic, executive_summary, findings, conclusion, sources }). Do NOT research
anything yourself.

Resolve the report payload — when the research failed or came back degraded/empty (including
`researchEnv` being undefined because the delegation itself failed), resolve an empty object
instead; the build step tolerates missing research. Emit ONE statement:

currentTask.resolve({ report: (researchEnv && researchEnv.data) ? researchEnv.data : {} });
