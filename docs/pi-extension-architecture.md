# LMThing vs. Pi — and how LMThing becomes a Pi extension

> **Status: exploration / design note.** Companion to [`dsh-plugin-architecture.md`](./dsh-plugin-architecture.md).
> Citations point at Pi (`github.com/earendil-works/pi`, packages `agent` / `coding-agent` / `ai`) and at
> this repo (`libs/core/src/**`, `APPFORMAT.md`). Not grounded against `org/docs`.

## TL;DR

Pi is a deliberately **minimal, single-process JSON tool-calling coding agent**. Its author states the
ethos outright: *"Pi keeps the core small and pushes workflow-specific behavior into extensions, skills,
prompt templates… It intentionally does not include built-in MCP, sub-agents, permission popups, plan
mode, to-dos, or background bash"* (`packages/coding-agent/docs/usage.md:302-304`). The core loop shape
— turn → stream assistant → execute JSON tool calls → repeat — is **fixed substrate**; you *hook and
decorate* it through a VS Code-style `ExtensionAPI`, you do not restructure it
(`packages/agent/src/agent-loop.ts:155-275`).

LMThing is the opposite kind of thing: the model **writes streamed TypeScript** into a QuickJS VM, and
value-yielding calls suspend the VM and re-prompt (`libs/core/src/eval/turn-loop.ts#runTurnLoop`).
LMThing *is* a loop; Pi *has* a fixed one.

**The headline result is an asymmetry with the `dsh` mapping:**

- Against **`dsh`**, LMThing plugs in **as the loop** — a *sibling replacement* — because `dsh` exposes a
  loop seam (`ctx.agentLoop`). (See the companion note.)
- Against **Pi**, LMThing plugs in **under the loop** — a *child nesting* — as **one Pi tool** whose
  `execute` runs an entire LMThing code-writing sub-agent. Pi's model calls `code({ task })`; LMThing
  does all the multi-step orchestration (forks, delegates, tasklists) *inside that single tool call*,
  and returns one result.

The encouraging part: the bridge is **thin**, because LMThing's whole host contract is three small
seams, and a Pi tool's `execute(toolCallId, params, signal, onUpdate, ctx)` hands you a natural
counterpart for each.

---

## 1. LMThing vs. Pi, side by side

