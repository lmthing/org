---
id: build
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
  ok: boolean
  errors: string
dependsOn: [research]
goal: true
role: general
functions: []
canDelegateTo:
  - system-architect/architect#synthesize_and_run
---

Hand the user's `request` (a seed variable in scope) plus the upstream research to the architect,
which designs, scaffolds, validates, and registers the new specialist agent. `research` is the
upstream output `{ report }` — the report may be `{}` (empty) when research was unavailable;
delegate ANYWAY, the architect's build tolerates thin research. This task ALWAYS runs. Emit:

const t = await delegate('system-architect', 'architect', 'synthesize_and_run', { query: String(request), context: { topic: String(request), goal: String(request), research: (research && research.report) ? research.report : {} } });

(If `research` is not in scope at all — the optional research task was skipped — pass
`research: {}` in `context` instead.)

`t` is the architect's envelope `{ ok, degraded, data }`; `t.data` is the build result
({ spaceKey, agentSlug, actionId, query, ok, errors }). Package it field-for-field — on a
missing/failed result, resolve empty coordinates with `ok: false` and the error in `errors`
(never fabricate coordinates). Emit:

const built = (t && t.data) ? t.data : { spaceKey: "", agentSlug: "", actionId: "", query: "", ok: false, errors: "the architect returned no result" };

currentTask.resolve({ spaceKey: String(built.spaceKey || ""), agentSlug: String(built.agentSlug || ""), actionId: String(built.actionId || ""), query: String(built.query || request), ok: !!(t && t.ok === true && built.ok === true), errors: String(built.errors || "") });
