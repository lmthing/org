# LMThing-as-`dsh`-plugins — an architecture mapping

> **Status: exploration / design note.** This is not a description of how LMThing works today, and it
> is not grounded against `org/docs` (it references a second codebase). It answers one question: *if
> DeepSeek Harness (`dsh`) is the substrate and "everything is a plugin," what would LMThing's three
> subsystems — the TypeScript REPL/turn-loop, the space format, and the project-app format — become?*
>
> Citations point at `dsh` (cloned from `github.com/deepseek-ai/deepseek-harness`) and at this repo
> (`libs/core/src/**`, `APPFORMAT.md`). Read it alongside `CLAUDE.md`.

## TL;DR

LMThing and `dsh` are the same *kind* of thing — an agent harness — built on two different execution
philosophies:

- **`dsh`**: the model emits **JSON tool calls**; a [Cordis](https://github.com/cordiverse/cordis)
  plugin tree turns each call into a guarded tool execution. *"Everything is a plugin"* means Cordis
  **services** claiming `ctx.<key>` plus **capability seams** (Service Definition / Provider / Consumer).
  Optionally, **Code Mode** (`ctx.codeRuntime`) lets the model write one whole program that calls host
  bindings — but that is a single-shot, run-to-completion capability, not the loop itself.
- **LMThing**: the model emits **TypeScript, one statement at a time, streamed**; the host typechecks,
  transpiles, and evals each statement inside a QuickJS-WASM VM; a **value-yielding** call suspends the
  VM, aborts the stream, resolves host-side, and re-prompts the model with a `VARIABLES` block. The
  "tools" are runtime-globals gated by a single `CapabilityProfile` that drives **both** injection and
  the ambient DTS.

**The answer is yes — cleanly, with exactly one architectural caveat.** All three subsystems decompose
onto `dsh` seams that already exist. The one thing that is *not* a tool-or-codeRuntime plugin is the
REPL **execution model** itself: streaming-statement + yield-suspend + re-prompt is a *loop shape*, so
it belongs at `dsh`'s `ctx.agentLoop` (the driver) seam, not at `ctx.codeRuntime`. Everything else —
spaces, projects, and the capability gating that ties them together — drops onto existing seams. In
other words, an LMThing deployment becomes **one `dsh` profile** stacking a handful of **bundles**:
a REPL-driver bundle, a space-loader bundle, and a project-runtime bundle.

The punchline: *"everything is a plugin" is already LMThing's architecture, expressed differently.*
LMThing's system-space merge **is** `dsh`'s bundle layering; LMThing's `CapabilityProfile` **is** a
`dsh` agent-preset's scoped composition; LMThing's runtime-globals **are** `dsh` tools/seams; LMThing's
REPL **is** one `ctx.agentLoop` driver (plus, optionally, one `ctx.codeRuntime` backend).

---

## 0. `dsh`'s extension model in one screen

Everything below leans on three `dsh` mechanisms (`deepseek-harness/docs/`):

1. **Cordis plugin = a Service.** A plugin is a function/object/class taking `(ctx, config)`; it claims
   a stable `ctx.<key>`, declares required services with `inject`, validates a `Config` schema, and
   installs everything through **reversible effects** (`ctx.effect`, `ctx.on`, service registration) so
   teardown/HMR unwind predictably (`cordis-primer.md:9-13`, `cordis-api/registry.md:62-118`).
2. **Capability seams.** A swappable capability = **Service Definition** (interface) + **Service
   Provider** (impl) + **Consumer** (usually a model-facing tool). One provider swap changes the whole
   product; the ~60-seam registry is `capability-seams.md:412-469`. The turn loop itself is a seam
   (`ctx.agentLoop` implementing the `ctx.agents` interface) — *"there is no privileged core to patch"*
   (`architecture.md:11-14, 47-49`).
3. **Profiles & bundles.** A running `dsh` is a plugin tree composed at boot from ordered layers. A
   **bundle** ships config rows + code; a **profile** stacks bundles; both declare themselves in a
   `package.json` `dsh` field, and later layers **patch** rows by id. `dsh-base` is always first
   (`architecture.md:16-37`). Third-party plugins are ordinary npm packages tagged `dsh-plugin`
   (`README.md:40`).

The registries that matter here (`ctx.tools`, `ctx.skills`, `ctx.agentPresets`) are **host + per-scope
layered**: a read merges the global layer with the viewing scope's chain, nearest wins
(`skills.md:9-17`). Hold onto that — it is the exact shape of LMThing's system-space merge.

---

## 1. The TypeScript REPL / turn-loop → a `dsh` `ctx.agentLoop` driver

### What it is in LMThing

The model writes TS one statement at a time; `runTurnLoop` (`libs/core/src/eval/turn-loop.ts#runTurnLoop`)
splits statements out of the token stream (`sandbox/boundary.ts`), typechecks each against the ambient
DTS (`typecheck/tsc.ts#runTsc`), transpiles (`typecheck/transpile.ts`), and evals it in a per-turn
QuickJS-WASM VM (`sandbox/quickjs.ts#createVM`, `#evalStatement`). A value-yielding global pushes a
`YieldRequest` (`eval/yield.ts`); the loop **aborts the model stream**, resolves the yield via
`processYield`, re-binds results host-side (`turn-loop.ts#bindYieldResults`, preferring `vm.getVar`),
and re-prompts with a `VARIABLES` block.

The research found the entire host contract is three small seams (`eval/turn-loop.ts#TurnLoopDeps`):

| LMThing seam | What it is | `dsh` equivalent |
|---|---|---|
| `streamFn: (StreamOpts) => Promise<StreamSession>` | the **only** LLM boundary; `StreamSession.textStream` + `abort()` (`eval/stream-types.ts`) | **`ctx.llm`** adapter seam — `stream(GenerateOptions): AsyncIterable<StreamChunk>` (`llm-streaming.md:653-701`). Near 1:1: text-delta chunks ↔ `textStream`, `signal` ↔ `abort()`. |
| `processYield: (YieldRequest) => Promise<unknown>` | the **only** tool/effect boundary; most hosts use `eval/yield-router.ts#routeCommonYield` | **`ctx.tools.execute`** + the guarded pipeline (`tools/pre-execute` → guard → `tools/execute` → `tools/post-execute`, `tools.md:576-719`). Each yield *kind* becomes a tool or a seam call. |
| `renderHost: RenderHost` | `display()` / `ask()` / `log()` IO boundary (`session/types.ts#RenderHost`) | `session/event` feed + Web Client **conversation nodes**; `ask()` ↔ `ctx.approval` / user-question seam. |

### Why it is a *driver*, not a `ctx.codeRuntime` provider

`dsh` already ships a "model writes a program that calls host bindings" seam —
`ctx.codeRuntime.run({ program, bindings })` (`code-runtime.md`). It is tempting to make LMThing's VM a
`ctx.codeRuntime` provider with `language: 'typescript'`, `isolation: 'worker-thread'` (→ a new
`'quickjs-wasm'` substrate), exposing the runtime-globals as `CodeBindingNamespace`s. **This is the
wrong home**, for a precise reason:

- `codeRuntime.run()` is **whole-program, run-to-completion**: the model writes the entire program up
  front, the runtime bridges each `await tools.foo()` to the host invisibly, and the program returns
  one value + logs (`code-runtime.md:9-60`). There is no mid-program re-prompt.
- LMThing's loop is **incremental and model-in-the-loop**: it aborts the stream on a yield and
  *re-prompts* so the model writes the next statement *after seeing the last result*. The yield also
  crosses the host bridge with non-JSON values (promises, VM handles via `getVar`/`setVar`), whereas
  `codeRuntime` bindings are lossless-JSON only (`code-runtime.md:114-130`).

Aborting the stream and re-prompting is **turn-loop behavior**. So the faithful home is `dsh`'s driver
seam: `ctx.agentLoop` is *"the default driver implementing [the `ctx.agents`] interface"* and can be
replaced by mounting a different one (`architecture.md:47-49`). LMThing's `runTurnLoop` becomes a
plugin — call it `dsh-agent-loop-lmthing` — that:

1. assembles the DTS + system prompt from **`ctx.systemPrompt`** (its `tools(provider)` schema
   contributions become DTS fragments instead of JSON schemas; `system-prompt.md:120-135`),
2. streams from **`ctx.llm`**,
3. runs statements in QuickJS,
4. on a yield, dispatches through **`ctx.tools.execute`** (the yield-router becomes a thin adapter),
5. writes each statement + `VARIABLES` block to **`ctx.sessions`** as durable `SessionEvent`s (to honor
   `dsh`'s *"model-visible means logged"* invariant so fork/resume/telemetry keep working,
   `architecture.md:93-96`),
6. re-prompts.

> A secondary, legitimate option is to **extend** the `code-runtime` seam contract with a
> suspend/resume/re-prompt variant, but the architecture doc is explicit that changing the loop updates
> the map — a new driver is the lower-friction, more honest path.

The QuickJS-WASM sandbox (`sandbox/quickjs.ts`) is self-contained and provider-agnostic; it ships inside
the driver bundle (and can *also* back a plain `ctx.codeRuntime` provider for non-interactive Code Mode).

### The property that rides inside the driver

LMThing's signature invariant — **"not granted ⇒ not injected AND absent from the DTS,"** so an
unavailable call is a *typecheck error the model retries against*, not a runtime throw
(`session/types.ts:56-63`, `exec/bootstrap.ts#buildAmbientDts`) — has two halves in `dsh`:

- **injection/visibility** already exists per-scope: `ctx.tools.restrict(filter)` + scoped registration
  on `agent.ctx` make a tool *"vanish from the child's prompt AND refuse to execute (one visibility)"*
  (`subagent.md:80-88`). That is exactly *not-granted ⇒ not-injected-and-not-callable*.
- **schema-in-prompt** already exists: a granted tool's schema joins assembly, a withheld one is absent
  (`system-prompt.md:120-135`).

What `dsh` does **not** give for free is the *typecheck-error-instead-of-runtime-refusal* experience,
because `dsh` tools are JSON calls validated at execute-time, not TS typechecked before execution. That
property is intrinsic to the REPL driver (it needs the DTS overlay + `runTsc`), so it lives **inside**
the `dsh-agent-loop-lmthing` plugin, which reconstructs the DTS from the same per-scope tool-visibility
set `dsh` already tracks. Worth stating plainly: the *value* of LMThing's approach (self-correction
against types before any effect runs) is a property of the driver, not of `dsh`'s tool pipeline.

