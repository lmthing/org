# lmthing

An LLM agent runtime where the model drives programs by writing TypeScript, executed one statement at a time in a QuickJS WASM sandbox. The user-facing surface is **THING** — an orchestrator agent that talks to you and routes each request to the right specialist (research, coding, a brand-new agent it builds on demand, or a full **app** it builds for a project — see [Project-as-application](#project-as-application) below).

For the runtime internals (turn loop, spaces, forks, delegation, system spaces) see [CLAUDE.md](./CLAUDE.md). For the on-disk space/project format see [org/format/](../../org/format/README.md); for the runtime globals and CLI/REST APIs see [org/runtime-globals/](../../org/runtime-globals/README.md) and [org/cli-api/](../../org/cli-api/README.md).

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- A model provider. Put credentials in a `.env` in the directory you run from:

  ```bash
  AZURE_API_KEY=...
  AZURE_RESOURCE_NAME=...
  LM_MODEL_M=azure:DeepSeek-V4-Pro     # model aliases: provider:modelId
  LM_MODEL=M                            # default alias when --model is omitted
  TAVILY_API_KEY=...                    # optional — enables web research
  ```

  Providers: `azure`, `anthropic`, `openai`, `google`, `mistral`, or any OpenAI-compatible endpoint.

## Build

```bash
pnpm install
pnpm build           # builds @lmthing/core, @lmthing/cli
```

This installs the `lmthing` CLI (`libs/cli`). The examples below call the built binary directly; once linked you can just type `lmthing`.

```bash
LM=node\ libs/cli/dist/cli/bin.js   # or: alias lmthing after `pnpm -C libs/cli link --global`
```

## Run

### 1. Initialize a workspace (once per directory)

```bash
cd ~/my-workspace
node /path/to/lmthing/sdk/org/libs/cli/dist/cli/bin.js init
```

This creates `.lmthing/` in the current directory:

```
.lmthing/
  system/     # the runtime: system-global, system-engineer, system-architect, system-research, user-memory, user-thing
  user/       # the default project — spaces/, documents/, instructions.md, project.json
```

`init` is keyless (no API key needed).

### 2. Start the server and chat with THING

```bash
node /path/to/lmthing/sdk/org/libs/cli/dist/cli/bin.js          # bare = launch the server
# or explicitly:  ... serve --port 8080 --model M
```

Open the printed URL. The server serves all three product surfaces as client-side routes on the same origin:

- **`/studio`** (default for unknown hosts) — project and space management IDE. Browse projects and spaces, author space definitions, and chat with THING via the always-on right-side dock.
- **`/computer`** — autonomous computer-use surface. Describe a task; the agent executes it with screen captures streamed back in real time.
- **`/chat`** — the primary conversational interface to THING. Chat with the agent, see projects and spaces in the sidebar.

From any surface you can:

- **Create projects** — each gets its own `.lmthing/<project>/` with isolated spaces, documents, and instructions.
- **Chat with THING** — it answers directly, researches the web, writes code, **builds a new specialist agent** for a recurring task, or **builds a whole app** for the project (see below). Agents THING builds for a project land under `.lmthing/<project>/spaces/` and stay available.
- **Upload documents & instructions** per project — THING reads `instructions.md` as standing guidance and can reference uploaded `documents/`.
- **Save memories** — tell THING a durable preference ("call me X", "I prefer Rust") and it persists it (globally, across projects).

The default project is `user`.

### Driving it headlessly (HTTP API)

The server exposes a JSON API (same origin):

```bash
B=http://localhost:8080
curl -s $B/api/projects                                              # list projects
curl -s -X POST $B/api/projects -d '{"name":"Research"}'             # create one
SID=$(curl -s -X POST $B/api/sessions -d '{"projectId":"user"}' | jq -r .sessionId)
curl -s -X POST $B/api/sessions/$SID/message -d '{"content":"What is a hash map?"}'
curl -s $B/api/sessions/$SID/state                                   # ASCII execution tree
```

Per-project document/instructions routes: `GET/PUT /api/projects/:id/instructions`, `GET/POST /api/projects/:id/documents`.

## Project-as-application

A project isn't limited to spaces — it can own a full **application** built on the same pod
runtime. Alongside `spaces/`, a project root can hold:

```
<project>/
  database/<table>.json   # typed SQLite tables (schema = the agent's mental model of the data)
  api/<route>/<METHOD>.ts  # named, typed, worker-isolated Node handlers
  pages/*.tsx              # client-side React, file-based routing, typed data via @app/runtime
  hooks/<slug>.ts          # cron + database triggers (declarative or imperative)
  spaces/<id>/             # project-scoped agents that read/write the app's data
```

Every app surface is **capability-gated** — an agent can touch `db`/`pages`/`api`/`hooks` only
when its `capabilities:` frontmatter grants it (nothing is ambient, not even for THING). You never
write these files by hand: THING **delegates** "build me an app" to the **`system-appbuilder`**
system space, whose `app-architect` plans the app and fans out to least-privilege agents
(`data-modeler`, `page-builder`, `api-author`, `automator`), one authoring call per file.

Finished apps are served by the pod at `/app/<project>/` and distributed through the
**lmthing.store** catalog (`store/projects/<id>/`); the pod's CLI server installs one via
`GET /api/apps` + `POST /api/apps/install`. Five ship today: `blog`, `health`, `kitchen`, `trips`,
`demo-feed`.

- Quick authoring reference → [org/format/project/](../../org/format/project/README.md) · skill `.claude/skills/project-app.md`
- Full design (serving/domains, safety, boot sequence) → [org/app/](../../org/app/README.md)
- Concrete worked examples → `blog-application.md`, `health-application.md`, `kitchen-application.md`, `trips-application.md`

## Other ways to run (development)

```bash
# One-shot against a specific space (no project model):
node libs/cli/dist/cli/bin.js --space ./fixtures/cooking "make pasta"

# Interactive REPL, or the single-session DevTools web UI:
node libs/cli/dist/cli/bin.js --space ./fixtures/cooking --repl
node libs/cli/dist/cli/bin.js --space ./fixtures/cooking --web 3000

# Keyless, deterministic (scripted mock provider — no API key):
node libs/cli/dist/cli/bin.js --space ./fixtures/cooking --mock ./fixtures/cooking/mock-ask.mjs "..."
```

## Test

```bash
pnpm test            # vitest (co-located unit + keyless CLI/server suites)
pnpm typecheck       # tsc --noEmit, strict — the sole quality gate
LM_LIVE=1 pnpm vitest run libs/cli/src/testing/live-llm.test.ts   # real model
```
