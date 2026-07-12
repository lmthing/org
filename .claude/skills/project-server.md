---
name: project-server
description: Load when working on the lmthing project server, session persistence, the .lmthing/ layout, the project/session/space HTTP APIs, or space discovery.
---

# Skill: Projects & the `lmthing` pod server

Use this when you are editing `sdk/org/libs/cli/src/{cli,server}/**` — the `lmthing` binary, the one-process/one-port pod server (SPA catch-all + `/api/*` REST + WS + the served project-app), the `.lmthing/` root and system-space materialization, session persistence/resume, or project & space discovery.

## Read first (the grounded truth)

Do not trust anything you remember about these routes or files — read the page.

| Need | Page |
|---|---|
| the CLI + pod server overview: one process/one origin, the `.lmthing/` root layout, system-space reconciliation, boot order, ports | `org/docs/cli-api/README.md` |
| every flag, subcommand, env var (`serve`, `init`, `--request`, `--mock`, `--web`, `--adopt-system-spaces`, …) | `org/docs/cli-api/commands.md` |
| the full route table (registration order = precedence), auth/gating conventions, WS upgrades, per-session sub-routes | `org/docs/cli-api/rest/README.md` |
| a specific route group | `org/docs/cli-api/rest/{projects,sessions,spaces,store-spaces,apps,hooks,webhooks,env,fs,uploads,budget,misc}.md` |
| the served project-app: what boots, page build, api runtime, the two mounts, CSP, `@app/runtime`, contracts | `org/docs/app/README.md` · `org/docs/app/{routes,views,features}.md` |
| session snapshots, resume, history summarization, tracing (the `Session` API itself) | `org/docs/runtime/sessions.md` |
| what the shipped system spaces are | `org/docs/system-spaces/README.md` |

## Procedures

**Run the server locally**

```bash
cd sdk/org
pnpm thing                                  # CLI + web app on one port, both hot-reloading
node libs/cli/dist/cli/bin.js serve         # or: the built binary (default :8080)
pnpm test libs/cli/src/server               # server tests
```

**Add or change a REST route**

1. Write the handler in `sdk/org/libs/cli/src/server/routes/<group>.ts` — signature `(req, res, params, ctx) => Promise<void>`; use `readBody`/`sendJson` from `routes/utils.ts`.
2. Register it in `startSessionServer` (`sdk/org/libs/cli/src/server/serve.ts`). **Registration order is precedence** (first match wins): literal `/api/*` and `/app/*` routes must stay registered before the `:projectId` root mounts, and specific sub-routes before their bare parent.
3. Add a co-located test; run `cd sdk/org && pnpm test libs/cli/src/server`.
4. Update the row in `org/docs/cli-api/rest/README.md`'s route table **and** the owning sub-page in the same change.

**Add a worker-run seam** (space emitter, space hook handler, code node): also add its entry to `sdk/org/libs/cli/tsup.config.ts`. Unit tests run from `src/` and will not catch a missing dist entry — the image ships broken.

**Change the `.lmthing/` layout or the system spaces**: touch `sdk/org/libs/cli/src/cli/runtime-init.ts` (`materializeRuntime` / `syncSystemSpaces` / `runtimeNeedsInit`) and update `org/docs/cli-api/README.md`'s "The pod root" section.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the same change (see `org/docs/SYNC.md`).
