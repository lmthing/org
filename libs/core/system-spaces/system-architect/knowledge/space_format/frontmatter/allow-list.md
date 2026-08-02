---
description: LOAD WHEN writeAgentFile REJECTED your frontmatter over an unrecognized top-level key — an unknown key fails the whole space LOAD, so fix the one field rather than guessing a second spelling.
---

# The frontmatter key allow-list

An agent `instruct.md`'s YAML frontmatter is checked against a fixed set of top-level keys; any
other key fails the space load instead of being silently dropped. The recognized keys:

```
title, knowledge, functions, components, actions, defaultAction, canDelegateTo, dependencies, capabilities
```

- `title`, `knowledge`, `functions`, `components`, `actions`, `defaultAction`, `canDelegateTo` are
  the keys `writeAgentFile` already writes for every scaffolded agent — nothing changes there.
- `dependencies` is a legacy alias predating `canDelegateTo`; prefer `canDelegateTo` for anything
  new.
- `capabilities` is the config-bearing key that grants project-app powers (`db:*`, `views:write`,
  `api:write`, `hooks:write`, `api:call`, `project:manage`) — see the `capabilities` aspect. Leave
  it out entirely for a plain (non-app) space; an agent with no `capabilities:` gets none of those
  globals and none of their typecheck DTS surface.

**Never invent a new top-level key.** If a design seems to need one, it almost always means the
information belongs in the markdown body (the system prompt) or in a `config.json` alongside
`instruct.md`, not in the frontmatter block.
