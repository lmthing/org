---
name: project-server
description: Load when working on the lmthing project server, session persistence, the .lmthing/ layout, the project/session/space HTTP APIs, or space discovery.
---

# Skill: Projects & the `lmthing` Server

`lmthing` is the user-facing entry point: a project-aware multi-session web server where users chat with **THING**, create projects, and upload documents/instructions. State lives in a cwd-rooted `.lmthing/` tree:

```
<cwd>/.lmthing/
  system/{system-global,system-engineer,system-architect,system-deep-research,user-memory,user-thing}/   ← materialized by `lmthing init`
  user/                       ← default project
    spaces/                   ← architect-synthesized spaces for this project
    documents/  instructions.md  project.json
  <project>/                  ← additional projects (same shape)
```

## Commands

- **`lmthing init`** (keyless) copies the bundled system spaces into `.lmthing/system/` and scaffolds the default `user` project. Code: `materializeRuntime` in `packages/cli/src/cli/runtime-init.ts` (uses `cpSync` + `defaultSystemSpaceDirs()`), which also writes a per-space shipped-hash manifest (`.lmthing/system/.shipped.json`).
- **On every boot** `ensureRuntime` → `syncSystemSpaces` reconciles materialized system spaces against the shipped source: a PRISTINE copy (matching the recorded hash) auto-adopts a source/image update; a locally-modified copy is held back (adopt with `--adopt-system-spaces` / `LM_ADOPT_SYSTEM_SPACES=1`, which backs it up first). So source edits and image upgrades flow in without a stale-copy surprise.
- **`lmthing`** (no args) launches the multi-session server (`packages/cli/src/server/{serve.ts,session-manager.ts,projects.ts}`). A provider/API key is required. A project session sets `spaceDir = .lmthing/<project>/` (loaded permissively — `requireAgents:false` — since the `thing` agent comes from the merged system spaces), `agentSlug = 'thing'`, `systemSpaceDirs = .lmthing/system/*`, `preloadSpaceDirs = .lmthing/<project>/spaces/*`, and `projectSpacesDir = .lmthing/<project>/spaces`.
- **`lmthing --request "<message>"`** — headless single-shot mode. Materializes the runtime if needed, runs the THING agent against `--space` (or `process.cwd()` by default), streams output to stdout with no TUI, then exits. Pipe-safe (`InkRenderHost` plain mode). Combine with `--agent`, `--model`, `--mock`, `--trace`, and other single-run flags.

  ```bash
  lmthing --request "Research TypeScript decorators and create a space about them."
  lmthing --space ./my-project --request "Summarize the documents folder."
  lmthing --mock fixtures/mock.ts --request "What is 2+2?"  # keyless
  echo | lmthing --request "One-liner answer only."          # fully piped
  ```

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
