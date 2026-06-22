# lmthing

An LLM agent runtime where the model drives programs by writing TypeScript, executed one statement at a time in a QuickJS WASM sandbox. The user-facing surface is **THING** — an orchestrator agent that talks to you and routes each request to the right specialist (research, coding, or a brand-new agent it builds on demand).

For the runtime internals (turn loop, spaces, forks, delegation, system spaces) see [CLAUDE.md](./CLAUDE.md).

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
pnpm build           # builds @lmthing/core, @lmthing/agent-ui, @lmthing/cli
```

This installs the `lmthing` CLI (`packages/cli`). The examples below call the built binary directly; once linked you can just type `lmthing`.

```bash
LM=node\ packages/cli/dist/cli/bin.js   # or: alias lmthing after `pnpm -C packages/cli link --global`
```

## Run

### 1. Initialize a workspace (once per directory)

```bash
cd ~/my-workspace
node /path/to/lmthing/sdk/org/packages/cli/dist/cli/bin.js init
```

This creates `.lmthing/` in the current directory:

```
.lmthing/
  system/     # the runtime: global, engineer, architect, solver, deep_research, memory, thing
  user/       # the default project — spaces/, documents/, instructions.md, project.json
```

`init` is keyless (no API key needed).

### 2. Start the server and chat with THING

```bash
node /path/to/lmthing/sdk/org/packages/cli/dist/cli/bin.js          # bare = launch the server
# or explicitly:  ... serve --port 8080 --model M
```

Open the printed URL. In the web UI you can:

- **Create projects** — each gets its own `.lmthing/<project>/` with isolated spaces, documents, and instructions.
- **Chat with THING** — it answers directly, researches the web, writes code, or **builds a new specialist agent** for a recurring task. Agents THING builds for a project land under `.lmthing/<project>/spaces/` and stay available.
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

## Other ways to run (development)

```bash
# One-shot against a specific space (no project model):
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking "make pasta"

# Interactive REPL, or the single-session DevTools web UI:
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --repl
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --web 3000

# Keyless, deterministic (scripted mock provider — no API key):
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --mock ./fixtures/cooking/mock-ask.mjs "..."
```

## Test

```bash
pnpm test            # vitest (co-located unit + keyless CLI/server suites)
pnpm typecheck       # tsc --noEmit, strict — the sole quality gate
LM_LIVE=1 pnpm vitest run packages/cli/src/testing/live-llm.test.ts   # real model
```
