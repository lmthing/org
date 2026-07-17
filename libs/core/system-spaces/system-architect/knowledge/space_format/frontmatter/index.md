---
variable: agentFrontmatterFormat
description: The current agent instruct.md frontmatter format — the fail-loud top-level key allow-list and the config-bearing capabilities key that gates project-app powers.
---

# Agent frontmatter — current format

Every scaffolded agent's `instruct.md` frontmatter is validated **fail-loud** against a fixed
top-level key allow-list — a typo'd or legacy key throws instead of being silently ignored. Beyond
the keys you already write with `writeAgentFile` (`title`, `knowledge`, `functions`, `components`,
`actions`, `defaultAction`, `canDelegateTo`), the format also recognizes a `capabilities:` key that
grants an agent scoped access to a **project's app layer** (`database/pages/api/hooks` — a project
owns an app the way a space owns agents). The `allow-list` aspect covers the full key set and the
validation rule; the `capabilities` aspect covers the capability ids, their config shapes, and the
fail-loud grant validation. **Do not add `capabilities:` to a plain scaffolded space unless the
request is specifically for a data-backed app** — building one is the job of the dedicated
`system-appbuilder` space (the `automator` + its specialists), not this architect scaffolding a raw
space by hand.
