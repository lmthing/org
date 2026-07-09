# OpenClaw compatibility — feasibility & gap report

Status: **foundation only** (Phase 5, "OpenClaw messaging extensions as-is",
first increment). This package proves the host↔plugin seam with a synthetic
fixture; it does not yet load a real OpenClaw plugin package.

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
| `registerTool({ name, description, parameters, execute })` | **Implemented** | Recorded in `PluginRegistry.tools`; `execute` directly callable off the registry (lmthing has no separate tool-calling registry yet). |
| `registerHttpRoute({ method, path, handler })` | **Implemented** | Recorded in `PluginRegistry.httpRoutes` + forwarded to `host.mountRoute`. |
| `registerChannel(registration)` | **Partial** | Recorded in `PluginRegistry.channels`; best-effort extraction of an `inbound`/`send` pair from common shapes (`onMessage`/`handleInbound`/`inbound`, `send`). No actual routing (webhook binding, Socket Mode connection, etc.) — that's a later increment. |
| `runtime.subagent.run({ sessionKey, message, provider?, model? })` | **Implemented** | Calls `host.runAgent({ sessionKey, message, agentRef: provider ?? model })`. |
| `log(msg)` / `logVerbose(msg)` | **Implemented** | No-op formatting; forwarded to `host.log`. |
| `runtime.*` (anything but `subagent.run`) | **Throws** | e.g. `runtime.subagent.spawn`, any other `runtime.*` property. |
| `registerProvider`, `registerGatewayMethod`, and all other `register*` | **Throws** | Not implemented. |
| `session`, `agent`, `lifecycle`, and any other namespace | **Throws** | Accessing the namespace itself or any property on it returns a nested throwing proxy — `api.session.getUser()` fails with a path-specific message. |

Every unimplemented path throws `UnsupportedCompatError`, whose message is
always `unsupported in @lmthing/openclaw-compat: <path> is not implemented in @lmthing/openclaw-compat`
so failures are greppable and point at exactly what a plugin touched.

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
2. Add `openclaw` + one real, non-Socket-Mode extension package as an actual
   dependency and attempt loading its real entry (no more
   `definePluginEntryLocal` shim) through this same `loadPlugin` — see which
   `UnsupportedCompatError`s it hits and implement those `api` methods for
   real.
3. Only after (2) succeeds for a webhook-mode channel, revisit Slack/Socket
   Mode as a warm-pod-only, explicitly-opt-in tier feature.
4. `defineBundledChannelEntry` support (currently a hard throw in
   `loadPlugin`) once a concrete channel package that uses it is targeted.