---

## 2. The space format → a space-loader plugin over existing seams

A **space** is a directory of capabilities (`libs/core/src/spaces/load.ts#Space`): agents, tasklists,
knowledge, functions, components, events. "Loading a space" becomes **one Cordis plugin** (a
`SpaceLoader`) that scans the on-disk format *unchanged* and emits scoped registrations. Each part maps
to a seam:

| Space part (`libs/core/src`) | `dsh` seam |
|---|---|
| `agents/<slug>/instruct.md` — system prompt + config + grants (`spaces/load.ts#loadAgent`) | an **agent preset** (`ctx.agentPresets`, a dir with `agent.cordis.yml`) whose standing composition mounts the granted tools/seams; the `instruct.md` body → a `ctx.systemPrompt.section` persona (`preset/agent-presets`, `system-prompt.md:41-68`). |
| agent `capabilities:` frontmatter (`spaces/capabilities.ts#parseCapabilities`) | **which** tools/seams the preset registers on that agent's scope, i.e. `ctx.tools.restrict` + scoped registration. The `CapabilityProfile` *is* the preset's scoped composition (see §4). |
| `canDelegateTo` (tri-state allowlist, must not be normalized, `load.ts:36-44`) | a `ctx.tools.guard` on the delegation tool + which `ctx.subagents` targets are visible in the scope; `[]` = withhold the delegate tool entirely (absent from DTS). |
| `tasklists/` — DAG of agent + code nodes, `dependsOn`/`condition`/`forEach`/`onFail` (`spaces/tasklist-load.ts`, `tasklist/orchestrator.ts`) | `dsh`'s **`packages/workflow`** DAG seam; agent nodes → `ctx.subagents` forks (spawn/fork providers), code nodes → `ctx.codeRuntime.run()` or plain host functions; `forEach` → workflow fan-out. |
| `defaultAction` — deterministic host-driven first turn (`load.ts`) | an **`agent/pre-step`** waterfall listener that runs a workflow instead of a model step (`architecture.md:88`). |
| `knowledge/` — lazily-loaded markdown domains/fields | a **`ctx.skills`** provider! Knowledge ≈ skills: `list()`/`get()` lazy load, model-invocable (`skills.md:29-51`). `loadKnowledge` yield ↔ the `skill({name})` tool. |
| `functions/*.ts` — TS the agent may call | under the REPL driver: injected globals; under native `dsh`: `ctx.tools.register` or `CodeBindingNamespace` functions. |
| `components/view/*.tsx` (`display()`) + `components/form/*.tsx` (`ask()`) | Web Client **Chat nodes** — a `ConversationNodeDefinition` + keyed renderer (`architecture.md:122`). |
| `events/*.ts` — emitter defs (`spaces/emitter-def.ts#EmitterDef`) | event producers → `dsh`'s `packages/jobs` / `packages/schedule` (cron) + the durable `SessionEventMap`. |
| roles `explore`/`plan`/`general` — read-only withheld **at injection** (`fork/roles.ts`, `exec/capability.ts#intersectAppCaps`) | a scoped preset that simply does not register mutating tools + a persona section. |
| delegates — `delegate()` runs another agent autonomously (`delegate/registry.ts`) | **`ctx.subagents`** — a named provider; a space delegate is a subagent whose preset is that space's agent; LMThing delegate sessions ↔ `dsh` **continuable children** (`subagent.md:114-160`). |

