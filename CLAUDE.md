# CLAUDE.md — sdk/org

This is a **git submodule** (`lmthing/org`) containing the open-source packages that power the LMThing agent runtime. It is a self-contained pnpm monorepo with three packages.

---

## Packages

| Package | Name | Purpose |
|---------|------|---------|
| `cli/` | `lmthing` | Agent orchestrator: provider resolution, spaces loading, system prompt, agent loop, CLI binary, HTTP/WS server |
| `repl/` | `@lmthing/repl` | Core runtime engine: sandbox, streaming, context management, hooks, catalog, knowledge, session |
| `ui/` | `@lmthing/thing-ui` | React components for the web view render surface |

`cli` bundles `@lmthing/repl` inline at build time. `ui` is consumed as TypeScript sources (not compiled separately).

---

## Workspace Config

```
sdk/org/
├── cli/
├── repl/
├── ui/
└── pnpm-workspace.yaml   # declares: cli, repl
```

`pnpm-workspace.yaml` only lists `cli` and `repl`. The `ui/` package is referenced by `cli` via a Vite path alias (`@lmthing/thing-ui` → `../ui/src`).

---

## Build

Both packages build with **tsup** (library) and the `cli` additionally builds a web UI with **Vite** first.

```bash
# From sdk/org/cli/
pnpm build          # Vite web → embed assets → tsup (index.js + bin.js)
pnpm build:web      # Vite web UI only
pnpm dev:web        # Vite dev server for web UI

# From sdk/org/repl/
pnpm build          # tsup (index.js + context/prompt.js)
```

**Build outputs:**

| Package | Entry | Output |
|---------|-------|--------|
| `cli` | `src/index.ts` | `dist/index.js` + `.d.ts` |
| `cli` | `src/cli/bin.ts` | `dist/bin.js` (executable; aliases: `lmthing`, `lmt`) |
| `repl` | `src/index.ts` | `dist/index.js` + `.d.ts` |
| `repl` | `src/context/prompt/index.ts` | `dist/context/prompt.js` |

Always build `repl` before `cli` if making changes to both.

---

## Testing

```bash
pnpm test           # run all tests
pnpm test:watch     # watch mode
pnpm typecheck      # tsc --noEmit
```

Test framework: **Vitest**. Each subsystem has a co-located `*.test.ts` file. Integration and benchmark tests are under `repl/src/integration/` and `repl/src/benchmark/`.

---

## Package Relationships

```
repl/src/   ←── bundled by ───  cli/src/
     ↑                               ↑
     └── ui/src/ (thing-web-view) ───┘
              (path alias, not compiled)
```

- Changes to `repl/src/` require rebuilding `repl` before the CLI picks them up (or use workspace resolution at dev time).
- Changes to `ui/src/` are picked up immediately by `cli` (path alias resolves to source).
- `cli/tsup.config.ts` marks `@lmthing/repl` as bundled (not external), so the published CLI is self-contained.

---

## Key Entry Points

| Entry | File | Use |
|-------|------|-----|
| `runAgent()` | `cli/src/cli/run-agent.ts` | Full pipeline: load spaces → session → agent loop → server |
| `AgentLoop` | `cli/src/cli/agent-loop.ts` | Orchestrates turns, context refresh, token budget |
| `Session` | `repl/src/session/session.ts` | State machine wrapping sandbox + stream |
| `Sandbox` | `repl/src/sandbox/sandbox.ts` | `vm.Context` execution environment |
| `StreamController` | `repl/src/stream/stream-controller.ts` | Token → parse → hooks → execute pipeline |
| `createThingSession()` | `repl/src/thing/entry.ts` | High-level THING agent entry point |

---

## Provider Resolution

Providers are resolved in `cli/src/providers/`. Supported:

`openai/*`, `anthropic/*`, `google/*`, `azure/*`, `groq/*`, `mistral/*`, `cohere/*`, `bedrock/*`, or any OpenAI-compatible endpoint (custom).

Provider peer deps are optional — only install the ones you need.

---

## Submodule Notes

- This directory is a git submodule. Changes here are committed separately from the parent monorepo.
- The parent repo references this submodule at `sdk/org/` — update the parent's submodule pointer after committing here.
- The parent `pnpm-workspace.yaml` includes `sdk/org/cli` and `sdk/org/repl` directly, so workspace installs work from the root.

---

## Detailed Reference

| Topic | Document |
|-------|----------|
| Agent system architecture, 12 globals, context management, hooks, session lifecycle, security, spaces | [cli/CLAUDE.md](cli/CLAUDE.md) |
| Neural harness model, cognitive loop, semantic/episodic memory, file I/O blocks | [repl/README.md](repl/README.md) |
| Agent system prompt spec | [cli/docs/agent-system-prompt/](cli/docs/agent-system-prompt/) |
| Host runtime contract | [cli/docs/host-runtime-contract/](cli/docs/host-runtime-contract/) |
| UX specification | [cli/docs/ux-specification/](cli/docs/ux-specification/) |
| Test strategy | [repl/TESTING.md](repl/TESTING.md) |
