---
variable: appBuildingModel
description: How a spec-view project-as-application is structured and built — the file kinds (database schemas, API handlers, view/component/shell SPECS, automation hooks), the capability grant model that gates the authoring globals, and the typed contracts that hold it together.
---

# The project-as-application model

A project IS an application. Building one means authoring these kinds of files directly into the
LIVE project directory, each written by a synchronous, validated authoring global:

- **`database/<table>.json`** — the data model: JSON table schemas. `writeProjectTable(name, schema)`.
  Every table, column, and relation carries a required `description`.
- **`api/<path>/<METHOD>.ts`** — typed HTTP handlers. `writeProjectApi('<name>/<METHOD>', src)`. Each
  exports `name`, `description`, `Input`, `Output`, and a default async handler using `ctx.db`.
- **`pages/<route>.view.json`** — pages, as SPECS. `writeProjectView(route, spec)`. A page is an
  ordered list of sections from a closed menu of eight kinds; values are bound by PATH (`$.field`)
  into the ONE endpoint each section names. No TSX, no imports, no class names, no colours — the
  writer host-generates the trivial React wrapper that renders the spec, and the SAME spec renders
  natively in the mobile app with no WebView.
- **reusable view components** — `writeProjectViewComponent(name, def)`. A named composition of the
  closed 24-element vocabulary with declared props, referenced from a section as `{ use: '<Name>' }`.
- **the app shell** — `writeProjectViewShell(shell)`. Navigation (flat `nav` or grouped), per-entity
  `subnav`, and the persistent `assistant` dock. The spec replacement for a hand-written `_layout`.
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
