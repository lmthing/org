---
id: validate
output:
  ok: boolean
  errors: string
  dir: string
dependsOn: [design, write_agent, write_tasks, build_field]
role: explore
functions:
  - validateSpace
---

Validate the assembled space (checks every declared function/knowledge/component/tasklist
exists, exactly one goal task per tasklist, charter present, roles valid, forEach refs valid).
Emit:

const v = validateSpace(design.slug);
// v = { ok, errors, dir }. `dir` is the resolved absolute path the register step needs.
currentTask.resolve({ ok: v.ok, errors: v.ok ? "" : v.errors.join("; "), dir: v.dir });