| Dimension | **Pi** | **LMThing** |
|---|---|---|
| Model's action surface | JSON tool calls (`ToolCall = {name, arguments}`, `packages/ai/src/types.ts:360`) | writes **streamed TypeScript**, one statement at a time (`eval/turn-loop.ts`) |
| Loop | fixed & minimal, not swappable; `runLoop` is a free function (`agent-loop.ts:155`) | the loop *is* the product; statement pipeline + yield-suspend + re-prompt |
| Extension model | **event-hooks + registration API on one process** (VS Code-style); one `ExtensionAPI` per extension (`coding-agent/src/core/extensions/types.ts:1198`) | capability-gated runtime **globals** + on-disk **spaces**/**projects** loaded by the host |
| "Tools" | `AgentTool.execute(...)` returning `AgentToolResult` (`agent/src/types.ts:386`) | typed globals injected into the VM, gated by `CapabilityProfile` |
| Permissions | **none by default** — *"Pi runs with all permissions"* (`docs/containerization.md:3`); isolate externally | `CapabilityProfile` drives inject **and** DTS in lockstep; `@consent` fails closed (`exec/capability.ts`, `globals/consent.ts`) |
| Skills | `SKILL.md` + `name`/`description` frontmatter, **progressive disclosure** (name+desc in prompt, model `read`s the body, `harness/skills.ts:38`) | `knowledge/**/*.md` lazily loaded via the `loadKnowledge` yield |
| Slash commands | `.pi/prompts/*.md`, filename = command, `$1..$@` args (`docs/prompt-templates.md`) | space **actions** / tasklists |
| Sub-agents / workflow | **none built-in** (compose from `steer`/`followUp` queues + `ctx.fork`) | forks, delegates, tasklists (a real DAG orchestrator, `tasklist/orchestrator.ts`) |
| Served web app | **none** — TUI / print / RPC / SDK only; the `server` pkg is CBOR-RPC, not HTTP hosting | **project-as-application** served at `/app/<id>/` (`APPFORMAT.md`) |
| Providers | `pi-ai` unified multi-provider + OAuth; `pi.registerProvider` (`types.ts:1391`) | opaque `streamFn` seam |
| Ethos | minimal, unopinionated; *build it as an extension* | opinionated code-first runtime with batteries included |

**Where they rhyme.** Both stream from a provider-agnostic LLM layer; both use `SKILL.md`-style
markdown skills with near-identical frontmatter and progressive disclosure; both keep the LLM boundary
narrow (Pi's `StreamFn`, LMThing's `streamFn`). These rhymes are what make the bridge small.

**Where they diverge hardest.** (1) *Action surface*: JSON calls vs. written code. (2) *Loop
mutability*: Pi's loop is closed; LMThing's is the whole game. (3) *Safety*: Pi has **no** permission
model (by design); LMThing's capability gating is central. (4) *Surfaces*: Pi is a **terminal** agent
(rich TUI, no web); LMThing ships web chat/studio and **serves web apps**.

That last pair drives every limitation below.

---

## 2. The integration seam: what a Pi extension can and cannot do

An extension is `export default (pi: ExtensionAPI) => void | Promise<void>`
(`types.ts:1519`), loaded from `.pi/extensions/*.ts` (project) or `~/.pi/agent/extensions/` (global) via
jiti; inside Pi's binary, Pi's own packages are exposed as virtual modules so an extension can
`import { … } from "@earendil-works/pi-ai"` etc. (`loader.ts:50-74, 689-737`). The `ExtensionAPI`
surface (`types.ts:1198-1437`):

- **`registerTool(tool: ToolDefinition)`** — add an LLM-callable tool. `execute(toolCallId, params,
  signal, onUpdate, ctx: ExtensionContext)` returns `AgentToolResult`; `onUpdate` streams live progress;
  `renderCall`/`renderResult` draw TUI; `promptSnippet`/`promptGuidelines` inject into the system prompt
  (`types.ts:449-498`). **This is the primary seam.**
- **Loop interception hooks** (each a typed `on(event, handler)`): `context` (rewrite messages before
  each request), `before_agent_start` (replace the system prompt / inject a message), `tool_call`
  (block or mutate args), `tool_result` (rewrite), `before_provider_request` (replace the payload),
  plus the full lifecycle (`agent_start`/`turn_*`/`message_*`/`tool_execution_*`) (`types.ts:1203-1244`).
- **`registerCommand`** (slash commands), `registerProvider` (LLM providers + OAuth), `registerShortcut`
  / `registerFlag`, `registerMessageRenderer` / `registerEntryRenderer`.
- **Actions**: `sendUserMessage` / `sendMessage` (with `triggerTurn`, `deliverAs: "steer"|"followUp"`),
  `appendEntry` (persist non-LLM state), `setActiveTools` (dynamically hide/show tools), `exec`.

The `ctx: ExtensionContext` a tool's `execute` receives carries `ui` (a rich TUI surface —
`select`/`confirm`/`input`/`notify`/`custom`), `sessionManager`, `model` / `modelRegistry`, `cwd`,
`signal`, `compact()`, `hasUI`, `mode` (`types.ts:307-347, 131-282`).

**What is deliberately absent:** any "replace the agent loop" seam, any capability/permission machinery,
any sub-agent/workflow framework, any web-app host. So LMThing cannot *become* Pi's loop through this
API. It nests underneath it.

---

## 3. LMThing as a Pi extension — the design

One package, `@lmthing/pi-lmthing` (an `ExtensionFactory` + bundled skills/prompts, installable as a Pi
package or dropped in `.pi/extensions/`). It does three things.

### 3a. The `code` tool — LMThing's REPL as a nested sub-agent

`pi.registerTool({ name: "code", parameters: { task, space?, agent?, action? }, execute })`. Inside
`execute`, spin up a LMThing `Session` and run `runTurnLoop`, bridging its three host seams —
`TurnLoopDeps` (`eval/turn-loop.ts#TurnLoopDeps`) — onto what Pi's `execute` already provides:

| LMThing seam (`TurnLoopDeps`) | Bridged to, inside Pi's `execute` |
|---|---|
| `streamFn: (StreamOpts) => Promise<StreamSession>` | **`pi-ai`** — the extension imports `@earendil-works/pi-ai` (or reuses `ctx.model` / `ctx.modelRegistry`). LMThing borrows Pi's providers, OAuth, and cost tracking. Both are provider-agnostic streaming: LMThing's `StreamSession.textStream`/`abort()` ↔ Pi's `AssistantMessageEventStream` text-deltas / `signal`. |
| `processYield: (YieldRequest) => Promise<unknown>` | **LMThing's own `yield-router`**, unchanged. `fork` / `delegate` / `tasklist` / `loadKnowledge` / `db.*` / `writeProject*` all resolve *inside this one tool call*. Leaf effects that overlap Pi (`fetch`, shell) may stay internal or route out via `ctx.exec` / `pi.exec`. |
| `renderHost: RenderHost` | **`onUpdate` + `ctx.ui`**. `display()` → stream statements/results as `tool_execution_update`s (and/or `pi.appendEntry` + a registered entry renderer); `ask()` → `ctx.ui.input`/`select`/`confirm` **when `ctx.hasUI`** — interactive ask genuinely works from inside a Pi tool, since `ctx` carries the TUI. Headless forks/delegates need no `ask` at all. |

`execute` returns an `AgentToolResult` whose `content` is the LMThing turn's final value + a compact
transcript, with rich `details` for a custom `renderResult`. **From Pi's side this is one tool call**;
LMThing runs the entire code-writing episode within it. LMThing's `CapabilityProfile` lives inside the
tool and is invisible to Pi — which means the bridge *adds* the capability-gating and `@consent` safety
that Pi, by design, lacks. A useful selling point when Pi is otherwise "all permissions."

Why the tool is the right home (and not a hook-based reshaping): you *could* strip Pi's tools
(`setActiveTools([])`), inject the DTS + LMThing system prompt via `before_agent_start`/`context`, and
register a single `eval_statement` tool the model must call each turn — bending Pi's JSON loop into a
statement-REPL. But it fights the grain: Pi ends a turn when a message has **no** tool calls
(`agent-loop.ts:247`), Pi streams *whole* assistant messages (no stream-abort-on-yield), and the
`VARIABLES` re-prompt must be faked through tool results. The nested-tool keeps LMThing's real loop
intact and is a thin adapter, not a fight.

### 3b. The space loader — spaces mapped onto Pi's on-disk surfaces

The same extension scans a space dir (`spaces/load.ts#loadSpace`) and emits Pi registrations:

| Space part | Pi surface |
|---|---|
| `knowledge/**/*.md` | **Pi skills** — near-identical `name`/`description` frontmatter + progressive disclosure; a *direct format bridge* (`harness/skills.ts`). LMThing's `loadKnowledge` yield ↔ the model `read`ing a `SKILL.md`. |
| agent `instruct.md` + actions | **Pi slash commands** (`pi.registerCommand("agent:foo", …)`) that invoke the `code` tool scoped to that agent/action; the persona ships as the tool's `space`/`agent` params. |
| `functions/*.ts` | either **register as Pi tools** (if you want Pi's own model to call them directly) or keep them inside LMThing's sandbox (default). |
| `tasklists/`, forks, delegates | run **inside** the `code` tool — Pi has no workflow/sub-agent engine, so orchestration stays where it belongs. A tasklist can also be surfaced as a command that triggers the tool with that `action`. |
| `components/view` + `components/form` (React) | **impedance mismatch.** Pi renders **pi-tui `Component`s**, not React web (`registerMessageRenderer`/`registerEntryRenderer`). View/form components degrade to text or a TUI approximation. (This is exactly what `dsh` *could* host via web conversation nodes and Pi cannot.) |

### 3c. Projects — the weakest fit, made explicit

The authoring surface (`writeProject*`, `db.*`, `apiCall`) runs fine inside the `code` tool (or as
registered Pi tools). But **serving** the app at `/app/<id>/` has no home in Pi: Pi is TUI/print/RPC/SDK
only, and its `server` package is a CBOR-over-socket remote-session protocol, **not** an HTTP app host.
So the `code` tool would boot LMThing's own app server (from `libs/cli`) as a side process and hand Pi a
URL. Pi orchestrates the build; it does not host the result. State-of-the-world honesty: project-apps
are the one subsystem that doesn't fold into Pi — they sit *beside* it.

---

## 4. The asymmetry, stated plainly

The same LMThing decomposes onto the two harnesses in opposite directions, and the reason is a single
architectural fact about each host:

- **`dsh` exposes the loop as a seam** (`ctx.agentLoop`), plus a Cordis service container and capability
  seams. So LMThing becomes a **peer**: a driver bundle that *is* the loop, with spaces as a bundle and
  projects as a `ctx.projectRuntime` seam. Deep, native, "everything is a plugin."
- **Pi freezes the loop and extends around it** with an event-hook + registration API. So LMThing
  becomes a **child**: one `code` tool that nests the whole REPL, plus a space→skills/commands loader.
  Shallow, clean, and bounded — Pi's model doesn't know it delegated to a code-writing agent, it just
  called a tool.

Neither is "better"; they answer different questions. `dsh` asks *"what is the harness made of?"* and
lets you swap any part. Pi asks *"what is the smallest core that stays out of your way?"* and lets you
bolt anything beside it. LMThing — a maximal, opinionated, code-first runtime — is a **loop** to `dsh`
and a **tool** to Pi.

The practical punchline: because LMThing's host contract is just `streamFn` + `processYield` +
`RenderHost`, and a Pi tool's `execute` supplies a counterpart for all three, "LMThing as a Pi
extension" is a genuinely small adapter you could ship as `.pi/extensions/lmthing.ts` — and, Pi being
self-extensible, one Pi could plausibly write it for you.
