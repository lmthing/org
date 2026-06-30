---
id: finalize
output:
  spaceKey: string
  agentSlug: string
  actionId: string
  query: string
  ok: boolean
  errors: string
dependsOn: [design, register, validate]
goal: true
role: explore
---

Package the result for the caller. This is the GOAL task — it ALWAYS runs and ALWAYS resolves a
uniform result (success OR a structured failure), so the caller can decide whether to run the
new agent. The original user request `topic` is in scope as a seed variable. Emit:

const ok = register.ok === true && register.spaceKey !== "";
currentTask.resolve({
  spaceKey: register.spaceKey,
  agentSlug: register.agentSlug,
  actionId: design.actionId,
  query: topic,
  ok,
  errors: ok ? "" : (validate.ok ? (register.error || "registration failed") : validate.errors),
});