### The structural match worth naming: system-space merge = bundle layering

LMThing always loads `SYSTEM_SPACE_NAMES` and **merges them into every user space**; `system-global`'s
functions are universal while every other system space's functions are agent-scoped
(`spaces/system.ts`). That is *precisely* `dsh`'s two mechanisms working together:

- **profile/bundle layering** — system spaces = base-bundle rows always composed; a user space = a
  bundle stacked on top (`architecture.md:16-37`);
- **host + per-scope layered registries** — *"host rows land in the global layer while a plugin mounted
  by an agent preset's standing composition lands in that preset's layer … the nearest layer's entry
  wins"* (`skills.md:9-17`). Universal `system-global` functions = global-layer registration; other
  system spaces' agent-scoped functions = scoped-layer registration.

LMThing already invented `dsh`'s layered-registry semantics for its own merge rules. This is the
strongest evidence that spaces are *natively* a `dsh` bundle format.

---

## 3. The project-app format → a `ctx.projectRuntime` seam + tools + a web bundle

A **project** is a live application the agent builds and serves: a SQLite DB, typed API handlers, a UI
that is **validated JSON view-spec data (not TSX)**, an app shell, hooks, and nested spaces
(`APPFORMAT.md`, `libs/core/src/exec/app-globals.ts`). It has two facets, and each has a clean `dsh`
home.

