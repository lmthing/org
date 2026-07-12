# fs globals are space-rooted — a footgun for project-authoring agents

**Status:** partially fixed (correct project-rooted reads added; the *strip* below is the remaining
design pass). **Severity:** correctness / model-reliability. **Found:** live, scenario 06 (Act V).

## The problem

The raw host fs primitives and their `system-global` wrappers all resolve relative paths against
`LMTHING_SPACE_DIR` — the calling agent's OWN space dir:

| Global | Kind | Roots at | Defined |
|---|---|---|---|
| `execShell(cmd)` | raw | `cwd: spaceRoot` | `core/globals/host-tools.ts:114,120` |
| `readFileRaw(path)` | raw | `resolve(spaceRoot, path)` | `host-tools.ts:155,99` |
| `writeFileRaw(path, c)` | raw | `resolve(spaceRoot, path)` | `host-tools.ts:191,196` |
| `listDir` / `readFile` / `writeFile` / `editFile` / `glob` / `grep` | `system-global` fn wrappers over the above | `spaceRoot` | `system-spaces/system-global/functions/*` |

These are **always injected** (`bootstrap.ts:130`) and appear in **every agent's DTS** (raw:
`library-dts.ts:103,116,117`; wrappers via the universal overlay). The per-agent `functions: []`
frontmatter does NOT strip the system-global wrappers (that allowlist only filters an agent's *own*
functions — `spaces/agent.ts` + `delegate.ts:184`).

For a **top-level project THING session** `spaceDir == projectRoot` (`session-manager.ts:1105,1134`),
so the mis-rooting is invisible. But for a **delegated system-space agent** (e.g.
`system-appbuilder/automator`), `spaceDir = <root>/system/spaces/system-appbuilder` (its SOURCE
tree) while `projectRoot = <root>/<projectId>` (`delegate.ts:197,199`). So when such an agent tries
to inspect the PROJECT with `ls database` / `readFile('database/x.json')`, it silently hits its own
space dir → `No such file or directory` → (observed) the model fabricates success.

This is the **read-twin** of the already-filed
`delegate-writes-resolve-against-system-space-dir.md` (a writing delegate polluting the system-space
source tree). The project-app writers (`db`, `writeProject*`) are the projectRoot-scoped siblings
that behave correctly (`exec/bootstrap.ts:64`, `app/authoring/globals.ts:319-346`) — evidence the
intended pattern for project work is "use projectRoot-bound globals, not raw fs."

## Done (commit `e4f7d3e`)

Added the missing **project-rooted read primitives** — the read-side twins of the writers:
- `listProjectDir(dir)` → files under `<projectRoot>/<dir>` (missing dir ⇒ `entries: []`)
- `readProjectFile(path)` → a project file's text
Both resolve against `projectRoot` (`app/authoring/globals.ts`, `safeResolve`), injected in
`injectAppGlobals` gated on `projectRoot` + a db grant, DTS `PROJECT_READ_DTS` on any db grant. The
automator instruct now uses these and forbids `execShell`/`ls`/`readFile` for project data (the
phantom project-scoped `listDir` guidance was removed).

## Remaining — the *strip* (design decision: gate space-rooted fs OFF project-authoring agents)

Instruct-only guidance is demonstrably unreliable (S06: the model reached for `ls database` anyway).
The robust fix is to **not inject the space-rooted fs tools into a project-authoring agent at all**,
so the model *cannot* reach the footgun. Proposed mechanism:

1. **A capability profile flag `spaceFs: boolean`** (`exec/capability.ts` `CapabilityProfile`),
   default `true` in `sessionCapabilities`/`forkCapabilities`/`delegateCapabilities` (⇒ zero behavior
   change for existing agents).
2. **`injectHostTools` honors it** — when `spaceFs === false`, skip `execShell` / `readFileRaw` /
   `writeFileRaw` (`host-tools.ts`), and the DTS assembler omits `EXEC_SHELL_DTS` /
   `WRITE_FILE_RAW_DTS` / the `readFileRaw` line (`bootstrap.ts:324-325`, `library-dts.ts:103`).
3. **Filter the system-global wrappers** (`listDir`/`readFile`/`writeFile`/`editFile`/`glob`/`grep`)
   out of `opts.functions` at the three merge sites (`delegate.ts:184`, the session + fork
   equivalents) when `spaceFs === false`, and out of the universal DTS overlay.
4. **Thread the flag from agent frontmatter** — a new agent field (e.g. `spaceFs: false`) parsed in
   the space loader and passed to the child-VM builder. Set it `false` on `system-appbuilder`
   agents (automator, app-architect, data-modeler, …) — pure project-authoring, they only need
   `db`/`writeProject*`/`listProjectDir`/`readProjectFile`.
5. **Audit every agent** into space-authoring (KEEP the space-rooted tools — `system-engineer`,
   `system-architect` scaffolding, `user-memory`, and `user-thing` which legitimately author within
   their own space/workspace) vs project-authoring (strip). Only the latter set `spaceFs: false`.

Tests: a project-authoring agent's DTS must NOT contain `execShell`/`readFileRaw`/`writeFileRaw`/the
wrappers, and a call to them must fail typecheck; the space-authoring agents keep them (regression).

## Also worth documenting

Update the CLAUDE.md "Top gotchas" (the `execShell`/`readFileRaw` rooting note) to spell out the
delegate case: a delegated system-space agent's `LMTHING_SPACE_DIR` is its SOURCE tree, so the
space-rooted fs tools mis-root there — project work must use `db`/`writeProject*`/`listProjectDir`/
`readProjectFile`, which are projectRoot-scoped.
