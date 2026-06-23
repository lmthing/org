---
name: project-server
description: Load when working on the lmthing project server, session persistence, the .lmthing/ layout, the project/session/space HTTP APIs, or space discovery.
---

# Skill: Projects & the `lmthing` Server

`lmthing` is the user-facing entry point: a project-aware multi-session web server where users chat with **THING**, create projects, and upload documents/instructions. State lives in a cwd-rooted `.lmthing/` tree:

```
<cwd>/.lmthing/
  system/{global,engineer,architect,solver,deep_research,memory,thing}/   ← materialized by `lmthing init`
  user/                       ← default project
    spaces/                   ← architect-synthesized spaces for this project
    documents/  instructions.md  project.json
  <project>/                  ← additional projects (same shape)
```

## Commands

- **`lmthing init`** (keyless) copies the bundled system spaces into `.lmthing/system/` and scaffolds the default `user` project. Code: `materializeRuntime` in `packages/cli/src/cli/bin.ts` (uses `cpSync` + `defaultSystemSpaceDirs()`).
- **`lmthing`** (no args) launches the multi-session server (`packages/cli/src/server/{serve.ts,session-manager.ts,projects.ts}`). A provider/API key is required. A project session sets `spaceDir = .lmthing/<project>/` (loaded permissively — `requireAgents:false` — since the `thing` agent comes from the merged system spaces), `agentSlug = 'thing'`, `systemSpaceDirs = .lmthing/system/*`, `preloadSpaceDirs = .lmthing/<project>/spaces/*`, and `projectSpacesDir = .lmthing/<project>/spaces`.

## HTTP API

Beyond the existing session/ws routes:

- `GET/POST /api/projects`, `DELETE /api/projects/:id`, `GET/PUT /api/projects/:id/instructions`, `GET/POST /api/projects/:id/documents`
- `GET /api/projects/:id/sessions` (list persisted sessions)
- `GET /api/projects/:id/spaces` (list spaces created under the project — `listProjectSpaces`)
- `POST /api/sessions` accepts `{ projectId }` (default `user`) and an optional `resumeId` to rehydrate a persisted session.
- `POST /api/spaces { name, files }` writes an edited space to disk and returns its `spaceDir`.

## Session persistence

`SessionManager` (`packages/cli/src/server/session-manager.ts`) snapshots each project session to `<root>/<project>/sessions/<sessionId>/`:

- `snapshot.json` — VM scope + history, via `Session`'s `saveSnapshot`.
- `meta.json` — title/createdAt/messageCount.
- `trace.json` — the hub's buffered trace events.

`persistSession` runs (best-effort) after each message and on dispose. Creating a session with `resumeId` loads the snapshot dir, marks `needsResume`, and the next `sendMessage` calls `session.resume(...)`; the persisted trace is replayed into the hub so the WS `trace_snapshot` rebuilds the full execution tree (fixes the "tree collapsed to one row after restore" bug).

## Web UI shell

The web UI shell (project/session sidebar, chat, doc upload + instructions editor, toggleable DevTools panel) is `packages/ui/src/app/AppShell.tsx` and its components (`Sidebar`, `ChatView`, `Composer`, `Message`, `DevPanel`, `ProjectSettings`). `main.tsx` detects the mode (shell vs single-session `?sessionId=` vs `?trace=` replay) and mounts `AppShell`. (The older single-file `shell.tsx` + 3-pane `App.tsx` are superseded and no longer mounted.)

## Space discovery

Preloaded project spaces are delegatable (in the registry); the server also enumerates them via `GET /api/projects/:id/spaces` (`listProjectSpaceDirs`), so the UI can list a project's synthesized spaces across sessions.