### 3a. The agent-facing authoring surface → a capability-gated tool bundle

The typed root-scoped writers (`writeProjectTable/Api/View*/Hook/Event/Function`, `db.*`,
`listProjectDir`, `readProjectFile`, `apiCall`, `emitEvent`) are the *only* persistence surface —
**there is no generic filesystem** on any model surface (`app-globals.ts#injectAppGlobals`). In `dsh`:

- each writer becomes a **tool** (`ctx.tools.register`): `write_project_table`, `write_project_api`, …
- *withholding the generic filesystem* is expressed by **not composing `tool-fs`** into the
  project-builder agent's preset — `dsh`'s `ctx.fs` is the generic FS seam (`filesystem.md`), and
  LMThing deliberately never grants it; you reproduce that by scope, not by prose.
- the per-call table-scope check (`app-globals.ts#assertTableAllowed`) becomes a **`ctx.tools.guard`**
  on the `db_*` tools (`tools.md:515-525`).
- `@consent`-marked yields, which **fail closed** with no prompter (`globals/consent.ts`,
  `eval/yield-router.ts`), map to a `tools/pre-execute` decision routed through **`ctx.approval`**
  (deny-by-default when unattended).
- `apiCall` (the one value-yielding app global) is just another tool whose Input/Output schema comes
  from the handler's `Input`/`Output` exports.

