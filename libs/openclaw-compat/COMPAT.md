# OpenClaw compatibility — feasibility & gap report

Status: **foundation, now proven against one real extension** (Phase 5,
"OpenClaw messaging extensions as-is"). The first increment proved the
host↔plugin seam with a synthetic fixture (`test/echo-plugin/`); a second
increment (below) loads a REAL OpenClaw extension's entry code AS-IS —
Tavily — and runs its actual `register(api)` call sequence against this
package's compat api.

## Confirmed packaging facts (given, not re-derived here)

- `openclaw` is a single MIT-licensed npm package (v2026.6.11). Its subpath
  exports provide `openclaw/plugin-sdk/*` (dozens of subpaths — `plugin-entry`,
  `channel-entry-contract`, and many more).
- Channel extensions are **separate** npm packages (e.g. `@openclaw/slack`)
  with a `peerDependency` on `openclaw` and their own runtime deps
  (`@slack/bolt`, `ws`, ...).
- `@openclaw/slack` is **Socket Mode** — a persistent outbound WebSocket to
  Slack, not an inbound webhook. It needs an always-on/warm process, not
  lmthing's webhook ingress, and is incompatible with scale-to-zero pods.
- A plugin's runtime entry is either:
  - `definePluginEntry({ id, name, description, register(api) {...} })` from
    `openclaw/plugin-sdk/plugin-entry` — this package's target shape, or
  - `defineBundledChannelEntry({...})` from
    `openclaw/plugin-sdk/channel-entry-contract` — a channel-specific bundling
    descriptor (identifiable by a `plugin.specifier` field). **Not** loadable
    by this foundation (`loadPlugin` throws `UnsupportedCompatError`); see
    "Next increments" below.
- `register(api)` receives `OpenClawPluginApi` — 40+ `register*` methods
  (`registerTool`, `registerHttpRoute`, `registerChannel`, `registerProvider`,
  `registerGatewayMethod`, ...) plus nested namespaces (`api.session`,
  `api.agent`, `api.lifecycle`, `api.runtime`, ...).
- Package metadata lives in `package.json#openclaw` (`extensions: ["./index.ts"]`,
  optionally `channel: {...}`) plus an `openclaw.plugin.json` manifest (`id`,
  `contracts.tools`, `configSchema`, `activation`).

## What this increment proves

`loadPlugin(dir, api)` reads `package.json#openclaw.extensions[0]` +
`openclaw.plugin.json#id`, transpiles the entry `.ts` with esbuild, evaluates
it (CJS eval, same pattern as `@lmthing/cli`'s hook loader), and calls its
`register(api)`. The `api` passed in (`createCompatApi`) is a Proxy: a
handful of methods are real, everything else throws
`UnsupportedCompatError('api.<path> is not implemented in @lmthing/openclaw-compat')`
instead of silently no-opping.

The `test/echo-plugin/` fixture is **synthetic** — it cannot `import` the
real `openclaw/plugin-sdk/plugin-entry` (this package has no dependency on
`openclaw`), so it defines a local, identity-shaped `definePluginEntryLocal`
to stand in for it. It registers one tool (`echo`) and one HTTP route
(`POST /echo`) whose handler calls `api.runtime.subagent.run(...)`. The test
suite (`src/loader.test.ts`) drives this with a fake `CompatHost` and asserts
the full loop: tool registered → route mounted → handler invocation reaches
`host.runAgent` → its result flows back out through the route's response.

## `api` methods: implemented vs. stubbed

| Method / namespace                  | Status | Notes |
|---|---|---|
| `registerTool(tool)` / `registerTool(factory, { name })` | **Implemented** | Accepts BOTH the object form (`{ name, description, parameters, execute }`) and OpenClaw's factory form (`(ctx) => tool`, second arg `{ name }` — used by Tavily's `index.ts`: `api.registerTool((ctx) => createTavilySearchTool(api, ctx), { name: "tavily_search" })`). Factory form is invoked with a minimal `ctx` object; the resolved tool must have an `execute` function or it throws. Recorded in `PluginRegistry.tools`; `execute` directly callable off the registry (lmthing has no separate tool-calling registry yet). |
| `registerHttpRoute({ method, path, handler })` | **Implemented** | Recorded in `PluginRegistry.httpRoutes` + forwarded to `host.mountRoute`. |
| `registerChannel(registration)` | **Partial** | Recorded in `PluginRegistry.channels`; best-effort extraction of an `inbound`/`send` pair from common shapes (`onMessage`/`handleInbound`/`inbound`, `send`). No actual routing (webhook binding, Socket Mode connection, etc.) — that's a later increment. |
| `registerWebSearchProvider(provider)` | **Implemented (record-only)** | Recorded in `PluginRegistry.providers` as `{ kind: 'webSearch', provider }`; not wired into any lmthing search pipeline. Proven against Tavily's real `register(api)`, which calls this directly. |
| `registerProvider(provider)` / `registerEmbeddingProvider(provider)` / `registerWebFetchProvider(provider)` | **Implemented (record-only)** | Same pattern as `registerWebSearchProvider`, with `kind: 'model' \| 'embedding' \| 'webFetch'` respectively. Added pre-emptively alongside `registerWebSearchProvider` (structurally identical `register*Provider` shape) — not yet exercised against a real extension that calls them. |
| `runtime.subagent.run({ sessionKey, message, provider?, model? })` | **Implemented** | Calls `host.runAgent({ sessionKey, message, agentRef: provider ?? model })`. |
| `log(msg)` / `logVerbose(msg)` | **Implemented** | No-op formatting; forwarded to `host.log`. |
| `runtime.*` (anything but `subagent.run`) | **Throws** | e.g. `runtime.subagent.spawn`, any other `runtime.*` property. |
| `registerGatewayMethod` and all other `register*` not listed above | **Throws** | Not implemented. |
| `session`, `agent`, `lifecycle`, and any other namespace | **Throws** | Accessing the namespace itself or any property on it returns a nested throwing proxy — `api.session.getUser()` fails with a path-specific message. |

