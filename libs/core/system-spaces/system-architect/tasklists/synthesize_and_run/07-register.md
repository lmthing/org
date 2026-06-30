---
id: register
output:
  spaceKey: string
  agentSlug: string
  ok: boolean
  error: string
dependsOn: [design, validate]
role: general
---

Register the validated space into the live runtime so it can be run. `registerSpace` is a
yielding call — keep it FLAT at the top level and guard it with a ternary (never inside
if/try). Skip registration when the build didn't validate. Emit:

const reg = validate.ok ? await registerSpace(validate.dir) : { ok: false, spaceKey: "", agentSlug: "", error: validate.errors };
currentTask.resolve({
  spaceKey: reg.ok ? reg.spaceKey : "",
  agentSlug: reg.ok ? reg.agentSlug : "",
  ok: reg.ok === true,
  error: reg.ok ? "" : (validate.ok ? (reg.error || "registration failed") : validate.errors),
});
