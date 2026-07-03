---
input:
  request: string
---

Build a complete, working application inside the current project from a natural-language
`request`, ONE FILE AT A TIME. The pipeline first DESIGNS the app (an appId, tables, endpoints,
pages, hooks), then creates the project and writes each file with the injected authoring globals
(`createProject`/`writeTableSchema`/`writeApi`/`writePage`/`writeHook`) — the host runs the steps
in dependency order and fans the per-table / per-endpoint / per-page / per-hook steps out for you,
each writing exactly one file. Every table/column/relation carries a real description; pages use
`@lmthing/css` design tokens only.
