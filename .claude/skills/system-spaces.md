# Skill: System spaces, host primitives, and fork roles

**Capabilities are spaces, not ad-hoc globals.** A small set of **system spaces** is always loaded and merged into every user space (and into forks/delegates), so every agent gets a coding toolkit for free. There is no separate "skills" concept — to extend agents, add a system space.

## Where things live

- `packages/core/system-spaces/{fs,web,memory,todo}/` — the toolkit, as ordinary space functions (NOT under `src/`; read from disk at runtime). No `package.json` (a package.json would trigger `npm install` on load).
- `packages/core/src/spaces/system.ts` — `loadSystemSpaces`, `mergeSystemInto`, `defaultSystemSpaceDirs`, `systemFunctionSources`/`systemFunctionsBundled`/`systemFunctionNames`. The delegate runner (`delegate/delegate.ts`) also calls `systemFunctionSources`/`systemFunctionsBundled` to merge system functions into delegate VMs via `RunDelegateOpts.systemSpaces`.
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
2. Build (`pnpm --filter @repl/core build`) — system spaces are loaded by the running CLI from `packages/core/system-spaces/`, resolved relative to `dist/` via `defaultSystemSpaceDirs()`.
3. It is now available in EVERY space with no agent-config change.

Rules for system functions:
- They run in the QuickJS VM and may use the host primitives (`execShell`, `fetch`, `readFileRaw`, `writeFileRaw`, `process.env`, `console`) and `display`. They may NOT call value-yielding globals (`ask`/`fork`/…).
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
