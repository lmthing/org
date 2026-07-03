---
variable: appBuildingModel
description: How a project-as-application is structured and built — the four file kinds (database schemas, API handlers, React pages, automation hooks), the capability grant model that gates the authoring globals, and the typed contracts that hold it together.
---

# The project-as-application model

A project IS an application. Building one means authoring four kinds of files inside the project
directory, each written by a synchronous, validated authoring global:

- **`database/<table>.json`** — the data model: JSON table schemas. `writeTableSchema(name, schema)`.
  Every table, column, and relation carries a required `description`.
- **`api/<path>/<METHOD>.ts`** — typed HTTP handlers. `writeApi('<name>/<METHOD>', src)`. Each
  exports `name`, `description`, `Input`, `Output`, and a default async handler using `ctx.db`.
- **`pages/<route>.tsx`** — React pages. `writePage(route, src)`. Data comes from `@app/runtime`
  hooks; styling uses `@lmthing/css` design tokens only.
- **`hooks/<slug>.ts`** — automation. `writeHook(slug, src)`. A cron trigger (time-based) or a
  database trigger (fires on a table write).

`createProject(id, { title })` scaffolds the project and selects it as the current authoring
target; `selectProject(id)` re-selects an existing one. Every write lands in the selected project.

Each authoring global is GATED by a matching `capabilities:` grant on the agent (see the
`capability-model` aspect). The globals are host-injected only when the grant is present; a
capability-less agent cannot touch them. The file formats and their required shapes are covered in
the `file-formats` aspect.
