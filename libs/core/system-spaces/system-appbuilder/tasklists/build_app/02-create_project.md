---
id: create_project
output:
  appId: string
  root: string
  ok: boolean
dependsOn: [design]
role: general
functions: []
---

Create the project that every later step writes into. Call `createProject` with the designed
`appId` and title, then resolve. `createProject` selects the new project as the current authoring
target, so the downstream table/api/page/hook writers land inside it. Emit:

const c = createProject(design.appId, { title: design.title });
// c = { ok, appId?, root?, error? }. If c.ok is false, the appId likely collides — read c.error.
currentTask.resolve({ appId: c.ok ? (c.appId ?? design.appId) : design.appId, root: c.root ?? "", ok: c.ok });
