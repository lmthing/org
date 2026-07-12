---
name: project-app
description: Load when building or modifying a project-as-application — a project's database/ pages/ api/ hooks/ app layer, the capability globals, the system-appbuilder space, or the store install/serve path.
---

# Skill: Project-as-application

Load this when you are touching a **project's app layer** — the `database/ api/ pages/ components/
hooks/ events/` pillars that sit as siblings of `spaces/` in a project root — or the machinery around
it: the capability-gated authoring globals, the `system-appbuilder` space, the pod's app serving, or
the store install path.

This file holds **no knowledge**. Everything factual about the format, the runtime and the globals
lives in `org/docs/` and is cited to code there.

## Read first

| You are touching… | Read |
|---|---|
| the **on-disk format** you author (the pillars, the descriptor files, the capability gate) | `org/docs/format/project/README.md` |
| a specific pillar | `org/docs/format/project/database/README.md` · `api/README.md` · `pages/README.md` (+ `pages/app-file.md`, `pages/layout-file.md`) · `components/README.md` · `hooks/README.md` (+ `cron.md`, `event.md`, `database.md`) · `events/README.md` · `spaces/README.md` |
| the **served app** — boot, page build, serving/CSP, the api runtime, typed contracts, the auth boundary | `org/docs/app/README.md` · `org/docs/app/routes.md` · `org/docs/app/views.md` · `org/docs/app/features.md` |
| the **authoring globals** — `writeTableSchema`/`writeApi`/`writePage`/`writeHook`, the `writeProject*` live twins, `createProject`/`selectProject`, `apiCall`, and exactly what gates each | `org/docs/runtime-globals/app-authoring.md` |
| the `db` global itself | `org/docs/runtime-globals/data-db.md` |
| the `capabilities:` frontmatter grammar | `org/docs/format/space/agents/capabilities.md` |
| the event/hook pipeline the live writers republish into | `org/docs/runtime-globals/events-and-integrations.md` · repo-root skill `@lmthing:.claude/skills/events-and-hooks.md` |
| the admin/build/install REST endpoints | `org/docs/cli-api/rest/projects.md` · `org/docs/cli-api/rest/apps.md` |
| the `system-appbuilder` space | `org/docs/system-spaces/README.md` · the source of truth for its agents is their frontmatter: `libs/core/system-spaces/system-appbuilder/agents/*/instruct.md` |
| styling inside `pages/`/`components/` (mandatory) | `org/docs/design-system/README.md` |

## Procedure

**Authoring an app**

1. **Do not author an app inline.** THING delegates to `system-appbuilder`'s `app-architect`, which
   fans out to the specialist agents. Change the *space* (its agents' `capabilities:`, instructions,
   `build_app` tasklist), not the caller.
2. **One authoring call per file.** Never a single giant scaffold call — same incremental discipline
   `system-architect` uses for spaces.
3. Pick the right writer family: **catalog** writers (`writePage`/`writeApi`/…) target a
   `store/projects/<id>/` template and require `createProject`/`selectProject` first; **live-project**
   writers (`writeProject*`) target the running project and apply the change. The difference is
   spelled out in `org/docs/runtime-globals/app-authoring.md`.
4. **After a live `writeProjectPage`/`writeProjectApi`/`writeProjectComponent`, the page bundle is NOT
   rebuilt for you** — `POST /api/projects/:projectId/app/build` before expecting the served app to
   change (`org/docs/cli-api/rest/projects.md`).
5. Every writer **returns** `{ ok, error? }` — check it; failures are returned, not thrown.

**Changing a capability or a global**

- Injection and the DTS overlay must move together (not granted ⇒ not injected ⇒ not declared).
  Follow `@.claude/skills/new-global.md`, and read `org/docs/runtime-globals/app-authoring.md` for the
  existing gate table before adding to it.

**Testing**

```bash
cd sdk/org
pnpm test libs/cli/src/app          # app runtime, boot, page serve, authoring globals
pnpm test libs/core/src/exec        # capability injection
pnpm test libs/core/src/typecheck   # DTS gating
```

- **Always live-test** a prompt / globals / space-format change against the real model, then read the
  `--trace <file>` NDJSON — unit tests do not catch a model that cannot use the surface.
- Prod install→serve runbook: repo-root skill `@lmthing:.claude/skills/test-app-install-prod.md`.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
