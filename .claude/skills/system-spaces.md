---
name: system-spaces
description: Load when adding a system space, host primitive, or fork role, or when referencing the system-spaces catalog / host-injected VM globals.
---

# Skill: System spaces, host primitives, and fork roles

**Capabilities are spaces, not ad-hoc globals.** A small set of **system spaces** is always loaded and merged into every user space (and into forks/delegates), so every agent gets a coding toolkit for free. There is no separate "skills" concept — to extend agents, add a system space.

## Where things live

- `packages/core/system-spaces/{system-global,system-engineer,system-architect,system-deep-research,user-memory,user-thing}/` — the always-loaded baseline spaces (NOT under `src/`; read from disk at runtime). Function-only spaces need no `package.json` (a package.json would trigger `npm install` on load).
- `packages/core/src/spaces/system.ts` — `loadSystemSpaces`, `mergeSystemInto`, `defaultSystemSpaceDirs`, `systemFunctionSources`/`systemFunctionsBundled`/`systemFunctionNames` (these return ONLY the `system-global` space's functions — `GLOBAL_SPACE_NAME`). The delegate runner (`delegate/delegate.ts`) also calls `systemFunctionSources`/`systemFunctionsBundled` to merge system functions into delegate VMs via `RunDelegateOpts.systemSpaces`.
- `packages/core/src/globals/host-tools.ts` — the synchronous host substrate the system functions build on.
- `packages/core/src/fork/roles.ts` — `fork({ role })` capability profiles + preambles.

## Adding a function to an existing system space

1. Add `packages/core/system-spaces/<space>/functions/<name>.ts` exporting a function **named exactly like the file**, with an explicit return type and a leading doc comment (both are surfaced to the model — the return type lets it destructure results; the `# Built-in Tools` section renders the AST signature + first doc line).
   ```typescript
   /** One-line description shown in the system prompt. */
   export function myTool(path: string): { ok: boolean; data: string; error?: string } {
     const r = readFileRaw(path);              // host primitives are in scope
     return r.ok ? { ok: true, data: r.content } : { ok: false, data: '', error: r.error };
   }
   ```
2. Build (`pnpm --filter @lmthing/core build`) — system spaces are loaded by the running CLI from `packages/core/system-spaces/`, resolved relative to `dist/` via `defaultSystemSpaceDirs()`.
3. It is now available in EVERY space with no agent-config change.

Rules for system functions:
- They run in the QuickJS VM and may use the host primitives (`execShell`, `fetch`, `readFileRaw`, `writeFileRaw`, `typecheckSource`, `process.env`, `console`) and `display`. They may NOT call value-yielding globals (`ask`/`fork`/…).
- Keep them self-contained (one function per file). Helpers defined at top level in the same file leak to global scope across files — inline them or name them uniquely.
- State stores belong under `process.env['LMTHING_SPACE_DIR'] + '/.lmthing/'` (see `memory`/`todo`). `.lmthing/` is gitignored.

## Adding a new system space

Create `packages/core/system-spaces/<name>/functions/*.ts`, then add `<name>` to `SYSTEM_SPACE_NAMES` in `spaces/system.ts`. Function-only spaces load fine — `loadSystemSpaces` uses `loadSpace(dir, { requireAgents: false })`. A space can also ship `components/` and `knowledge/`, which merge too.

## Adding a host primitive

Only when a system-space function can't be built cleanly on the existing primitives (e.g. binary-safe file I/O vs. fragile shell heredocs). Add a `setGlobal('<name>', …)` in `injectHostTools` (`globals/host-tools.ts`), gate it on the read-only `profile` if it mutates, and declare it in `LIBRARY_DTS`. It is automatically available in both session and fork VMs.

## Adding / changing a fork role

`fork({ role: 'explore' | 'plan' | 'general' })` — `packages/core/src/fork/roles.ts`:
- `rolePreamble(role)` — the system-prompt preamble (shared context-firewall tail + role specifics).
- `roleProfile(role)` — the `HostToolsProfile` (read-only roles return `{ allowWrite: false }`, which withholds `writeFileRaw` and blocks mutating shell commands **at injection** — enforcement, not just instruction).

To add a role: extend the `ForkRole` union + the `PREAMBLES`/profile maps here, add it to `ForkGlobalOpts`/`ForkTask` (`globals/fork.ts`, `fork/fork.ts`) and the `ForkOpts.role` union in `LIBRARY_DTS`. Read-only enforcement is verified in `fork/roles.test.ts` (an explore fork's `writeFile` must fail and create no file).

## Context economy

System tools and roles exist to keep context small: `display()` output stays out of the VARIABLES block; `fork({ role: 'explore' })` is a firewall returning only a summary; `session.continue()` auto-summarizes long history (`maxHistoryTurns`). Reinforce this in any new agent's `instruct.md`.

## Testing

- Host primitives: inject into a bare VM, `evalCode` a call, assert the returned object (`globals/host-tools.test.ts`).
- System functions: load the space, inject like `Session` does (transpile + `evalScript`), exercise round-trips (`spaces/system-functions.test.ts`).
- Loader/merge: `spaces/system.test.ts`.
- **Always also live-test** new features by running the built CLI against a fixture space with a real model and inspecting the `--trace` NDJSON.

## Reference: the system spaces

Capabilities are **spaces**, not ad-hoc core globals. A set of baseline "system spaces" is **always loaded and merged into every user space** (and into forks/delegates). Two things are universal: (1) every system space's **agents** are merged in and **universally delegatable**; (2) only the **`system-global`** space's **functions** are universally injected — every agent gets that coding toolkit for free. All OTHER system-space functions (the architect's, the deep-research analyst's, …) are **scoped to their owning agent**: they reach an agent solely via that agent's `functions:` frontmatter (`getAgentFunctions`), so they never leak into unrelated agents' prompts/VMs. The user space wins on any name collision.

Located in `packages/core/system-spaces/{system-global,system-engineer,system-architect,system-deep-research,user-memory,user-thing}/` (resolved relative to the built core; materialized into `.lmthing/system/` by `lmthing init`). Configure via `SessionOpts.systemSpaceDirs`, CLI `--system-spaces`/`--no-system-spaces`, or env `LM_SYSTEM_SPACES`.

- `system-global` — the always-injected toolkit (function-only, no agent): `readFile`, `writeFile`, `editFile`, `glob`, `grep`, `listDir`, `webSearch` (Tavily, needs `TAVILY_API_KEY`), `webFetch`, `remember`/`recall`/`recallAll`/`forget` (durable JSON at `<spaceDir>/.lmthing/memory.json`), `todoWrite`/`todoRead` (checklist persisted to `.lmthing/todos.json`). **These are the only universally-injected functions.**
- `system-engineer` — coding agent (agent def + `TaskInput` component); `delegate` to it from any space.
- `system-architect` — meta-agent that builds spaces **one file at a time** via the per-file builders (`writeAgentFile`, `writeTaskFile`, `writeKnowledgeIndex`/`writeKnowledgeOption`, `writeFunctionFile`, `writeComponentFile`) + `validateSpace` + `listScaffoldedSpaces`, plus the `synthesize_and_run` / `iterate_space` tasklists; `delegate` to it to synthesize new agents at runtime. **Synthesis routes through the `synthesize_and_run` tasklist** (the instruct's PRIMARY WORKFLOW makes the model emit just `tasklist('synthesize_and_run', {topic, goal})` then `delegate()` — the DAG deterministically runs understand→research→build(file-by-file)→validate→register so a weak model can't truncate the program). `writeFunctionFile` typechecks each function the moment it's written (via the host `typecheckSource` primitive).
- `system-deep-research` — Deep Research Analyst (`tavilySearch`, `extractKeyFacts`, `formatCitation` + `research_report` tasklist: broad→deep→extract→synthesize). Always delegatable as `delegate('system-deep-research', 'researcher', 'research_report', { query, context })` — the architect uses it for all web research. `tavilySearch` never throws: on failure (incl. HTTP 432 quota) it returns `{ results: [], error }` and tasks resolve gracefully with empty results.
- `user-thing` — **THE main user-facing orchestrator** (single agent, model-driven, no forced tasklist). Triage per request: answer directly, `delegate('system-deep-research', …)` for research, `delegate('system-architect', 'architect', 'synthesize_and_run', …)` to build a specialist, `delegate('system-engineer', …)` to code, or `delegate('user-memory', …)` to save/recall user facts. Default agent in the `lmthing` project server. Reads per-project `instructions.md` + `documents/` (rooted at the project dir).
- `user-memory` — thin agent wrapping the universal `remember`/`recall`/`recallAll`/`forget`. THING delegates to it to persist facts about the user. Because a delegate runs with the **target** space's dir as `LMTHING_SPACE_DIR`, the store lives at `<memory space>/.lmthing/memory.json` — i.e. global across projects. NOTE: an agent that calls a bare `system-global` tool it doesn't declare (like memory's `remember()`) needs the universal toolkit in the delegate VM's typecheck overlay too — `runDelegate` folds `systemFunctionSources` into both the overlay and the system block.

**Empty-placeholder rule:** an empty user agent (an `agents/<slug>/` dir with no instruct.md → no instructBody + no actions) or an empty user tasklist dir (no `.md` files) does NOT shadow a real system one. (An empty `fixtures/architect/agents/architect/` dir silently shadowing the system architect — stripping its instructions/actions/`defaultAction` — was the root cause of repeated architect failures.)

## Reference: host-injected VM globals

Beyond library globals (ask, sleep, fork, etc.), the QuickJS VM has host-injected globals available to space functions — the thin substrate the system spaces build on (single source of truth: `packages/core/src/globals/host-tools.ts`, used by both the session VM and fork VMs):

- `process.env` — Node.js environment variables (read-only shim); includes `LMTHING_SPACE_DIR` (an **absolute** path) for state stores.
- `fetch(url, opts?)` — Synchronous HTTP using curl under the hood; returns `{ ok, status, text(), json() }`.
- `execShell(cmd)` — Synchronous shell command execution; returns `{ ok, stdout, stderr }` (read-only fork roles block mutating commands). Runs with `cwd = space dir`.
- `readFileRaw(path, {offset?,limit?})` — Binary-safe file read via Node fs; returns `{ ok, content, lines, truncated, error? }`.
- `writeFileRaw(path, content)` — File write via Node fs (no shell quoting); returns `{ ok, bytes, error? }`. Withheld in read-only fork roles.
- `typecheckSource(src)` — Typecheck a standalone TS source string against the library DTS; returns `{ ok, errors: string[] }`. Pure/read-only (available in every role). "Cannot find name" diagnostics (TS2304/2552) are dropped so a function referencing sibling space functions isn't falsely rejected; syntax + real type errors surface. Used by the architect's `writeFunctionFile` to validate a function the moment it's written.
- `console.log/warn/error` — Routes through renderHost.log.

**Path rooting:** `readFileRaw`/`writeFileRaw` resolve **relative** paths against the space dir (`LMTHING_SPACE_DIR`), not `process.cwd()` (`session.ts` `execCommand` uses `cwd: spaceDir`). So a fork that writes `work/candidate.ts` and another that reads `work/candidate.ts` agree regardless of where the CLI was launched. Absolute paths pass through untouched.