The research's key observation — *core deliberately stops at the writers; the DB engine, view-spec
validator, boot/serve, and code-node worker live in `libs/cli` and are injected as `AppGlobalImpls`* —
is textbook `dsh` **Service Definition / Provider split**:

- define a seam **`ctx.projectRuntime`** whose interface **is** `AppGlobalImpls` (write/read/db/serve);
- ship a provider `project-runtime-local` wrapping better-sqlite3 + the view-spec renderer + the app
  server;
- the writer tools are **Consumers** of it. Persistence maps to `dsh`'s **`ctx.storage`** /
  `storage-domain` (typed data forms, `capability-seams.md:426-427`); hooks (cron/event/webhook) map to
  `packages/schedule` + `packages/jobs` + event producers.

### 3b. The application runtime (build, serve, live-republish) → the extensions subsystem

Serving the app at `/app/<projectId>/` with live republish and approval maps directly to `dsh`'s
**extensions** subsystem, `ctx.dynamicCordisRunner` (`extensions.md`): the agent **defines versioned
Cordis packages with a Host half and a browser Client half, gated by approval**, run inside the web app.
A LMThing project ≈ a `dsh` dynamic Cordis plugin:

- DB + API handlers = the **Host half**; view specs + app shell = the **Client half**;
- `writeProject*` = the `define` / `run` operations; live republish = `run` a new immutable Package
  version; approval-gating = the built-in `cordis/request-run` approval flow (`extensions.md:331-346`).

One deliberate divergence to record: LMThing's UI is a **closed JSON view-spec** (no expressions, no
TSX — 8 sections / 24 elements, natively renderable with no WebView, `APPFORMAT.md §3`), whereas
`dsh`'s dynamic plugins ship *arbitrary* approved Client code. Mapping LMThing in means shipping the
**view-spec renderer as the constrained Client half** rather than adopting `dsh`'s open model — a design
choice that *keeps* LMThing's safety property, not a blocker.

---

## 4. The capability model is the unifying thread

`CapabilityProfile` (`libs/core/src/exec/capability.ts:78-128`) is one object that drives **both**
`createChildVM`'s injection and `buildAmbientDts`'s DTS in lockstep. Its `dsh` equivalent is **per-agent
scoped composition** — the set of seam registrations mounted on `agent.ctx`. `dsh`'s own "where new
behavior goes" table says it outright (`architecture.md:108-128`):

- *"Give one session a different capability set → compose an agent preset; a service row there needs an
  `isolate` realm."*
- *"Scope a registration to one agent → use that agent's `agent.ctx`."*

So the correspondence is exact:

| LMThing | `dsh` |
|---|---|
| `CapabilityProfile` | an agent preset's standing scoped composition |
| `sessionCapabilities` / `forkCapabilities` / `delegateCapabilities` (`capability.ts:134-159`) | three presets (interactive / headless-non-orchestrating / headless-orchestrator) |
| a runtime-global (`ask`, `fork`, `delegate`, `db.*`, `writeProject*`, `emitEvent`, …) | a tool or seam call registered on the scope |
| "not granted ⇒ not injected AND absent from DTS" | tool not registered on scope ⇒ absent from prompt assembly AND not executable (the *typecheck-error* refinement rides inside the REPL driver, §1) |
| per-node `narrowAppCaps` + read-only `intersectAppCaps` | scoped `ctx.tools.restrict` composed before the child scope is mounted |
| pod-conditional dropping of `TEAM_*`/`DESKTOP_ONLY_*` caps (`capabilities.ts:465-472`) | profile/bundle selection per deployment (`disabled` field, loader overlays) |

---

## 5. Honest frictions (what is *not* free)

1. **The loop shape is a driver, not a tool.** Streaming-statement + yield-suspend + re-prompt is
   `ctx.agentLoop`, not `ctx.codeRuntime` (§1). This is the one real architectural decision; get it
   wrong and you fight the seam.
2. **Typecheck-as-gating is the driver's own contribution.** `dsh` gives per-scope visibility but not
   "unavailable ⇒ typecheck error." The DTS overlay + `runTsc` ship inside the driver bundle.
3. **Model-visible means logged.** LMThing keeps `accumulatedContext`/snapshots; a good `dsh` citizen
   must render every statement + `VARIABLES` block as `SessionEvent`s so fork/resume/telemetry derive
   from the log (`architecture.md:93-96`). Conceptually aligned, real work.
4. **Non-JSON host-bridge values.** `getVar`/`setVar` pass promises and VM handles; `ctx.codeRuntime`
   bindings are lossless-JSON only. This is *why* it is a driver, and it is confined to the driver.
5. **New isolation substrate.** QuickJS-WASM is a new value for `code-runtime`'s `isolation` label
   (`'worker-thread'|'process'|'container'`); minor, it is a diagnostic label, not a security claim.
6. **Closed view-spec vs open dynamic Client code** (§3b) — keep LMThing's constrained renderer.

## 6. The concrete decomposition

An LMThing deployment = **one `dsh` profile** stacking:

- `dsh-base` (adapters, tools, persistence, sandbox/approval, settings, telemetry) — unchanged.
- **`dsh-lmthing-runtime`** (bundle) — the `ctx.agentLoop` REPL driver + the QuickJS sandbox + the DTS
  overlay/typecheck + a `ctx.codeRuntime` `quickjs-wasm` provider; adapters that expose the
  base runtime-globals (`ask`→approval, `fork`/`delegate`/`tasklist`→`ctx.subagents`+`packages/workflow`,
  `fetch`/`readDocument`→tools).
- **`dsh-lmthing-spaces`** (bundle) — the `SpaceLoader` plugin (a `ctx.skills` provider for knowledge,
  a `ctx.agentPresets` provider for agents, `ctx.tools`/subagent registrations for functions/delegates,
  Chat-node renderers for components) + the system-space bundles composed at the base layer.
- **`dsh-lmthing-projects`** (bundle) — the `ctx.projectRuntime` seam + `project-runtime-local` provider
  (better-sqlite3 + view-spec renderer + app server) + the `writeProject*`/`db_*`/`apiCall` tools with
  their guards + a `dsh-web-app`-style route for `/app/<projectId>/`, or the extensions subsystem for
  live-republish.

Nothing in LMThing is left over. The REPL is a driver; the spaces are a bundle; the projects are a seam
+ provider + tool bundle + web route; and the `CapabilityProfile` that binds them is `dsh`'s scoped
agent-preset composition. *"Everything is a plugin"* turns out to be a restatement of what LMThing
already does — the difference is only that LMThing spells "tool" as "a typed global you may call from
streamed TypeScript."