Every unimplemented path throws `UnsupportedCompatError`, whose message is
always `unsupported in @lmthing/openclaw-compat: <path> is not implemented in @lmthing/openclaw-compat`
so failures are greppable and point at exactly what a plugin touched.

## Loading a real extension (Tavily) — proven

This increment loads Tavily's REAL `extensions/tavily/index.ts` (vendored
verbatim from `github.com/openclaw/openclaw` — see `test/tavily/index.ts`,
byte-for-byte the same source `gh api
repos/openclaw/openclaw/contents/extensions/tavily/index.ts` returns) and
runs its actual `register(api)` call sequence — unmodified — against this
package's compat `api`. `src/tavily-load.test.ts` proves the full loop:
`loadPlugin` resolves `{ id: 'tavily' }`, both tools
(`tavily_search`/`tavily_extract`) land in `PluginRegistry.tools` via the
factory form, one web-search provider is recorded, and invoking a registered
tool's `execute` returns the value the factory-built tool object actually
produces.

### What worked unmodified

- The real entry's `import { definePluginEntry } from
  "openclaw/plugin-sdk/plugin-entry"` → `definePluginEntry({ id, name,
  description, register(api) {...} })` → default-export shape — exactly what
  `loadPlugin` already expected.
- The real `register(api)` body, verbatim:
  `api.registerWebSearchProvider(createTavilyWebSearchProvider())` then two
  `api.registerTool((ctx) => createTavilyXTool(api, ctx), { name: "..." })`
  calls. No source edits were needed to run this against the compat api.
- `registerTool`'s **factory form** (Step 3 below) — Tavily doesn't call
  `registerTool` with a plain object like the `echo-plugin` fixture; it
  passes a `(ctx) => tool` factory plus `{ name }`. The compat api now
  detects a function first argument, invokes it with a minimal `ctx`, and
  registers the resulting tool under `opts.name`.
- **Provider recording** — `registerWebSearchProvider` is now implemented
  (record-only) instead of throwing, so Tavily's `register(api)` runs to
  completion instead of aborting on its very first line.

### What was substituted, and why

- **The SDK entry point** (`openclaw/plugin-sdk/plugin-entry` →
  `src/plugin-sdk-shim.ts`). This is a **faithful** substitution, not a
  simplification: the real `definePluginEntry` is itself just an identity
  function (`(def) => def`) that exists for type-checking, not runtime
  behavior — the host always calls `.register(api)` on whatever the entry
  default-exports. `loadPlugin`'s new `moduleOverrides` option
  (`{ "openclaw/plugin-sdk/plugin-entry": { definePluginEntry } }`) redirects
  the real entry's `require("openclaw/plugin-sdk/plugin-entry")` to this
  shim instead of a real `openclaw` npm install.
- **Tavily's own `./src/*` tool/provider factories**
  (`test/tavily/src/tavily-{search,extract}-tool.ts`,
  `tavily-search-provider.ts`) are stubs, NOT vendored — their real
  implementations call `runTavilySearch`/`runTavilyExtract` from
  `./tavily-client.js`, a thin wrapper around the `@tavily/core` npm SDK
  (plus `typebox` for JSON-schema parameter validation). Both are real
  npm dependencies this sandbox cannot install (no npm-registry egress —
  only `gh api`/GitHub is reachable here). Each stub file's header comment
  records the real function's confirmed export signature
  (`createTavilySearchTool(api, ctx)`, `createTavilyExtractTool(api, ctx)`,
  `createTavilyWebSearchProvider()`) and return shape, fetched from GitHub
  before writing the stub, so the stub is faithful to the real contract even
  though its body is synthetic.

### Remaining path to fully-as-installed

1. `npm install openclaw @openclaw/tavily-plugin @tavily/core typebox` in an
   environment with npm-registry egress (this package's own dependency list
   stays untouched — these would live in the *plugin's* `node_modules`, not
   `@lmthing/openclaw-compat`'s).
2. Replace `test/tavily/src/*` stubs with the real vendored files (or point
   `loadPlugin` at an installed `@openclaw/tavily-plugin` package directory
   directly, no vendoring needed).
3. Drop the `moduleOverrides` entirely — with a real `openclaw` install,
   `require("openclaw/plugin-sdk/plugin-entry")` resolves for real via
   `importTsAsCjs`'s `createRequire(file)` fallback (already wired; see Step 1
   of `loadPlugin`'s doc comment).
4. Everything else — `registerTool` factory form, `registerWebSearchProvider`
   recording, `loadPlugin`'s call sequence — needs no further changes; this
   increment already proves it against Tavily's real code.

## What a REAL webhook-mode plugin needs beyond this foundation

1. **Dependencies.** Install `openclaw` (peer of every extension) and the
   specific extension package (e.g. `@openclaw/slack`), plus that package's
   own runtime deps (`@slack/bolt`, `ws`, ...). This foundation intentionally
   has zero dependency on `openclaw`/`@openclaw/*` — adding them is the first
   step of the next increment.
2. **`openclaw/plugin-sdk/*` subpath resolution.** A real entry imports
   `openclaw/plugin-sdk/plugin-entry` (and possibly other subpaths). Our
   `importTsAsCjs` uses a real Node `require`/`import` resolution rooted at
   the entry file, so as long as `openclaw` is an actual installed dependency
   of the plugin's own `node_modules`, this should resolve unmodified — no
   alias shimming needed, *provided* the entry is authored against a real
   `openclaw` install rather than the local-only `definePluginEntryLocal`
   trick used by the test fixture.
3. **`configSchema` / secrets.** `openclaw.plugin.json#configSchema` needs a
   real config-loading path (env vars / vault-backed secrets, matching
   lmthing's existing `connections:` capability pattern for OAuth
   integrations) — not built here.
4. **Much more of `OpenClawPluginApi`.** At minimum `registerProvider` (LLM
   provider registration) and whatever `api.session`/`api.agent` surface the
   target plugin actually calls — determined empirically per-plugin since we
   are not re-typing the full ~2900-line interface.
5. **Channel routing.** `registerChannel` needs to actually dispatch inbound
   events to the registered `inbound` handler and expose `send` outbound —
   currently only recorded.

## Hard blockers

- **Slack = Socket Mode.** `@openclaw/slack` holds a persistent outbound
  WebSocket to Slack's Socket Mode gateway. This is fundamentally
  incompatible with lmthing's scale-to-zero free-tier pods (see
  `project-serverless-freetier-pods` / `project-instant-universal-pod-wake`)
  and with routing through the Triggers webhook ingress — it needs an
  **always-on/warm pod** that itself opens and holds the connection. This is
  a tier/product decision, not a code gap.
- **Trust boundary.** `register(api)` runs a plugin's arbitrary code
  in-process (no separate sandbox — OpenClaw plugins are trusted, full-privilege
  Node code, unlike lmthing's QuickJS-sandboxed agent runtime in
  `@lmthing/core`). Loading a third-party OpenClaw plugin on a pod means that
  plugin's code runs with the same privileges as the pod process — this needs
  an explicit trust/allowlist decision before enabling arbitrary plugin
  installs (as opposed to lmthing-authored ones).

## Next increments (concrete, in order)

1. Wire `CompatHost.mountRoute` to the pod's real HTTP server, behind the
   existing Triggers/webhook ingress path (`server/webhook-manifest.ts` /
   `server/routes/webhooks.ts` in `@lmthing/cli`), and bind `CompatHost.runAgent`
   to `SessionManager.runHeadless`.
2. ~~Add `openclaw` + one real, non-Socket-Mode extension package as an actual
   dependency and attempt loading its real entry...~~ **Done for Tavily**
   (`test/tavily/`, `src/tavily-load.test.ts`) — no real `openclaw`/`@tavily/core`
   dependency was installable in this sandbox (no npm-registry egress), so the
   real entry is vendored verbatim and its one SDK import + `@tavily/core`-backed
   internals are substituted per "Loading a real extension (Tavily) — proven"
   above. This DID surface real `UnsupportedCompatError`s
   (`registerWebSearchProvider`, `registerTool`'s factory form), now
   implemented for real. Remaining: install the real npm packages (see
   "Remaining path to fully-as-installed" above) and re-run with zero
   `moduleOverrides`; try a second, structurally different real extension to
   further pressure-test the api surface.
3. Only after a webhook-mode channel extension is proven end-to-end, revisit
   Slack/Socket Mode as a warm-pod-only, explicitly-opt-in tier feature.
4. ~~`defineBundledChannelEntry` support (currently a hard throw in
   `loadPlugin`)~~ **Done (webhook-mode)** — see "Coverage-widening increments"
   below. Remaining: load the `plugin.specifier` Socket-Mode runtime on a warm pod.

---

## Full compatibility audit — all 145 extensions (2026-07-10)

Every `extensions/<x>/index.ts` was fetched and classified by entry **shape** +
which `api.register*` methods `register()` calls, against the implemented set.

| Verdict | Count | Deciding factor |
|---|--:|---|
| ✅ Functional (baseline) | 4 | `registerTool`/`registerHttpRoute`: **tavily, firecrawl, admin-http-rpc, llm-task** |
| 🟡 Inert (loads, unwired) | ~17 | `registerProvider` (anthropic-vertex, arcee, chutes, clawrouter, copilot-proxy, kimi-coding, sglang, stepfun, tencent, vllm), `registerWebSearchProvider` (brave, exa, searxng, perplexity, parallel, duckduckgo), `registerEmbeddingProvider` (llama-cpp); + no-op `register()` bodies (document-extract, web-readability, open-prose, qa-matrix) |
| ⛔ Rejected → now loadable | 25 | `defineBundledChannelEntry` channels (slack, telegram, discord, whatsapp, signal, matrix, msteams, imessage, sms, line, feishu, googlechat, irc, mattermost, nostr, twitch, tlon, zalo, zalouser, qqbot, raft, clickclack, synology-chat, nextcloud-talk, qa-channel) |
| ❌ Throws (skipped) | ~91 | Unimplemented `register*`: media/speech/image/video/music/embedding/model-catalog providers; `registerCli`/`registerCommand`/`registerService`/`registerMemoryCapability`/`registerAgentHarness`/`registerSandboxBackend`; every `defineSingleProviderPluginEntry` provider (openai, google, deepseek, cerebras, mistral, …) via `registerModelCatalogProvider` |
| ⚙️ Core lib (no entry) | 4 | image/media/video-generation-core, test-support |

**Key structural findings:** (a) there is **no `api.registerWebhookRoutes` method** — OpenClaw's
`webhooks` extension declares a *local* `function registerWebhookRoutes(api)` that calls
`api.registerHttpRoute`; (b) `defineSingleProviderPluginEntry`'s generated `register` always calls
`api.registerModelCatalogProvider` right after `api.registerProvider`, so all ~44 provider plugins
built on it throw; (c) channel entries (`defineBundledChannelEntry`) hide their inbound behind a
`plugin.specifier` (Socket-Mode) + an optional webhook-mode `registerFull`.

## Coverage-widening increments (the "3 wins", implemented 2026-07-10)

1. **Broaden HTTP-route loadability** — `api.logger.{info,warn,error,debug,trace,log}` → `host.log`;
   `registerHttpRoute` tolerates OpenClaw's method-less route shape (default `POST`, still requires
   `path`+`handler`); read-only `api.pluginConfig`/`api.config` (default `{}`, override via
   `createCompatApi(host, registry, { pluginConfig, config })`). Config-reading route plugins (e.g.
   `webhooks`, which early-returns on no routes) now load instead of throwing on a proxy.
2. **Search/fetch providers → agent tools** — `recordProvider` now calls `exposeProviderAsTool`: a
   `webSearch`/`webFetch` provider with a `createTool(ctx)` factory (Brave/Exa/Firecrawl shape) is
   also added to the tool registry as a `tool()`-callable tool, adapting `execute(args)` →
   `(toolCallId, params)`. Best-effort (bad shape/dup/throw → logged, skipped).
3. **Bundled-channel loading** — `loadPlugin` no longer hard-rejects `defineBundledChannelEntry`. The
   `plugin-sdk-shim.ts` `defineBundledChannelEntry` records the channel and runs its webhook-mode
   `registerFull(api)` hook (routes mount on the Triggers ingress); the `plugin`/`runtime` specifier
   modules (Socket-Mode/native runtime) are **not** loaded (deferred, warm-pod). Builtin module shims
   resolve `openclaw/plugin-sdk/{plugin-entry,channel-entry-contract}` without npm egress; a
   raw-descriptor fallback covers entries with `plugin.specifier` but no `register`.

Tests: `src/wins.test.ts` (10) + fixtures `test/bundled-channel/` (webhook-mode) & `test/raw-bundled/`
(fallback). **Caveat:** these make plugins *load*; end-to-end execution still needs the plugin's own
deps/keys, and real socket channels still need the deferred runtime + a warm pod.
