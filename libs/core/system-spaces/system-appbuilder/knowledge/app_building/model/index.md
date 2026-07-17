---
variable: appBuildingModel
description: How a project-as-application is structured and built — the four file kinds (database schemas, API handlers, React pages, automation hooks), the capability grant model that gates the authoring globals, and the typed contracts that hold it together.
---

# The project-as-application model

A project IS an application. Building one means authoring these kinds of files directly into the
LIVE project directory, each written by a synchronous, validated authoring global:

- **`database/<table>.json`** — the data model: JSON table schemas. `writeProjectTable(name, schema)`.
  Every table, column, and relation carries a required `description`.
- **`api/<path>/<METHOD>.ts`** — typed HTTP handlers. `writeProjectApi('<name>/<METHOD>', src)`. Each
  exports `name`, `description`, `Input`, `Output`, and a default async handler using `ctx.db`.
- **`pages/<route>.tsx`** — React pages. `writeProjectPage(route, src)`. Data comes from `@app/runtime`
  hooks; styling uses `@lmthing/css` design tokens only.
- **`hooks/<slug>.ts`** — automation. `writeProjectHook(slug, src)`. A cron trigger (time-based) or a
  database trigger (fires on a table write).
- **`events/<name>.ts`** — emitter defs. `writeProjectEvent(name, src)`. A PRODUCER that emits events.

The project the automator writes into is chosen by the HOST: THING (holding `project:manage`)
`createProject(name)`s a new live project or `selectProject(id)`s an existing one, and the runtime
retargets the automator's build into it. The automator never creates or selects a project — every
write lands in the project the session is already targeting.

Each authoring global is GATED by a matching `capabilities:` grant on the agent (see the
`capability-model` aspect). The globals are host-injected only when the grant is present; a
capability-less agent cannot touch them. The file formats and their required shapes are covered in
the `file-formats` aspect.
