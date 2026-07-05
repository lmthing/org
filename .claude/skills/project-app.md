---
name: project-app
description: Load when building or modifying a project-as-application — a project's database/ pages/ api/ hooks/ app layer, the capability globals, the system-appbuilder space, or the store install/serve path.
---

# Skill: Project-as-application

A **project** can own a full **application**, not just spaces. Alongside `spaces/`, a project root
holds `database/ pages/ api/ hooks/` (siblings of `spaces/`, not inside any one space). Spaces stay
the reusable agent-capability layer; the project is the app + its data, and several spaces in one
project share one database and one page bundle.

- **Full design** (serving/domains, Studio admin/dev, safety, boot sequence, phases): [`project-as-application.md`](../../project-as-application.md)
- **Phased build plan** (how it was implemented, DoD gate, push protocol): [`project-as-application-implementation.md`](../../project-as-application-implementation.md)
- **Quick authoring reference** (file formats, worked examples): [`SPACE_DEVELOPMENT.md`](../../SPACE_DEVELOPMENT.md) §7
- **Worked examples** (one concrete app each): `blog-application.md`, `health-application.md`, `kitchen-application.md`, `trips-application.md`
- **Shipped catalog apps**: `store/projects/{blog,health,kitchen,trips,demo-feed}/` (monorepo), indexed by `store/projects/manifest.json`

## The layer, and where each piece lives

| Surface | On disk | Runtime | Code |
|---|---|---|---|
| **db** | `database/<table>.json` (one file per table; table + every column/relation needs a `description`) | SQLite in the pod, one file per project | `libs/core/src/db/` (`schema.ts`, `types.ts`) |
| **api** | `api/<route>/<METHOD>.ts` (dir = route, filename = HTTP method) | **Node, worker-isolated** — crash boundary, not a security boundary | `libs/cli/src/app/` (runtime), `libs/core/src/app/build/contracts.ts` |
| **pages** | `pages/*.tsx` (file-based routing; `_app.tsx`/`_layout.tsx` are non-route wrappers) | **client-side React** (no pod-side loader); data via `@app/runtime` (`useApi`/`useApiMutation`/`apiCall`) | `libs/core/src/app/build/pages.ts`, `libs/cli/src/app/pages-serve.ts` |
| **hooks** | `hooks/<slug>.ts` (`type: 'cron'` or `type: 'database'`; declarative `trigger:` or imperative `handler:`) | cron rides the pod crond (prod) / 60s tick (dev); `database` dispatch is **in-proc, decoupled from the write** (enqueue → drain after the eval, never re-entrant) | app runtime in `libs/cli/src/app/` |

Full file-format detail is in **SPACE_DEVELOPMENT.md §7** — don't duplicate it; read it before authoring.

## The capability model (this is the core invariant)

Nothing about the app layer is ambient. An agent can touch a surface **only** when its
`capabilities:` frontmatter grants the matching id — even THING holds none of its own.

- Ids (`libs/core/src/spaces/capabilities.ts`, `CapabilityId`): `db:read`, `db:write`, `db:schema`,
  `pages:write`, `api:write`, `hooks:write`, `api:call`, `project:manage`.
- **Enforced at injection, not by prose.** `libs/core/src/exec/app-globals.ts` injects each global
  only when the agent holds the capability, and scopes every call (e.g. table access). The matching
  DTS fragment (`libs/core/src/typecheck/library-dts.ts` — `PAGES_WRITE_DTS`, `API_WRITE_DTS`,
  `HOOKS_WRITE_DTS`, `composeDbDts`, `CAPABILITY_DTS_FRAGMENTS`) is overlaid so a call the agent
  can't make fails **typecheck**, not at runtime. Registry: `libs/core/src/exec/capability.ts`,
  `bootstrap.ts`.
- **Two db surfaces, one schema.** In the agent sandbox `db.*` is **synchronous** (execShell-class
  host call, no turn boundary). In `api/`/`hooks/` Node handlers the identical method set is
  `AsyncDbApi` — `Promise`-returning, a cross-thread proxy; every write still lands in the **main**
  process (that's what keeps hook dispatch + the loop guard sound). The worker is a crash boundary.

## Authoring globals (capability-gated)

`db`, `writeTableSchema`, `writePage`, `writeApi`, `writeHook`, `createProject`, `selectProject` —
declared in `libs/core/src/exec/app-globals.ts` (`AppGlobalImpls`), resolved against **`projectRoot`**
(never `LMTHING_SPACE_DIR`; a session with no `projectRoot` gets none of them). Host-side writers
that validate slug/table/segment names and write files live in
`libs/cli/src/app/authoring/globals.ts` (`createAppAuthoringGlobals`); catalog root is resolved by
`libs/cli/src/app/authoring/catalog-root.ts`.

**One authoring call per file** — the same incremental scaffolding discipline `system-architect`
uses for spaces. Never one giant scaffold call.

## The `system-appbuilder` space (the expertise; THING delegates)

`libs/core/system-spaces/system-appbuilder/` — THING never authors an app directly; it delegates.
Five least-privilege agents (each `functions: []`, `knowledge: app_building/model`):

| Agent | Capabilities | Role |
|---|---|---|
| `app-architect` | `project:manage` + full authoring set + delegation to the other four | binds/creates the project, plans, fans out (`defaultAction: build_app`) |
| `data-modeler` | `db:schema`, `db:read` | designs/evolves tables (`writeTableSchema`) |
| `page-builder` | `pages:write`, `db:read` | authors pages (`writePage`) |
| `api-author` | `api:write`, `db:read` | authors named typed endpoints (`writeApi`) |
| `automator` | `hooks:write` | wires cron/db hooks (`writeHook`) |

Its `build_app` tasklist decomposes to `design → create_project → build_table[] → build_api[] →
build_page[] → build_hook[] → finalize`. Knowledge lives under `knowledge/app_building/model/`.

## Serving & store distribution

- **Serving**: the pod serves an installed app's SPA at `/app/<project>/` —
  `libs/cli/src/app/pages-serve.ts` injects `<base href="/app/<project>/">` so relative assets
  resolve at any route depth; static assets via `libs/cli/src/server/static-apps.ts`.
- **Install/list endpoints** (`libs/cli/src/server/routes/apps.ts`, mounted in `server/serve.ts`):
  `GET /api/apps` fetches the **public** store catalog (`${STORE_URL}/projects/manifest.json`);
  `POST /api/apps/install {appId, projectId?, force?}` downloads the template, materializes it into
  `<lmthingRoot>/<projectId>/`, boots (`app/boot.ts`), generates contracts
  (`app/build/contracts.ts`), builds pages (`app/build/pages.ts`). Install-tracking manifest at
  `<dest>/.data/.installed.json` (pristine-vs-edited re-sync); `.data/`/`types/` are never copied.
- **Catalog** (monorepo `store/`): apps are templates under `store/projects/<id>/`; the browse index
  `store/projects/manifest.json` is generated by `store/scripts/gen-apps-manifest.mjs` (via the Vite
  plugin in `store/vite.config.ts`). The static store only browses (`store/src/routes/projects/`,
  `store/src/lib/apps-manifest.ts`); the install hand-off is `store/src/lib/pod-api.ts` →
  lmthing.app → the pod endpoint above.

## Gotchas

- **`projectRoot`, not `LMTHING_SPACE_DIR`** — every project-app global is project-rooted; no
  `projectRoot` ⇒ none injected.
- **Contracts are TS + JSDoc → JSON Schema** (`ts-json-schema-generator`), driving ajv request
  validation, the calling agent's typed `apiCall` overload, and the client's typed `useApi`. `name`
  is unique per project (fail-loud on a duplicate).
- **A project-app agent's chat history** persists under `<project>/spaces/<spaceId>/sessions/`, not
  `<project>/sessions/`.
- **Schema evolution is additive-lenient only** — new tables/columns via `createTable`/`addColumn`;
  a rename/drop/type-change diverging from the live schema fails loud at boot.
- **Design tokens still mandatory** in `pages/` — `@lmthing/css` tokens only, same hard gate as
  every web surface.

## Testing

- App runtime + serving: `libs/cli/src/app/*.test.ts` (e.g. `pages-serve.test.ts` asserts the
  `<base href>` injection).
- Capability injection/DTS gating: `libs/core/src/exec/*` + `typecheck/` tests.
- **Always live-test** prompt/globals/space-format changes against the real model (see
  `project-as-application-implementation.md` §0.2) and inspect the `--trace` NDJSON.
- Prod install→app runbook: `@lmthing:.claude/skills/test-app-install-prod.md` (monorepo).
