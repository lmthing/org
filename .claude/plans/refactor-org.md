# Developer-Friendliness Refactor — sdk/org monorepo

## Context

Chat, Studio, and Computer are now one unified Vite SPA (`@lmthing/web-app`) served by the
CLI (`lmthing serve`) and deployed as three nginx images. The consolidation works, but the
workspace grew organically and now carries friction that slows every new contributor:

- **Package naming is contradictory** — `libs/ui` is `@lmthing/ui` while `libs/ui` is
  `@lmthing/agent-ui`. Two "ui" directories, neither matching its npm name.
- **Broken/duplicated config** — `libs/ui/tsconfig.json` aliases point at `../../studio/src/*`
  (a directory that no longer exists); every lib has a bespoke tsconfig; only `libs/state`
  has lint/format; no shared config package; no build ordering despite `cli → core`.
- **Duplicated app code** — `COMPUTER_BASE_URL` / `CLOUD_BASE_URL` are redefined in ~9 route
  files; `ChatShell.tsx` copies URL↔state sync logic from `main.tsx`.
- **`serve.ts` is an ~800-line God Object** — HTTP routing + WS upgrade + static serving +
  session lifecycle + fs I/O all inline; adding an endpoint means editing the monolith.

**Intended outcome:** a workspace a new developer can navigate in minutes — consistent
configs, one obvious place per concern, names that match reality — delivered in two phases so
value lands immediately and the high-churn structural moves happen on a clean base.

Decisions locked with the user: **(1)** phased — cleanup first, then structural; **(2)** merge
the two UI packages into a single `@lmthing/ui` with subpath exports; **(3)** decompose
`serve.ts` into a route registry.

---

## Phase 1 — Low-risk cleanup (no directory/package moves)

### 1.1 Shared config package — `@lmthing/config` (single package, tsconfig + eslint)
- One package at `libs/config/` holding **both** the shared tsconfigs and the shared eslint
  config, so there's a single place developers look for "how is this repo configured":
  - `tsconfig/base.json` (today's `tsconfig.base.json`), `tsconfig/react-lib.json`
    (DOM libs, `jsx: react-jsx`, `moduleResolution: bundler`, `noEmit`), `tsconfig/node-lib.json`
    (NodeNext, for core/cli/the merged ui).
  - `eslint/index.js` — shared flat config (eslint v9), promoted from `libs/state`'s current
    setup. Optional `eslint/react.js` variant for the UI/web packages.
- `package.json` exports map: `"./tsconfig/base"`, `"./tsconfig/react-lib"`,
  `"./tsconfig/node-lib"`, `"./eslint"`.
- Convert every package's `tsconfig.json` to `"extends": "@lmthing/config/tsconfig/<preset>"`,
  and every `eslint.config.js` to re-export `@lmthing/config/eslint`. Eliminates per-lib drift
  (libs/auth standalone, libs/state composite, libs/ui broken).
- Files: new `libs/config/`; edit `tsconfig.json` in `libs/{auth,css,state,ui,utils}` and
  `packages/{core,cli,ui}` and `libs/ui/apps/web`. Keep root `tsconfig.base.json` as a thin
  re-export for back-compat, or repoint references. (This supersedes a separate eslint-config
  package — §1.3 below consumes this one.)

### 1.2 Fix `libs/ui/tsconfig.json` broken aliases
- Remove `"@/*": ["../../studio/src/*"]` (dead path).
- Keep only real aliases; rely on `workspace:*` resolution rather than hardcoded `../css/src/*`
  relative paths where possible. File: `libs/ui/tsconfig.json:15-21`.

### 1.3 Shared lint/format
- Root `eslint.config.js` re-exports `@lmthing/config/eslint` (the eslint half of §1.1); add a
  shared `prettier` config (root `.prettierrc` or a field in `@lmthing/config`).
- Add `lint` / `format` scripts to root `package.json` and every package.
- Today only `libs/state/package.json` has these — its config is the seed promoted into
  `@lmthing/config` in §1.1.

### 1.4 Build orchestration
- Add `turbo` (lightest option; no source-tree restructure needed) with a `turbo.json` defining
  `build` (`dependsOn: ["^build"]`), `typecheck`, `test`, `lint`. Repoint root scripts from
  `pnpm -r build` → `turbo run build`. Fixes the `cli`/`core` build race.
- Root `package.json` is currently named `@repl/root` — rename to `@lmthing/root` while here.

### 1.5 Tests cover `libs/`
- Extend root `vitest.config.ts:5-10` `include` globs to `libs/*/src/**/*.test.{ts,tsx}`.
  Add a `test:all` (or just widen `test`). Reconcile `libs/state`'s standalone jsdom config —
  either a root projects config or keep its override and document why.

### 1.6 Dedupe web-app config constants
- Create `libs/ui/apps/web/src/lib/config.ts` exporting `COMPUTER_BASE_URL`,
  `CLOUD_BASE_URL`, `WS_URL` resolvers (the `import.meta.env.VITE_* ?? (DEV ? '.test' : origin)`
  pattern, written once).
- Replace the inline definitions across the ~9 files found, representatively:
  `src/routes/studio/route.tsx`, `src/routes/computer/route.tsx`,
  `src/routes/studio/$projectId/$spaceId/route.tsx`, `src/routes/computer/index.tsx`,
  `src/routes/computer/settings.tsx`, `src/lib/gates.tsx`, `src/lib/runtime/use-tier-detection.ts`,
  `src/routes/studio/thing/index.tsx`, `src/routes/studio/$projectId/$spaceId/agent/$agentId/chat/index.tsx`.

### 1.7 Extract `ChatShell` ↔ `main.tsx` shared logic
- Pull the URL↔state sync out of `libs/ui/src/app/main.tsx` into a reusable hook/util
  (e.g. `src/app/url-state.ts`: `useUrlState()` / `applyUrlToState` / `syncStateToUrl`) and have
  both `main.tsx` and `app/ChatShell.tsx` consume it. Removes the copy-paste.

### 1.8 Remove dead code / align React
- Delete the unused `libs/ui/apps/web/src/lib/auth/AuthContext.tsx` (routes use `@lmthing/auth`).
- Move `react`/`react-dom` in `libs/ui/package.json` from `dependencies` → `peerDependencies`
  (`^18 || ^19`) so the SPA's React 19 isn't double-bundled against agent-ui's pinned 18.3.
  Add a root `pnpm.overrides` to enforce one React version. (This also de-risks the Phase 2 merge.)

### 1.9 Make the `/chat` route a directory (consistency with studio/computer)
- `apps/web/src/routes/chat.tsx` is the only surface that's a single file; `studio/` and
  `computer/` are directories. Convert to `routes/chat/` with `route.tsx` (layout/providers) +
  `index.tsx` (renders `ChatShell`), leaving room for chat sub-routes. TanStack file-based routing
  treats `chat/index.tsx` as `/chat`; regenerate `routeTree.gen.ts`. Purely structural, no behavior
  change.

---

## Phase 2 — Structural reorganization (on the Phase-1 base)

### 2.1 Merge the two UI packages → single `@lmthing/ui`, organized **by product surface**
Replace `libs/ui` + `libs/ui`(`@lmthing/agent-ui`) with one package whose top-level dirs map
1:1 to the three surfaces, so a developer working on Studio looks in exactly one place:

```
libs/ui/                      # @lmthing/ui
  src/
    chat/        ← libs/ui/src/{app,components,client,store,compat}  (was @lmthing/agent-ui)
                 #   ChatShell, AppShell, AgentChatPanel, useReplSession, rpc-client, url-state.ts (new)
    studio/      ← libs/ui/src/components/{shell,studio,agent,space,thing,
                 #     knowledge,functions,workflow,component-editor,presentation}
                 #   (StudioLayout, studio-sidebar, projects/spaces-layout, agent-card, space-authoring editors)
    computer/    ← libs/ui/src/components/computer  (IDE layout, terminal, file tree, panes)
    components/  ← cross-surface shared components  (libs/ui/src/components/auth: pin-gate,
                 #     login-screen, github-*; anything used by ≥2 surfaces)
    elements/    ← libs/ui/src/elements  (typography, forms, layouts, nav, overlays — primitives)
    theme/       ← libs/ui/src/theme
    index.ts
  package.json   exports:
                 #   "./chat", "./studio", "./computer",
                 #   "./components/*", "./elements/*", "./theme", "./chat/css"
```

- **Sorting rule**: surface-specific components live under `chat/` `studio/` `computer/`; anything
  imported by two or more surfaces stays in `components/` (or `elements/` for primitives). The
  existing `components/{studio,computer,shell,...}` subdirs already encode this split, so the move
  is mostly relocating folders, not re-deciding ownership.
- **Exports / import rewrites** (the `apps/web` diff is mechanical):
  `@lmthing/agent-ui` → `@lmthing/ui/chat`; `AgentChatPanel` re-exported from `@lmthing/ui/chat`;
  `@lmthing/ui/components/shell/studio-layout` → `@lmthing/ui/studio/...`;
  `@lmthing/ui/components/agent/agent-card` → `@lmthing/ui/studio/...`;
  computer/IDE components → `@lmthing/ui/computer/...`;
  `@lmthing/ui/elements/typography/heading` stays as `@lmthing/ui/elements/...`.
  Studio's previously-hidden dependency on agent-ui internals becomes the explicit `@lmthing/ui/chat`.
- **Build strategy**: `libs/ui` is source-only (`main: ./src/index.ts`); `agent-ui` is tsup-built
  and pulls in `@lmthing/core` + `zustand`. Keep the merged package **source-only** (only the Vite
  SPA consumes it; Vite transpiles workspace sources) to drop tsup + the `dist-web` CSS step — OR
  retain a tsup build if a non-Vite consumer needs it. `libs/cli` imports `@lmthing/agent-ui`
  → repoint to `@lmthing/ui/chat`; confirm cli doesn't need a built `dist/` form before going
  source-only.
- **CSS**: fold agent-ui's `styles.css`/`dist-web/app.css` into a documented `@lmthing/ui/chat/css`
  entry; update the `/chat` route import.
- **Workspace**: `libs/ui` ceases to be a package (only `apps/web` remains under it) — handled
  by the move in §2.2.

### 2.2 Collapse to a two-way split: `libs/` (everything) + `apps/` (the SPA)
- **Move `libs/core` → `libs/core` and `libs/cli` → `libs/cli`.** npm names
  (`@lmthing/core`, `@lmthing/cli`) are unchanged, so there are **no import rewrites** — only the
  directory moves, workspace globs, tsconfig `extends`/references, and tsup paths.
- **Move the SPA `libs/ui/apps/web` → `apps/web`** (`@lmthing/web-app` unchanged).
- After §2.1 merged the UI package into `libs/ui` and core/cli/the-SPA moved out, the `packages/`
  directory is empty and is **removed**.
- `pnpm-workspace.yaml` globs become just:
  ```yaml
  packages:
    - 'libs/*'
    - 'apps/*'
  ```
- **`resolveAppDist()`** in `cli/src/server/static-apps.ts` walks for the `libs/ui/apps`
  marker — update it to the new `apps/` location (and the source-tree fallback guess), plus the
  `LM_APP_DIST` docs.
- **Docker**: the build context is `sdk/org`; update any `libs/cli` / `libs/ui/apps/web`
  paths in the Dockerfile(s) and CI to `libs/cli` / `apps/web`.
- Result: `libs/` = all packages (libraries + the core/cli runtime), `apps/` = the SPA. Document
  this two-way split in a new `WORKSPACE.md` and update both `CLAUDE.md` files (they currently
  reference `packages/{core,cli,ui}` throughout — sweep those paths).

### 2.3 Decompose `serve.ts` into a route registry
Target (`libs/cli/src/server/`, post-move from §2.2):

```
server/
  router.ts          # tiny method+path matcher → handler; one place to register routes
  serve.ts           # bootstrap only: create server, wire router + ws + static, listen
  routes/
    sessions.ts      # POST/GET /api/sessions, /api/sessions/:id/{state,trace,message,asks}
    projects.ts      # /api/projects/* (CRUD, space sync, documents, instructions)
    spaces.ts        # POST /api/spaces
    fs.ts            # /api/fs/*
    env.ts           # /api/env
    prices.ts        # /api/prices/azure
  ws/
    agent.ts         # /api/ws session-event upgrade
    terminal.ts      # /api/terminals/:id PTY upgrade
  static-apps.ts     # unchanged (already extracted)
```

- Make `web/agent-api.ts`'s `AgentApiContext` the real contract these handlers receive (today
  `serve.ts` builds it inline and bypasses the abstraction). Each handler is independently testable.
- Pure mechanical extraction — preserve every existing route path, method, and response shape.
  No behavior change; the SessionManager / legacy-vs-project-mode split stays as-is (note it as a
  follow-up, out of scope here).

---

## Exact file structure — before & after

### Before (today)

```
sdk/org/
├── pnpm-workspace.yaml          # globs: packages/*, libs/ui/apps/*, libs/*
├── package.json                 # @repl/root  ·  pnpm -r build
├── tsconfig.base.json           # used by packages/* only
├── vitest.config.ts             # include packages/* only (libs excluded)
├── libs/
│   ├── auth/                    # @lmthing/auth   (standalone tsconfig, src-only)
│   ├── css/                     # @lmthing/css    (no build)
│   ├── state/                   # @lmthing/state  (composite tsconfig, own vitest, only lint/format)
│   ├── ui/                      # @lmthing/ui     ← BROKEN tsconfig paths (../../studio/src/*)
│   │   └── src/{components,elements,...}
│   └── utils/                   # @lmthing/utils  (private)
└── packages/
    ├── core/                    # @lmthing/core   (tsup)
    ├── cli/                     # @lmthing/cli    (tsup) — imports @lmthing/agent-ui
    │   └── src/server/serve.ts  # ~800-line God Object
    └── ui/                      # @lmthing/agent-ui  ← dir says "ui", npm says "agent-ui"
        ├── src/{app,client,compat,components,store,theme,index.ts,lib}
        └── apps/
            └── web/             # @lmthing/web-app (the unified SPA)
                └── src/{routes,lib}   # COMPUTER/CLOUD_BASE_URL duplicated ~9×
```

### After (both phases complete)

```
sdk/org/
├── pnpm-workspace.yaml          # globs: libs/*, apps/*   (packages/* gone)
├── package.json                 # @lmthing/root  ·  turbo run build
├── turbo.json                   # NEW — build/typecheck/test/lint pipeline, ^build ordering
├── eslint.config.js             # NEW — re-exports @lmthing/config/eslint
├── .prettierrc                  # NEW — shared formatter config
├── vitest.config.ts             # include libs/* AND apps/*
├── WORKSPACE.md                 # NEW — explains the libs/ + apps/ two-way split
│
├── libs/                        # ← EVERYTHING (libraries + core/cli runtime)
│   ├── config/                  # NEW — @lmthing/config  (tsconfig + eslint, one package)
│   │   ├── tsconfig/
│   │   │   ├── base.json        #   (was tsconfig.base.json)
│   │   │   ├── node-lib.json    #   NodeNext preset (core/cli)
│   │   │   └── react-lib.json   #   DOM + react-jsx preset (ui/web)
│   │   ├── eslint/
│   │   │   ├── index.js         #   shared flat config (promoted from libs/state)
│   │   │   └── react.js         #   react variant
│   │   └── package.json         #   exports ./tsconfig/*, ./eslint
│   ├── auth/                    # @lmthing/auth    → extends config/tsconfig/react-lib
│   ├── css/                     # @lmthing/css
│   ├── state/                   # @lmthing/state   → extends config/react-lib
│   ├── utils/                   # @lmthing/utils
│   ├── ui/                      # @lmthing/ui  ← MERGED, organized BY SURFACE
│   │   ├── package.json         #   exports "./chat","./studio","./computer",
│   │   │                        #           "./components/*","./elements/*","./theme","./chat/css"
│   │   └── src/
│   │       ├── chat/            #   from old libs/ui/src/{app,components,client,store,compat}
│   │       │   ├── ChatShell.tsx
│   │       │   ├── AgentChatPanel.tsx
│   │       │   ├── url-state.ts #   NEW — shared URL↔state hook (was dup in ChatShell/main)
│   │       │   └── ...
│   │       ├── studio/          #   from old libs/ui/src/components/{shell,studio,agent,space,
│   │       │                    #     thing,knowledge,functions,workflow,component-editor,presentation}
│   │       ├── computer/        #   from old libs/ui/src/components/computer (IDE)
│   │       ├── components/      #   cross-surface shared (old components/auth, etc.)
│   │       ├── elements/        #   from old libs/ui/src/elements (primitives)
│   │       ├── theme/           #   from old libs/ui/src/theme
│   │       └── index.ts
│   ├── core/                    # @lmthing/core   (moved from libs/core; name unchanged)
│   └── cli/                     # @lmthing/cli    (moved from libs/cli) — imports @lmthing/ui/chat
│       └── src/server/
│           ├── serve.ts         #   bootstrap only (create server, wire router+ws+static, listen)
│           ├── router.ts        #   NEW — method+path → handler registry
│           ├── static-apps.ts   #   marker updated: libs/ui/apps → apps  (resolveAppDist)
│           ├── routes/          #   NEW — extracted handlers
│           │   ├── sessions.ts
│           │   ├── projects.ts
│           │   ├── spaces.ts
│           │   ├── fs.ts
│           │   ├── env.ts
│           │   └── prices.ts
│           └── ws/              #   NEW
│               ├── agent.ts     #     /api/ws session events
│               └── terminal.ts  #     /api/terminals/:id PTY
│
│   # packages/  ← REMOVED (empty after the moves above)
│
└── apps/                        # ← THE SPA (moved from libs/ui/apps/web)
    └── web/                     # @lmthing/web-app
        └── src/
            ├── lib/
            │   └── config.ts    #   NEW — COMPUTER_BASE_URL/CLOUD_BASE_URL/WS_URL (single source)
            │   # (lib/auth/AuthContext.tsx DELETED — dead code)
            └── routes/          #   imports now @lmthing/ui/{chat,studio,computer} + @/lib/config
                ├── chat/        #   NOW a directory (route.tsx + index.tsx) — matches studio/computer
                ├── studio/
                └── computer/
```

### Import-path changes consumers will see

| Old | New |
|-----|-----|
| `@lmthing/agent-ui` | `@lmthing/ui/chat` |
| `@lmthing/agent-ui/app/ChatShell` | `@lmthing/ui/chat/ChatShell` |
| `import { AgentChatPanel } from '@lmthing/agent-ui'` | `from '@lmthing/ui/chat'` |
| `@lmthing/agent-ui/web-css` | `@lmthing/ui/chat/css` |
| `@lmthing/ui/components/shell/studio-layout` | `@lmthing/ui/studio/...` |
| `@lmthing/ui/components/agent/agent-card` | `@lmthing/ui/studio/...` |
| `@lmthing/ui/components/computer/...` (IDE) | `@lmthing/ui/computer/...` |
| `@lmthing/ui/elements/typography/heading` | `@lmthing/ui/elements/...` (unchanged) |
| inline `const COMPUTER_BASE_URL = …` (×9) | `import { COMPUTER_BASE_URL } from '@/lib/config'` |
| `@lmthing/css` (lib, unchanged) | same |

Net package count: **9 → 8 publishable** (agent-ui folds into ui) **+1 internal `@lmthing/config`**
(tsconfig + eslint). The whole `packages/` tree disappears — libraries + the core/cli runtime live
in `libs/`, the SPA lives in `apps/` — and every directory name now matches its npm name.

## Verification

Run after **each** phase (and ideally each sub-step):

```bash
cd sdk/org
pnpm install
pnpm typecheck          # must be clean across all packages (now incl. libs via 1.1/1.5)
pnpm lint               # new in 1.3
pnpm -w test            # now incl. libs/* (1.5)
pnpm build              # via turbo, ordered (1.4)
```

**Web app end-to-end:**
```bash
cd apps/web   # (libs/ui/apps/web pre-2.2)
pnpm dev
# Visit /chat, /studio, /computer — confirm all three surfaces render, the Studio THING dock
# (AgentChatPanel via new subpath) loads, and pod base-URL resolution still works.
pnpm build && LM_APP_DIST=$PWD/dist node ../../libs/cli/dist/cli/bin.js serve
# Confirm the CLI serves the built SPA at / and routes /studio /computer /chat as a catch-all.
```

**serve.ts decomposition (2.3):** add/extend route tests hitting each extracted handler via the
built CLI subprocess (the existing `web-api` vitest suite pattern). Diff response bodies against
pre-refactor to prove parity. Run `lmthing serve` and exercise a full session: `POST /api/sessions`
→ WS `/api/ws` → `POST /api/sessions/:id/message` → trace streams back.

**Merge (2.1):** grep for any lingering `@lmthing/agent-ui` import and any old
`@lmthing/ui/components/{shell,studio,computer,...}` path; ensure `libs/cli` and the SPA
resolve via the new surface subpaths (`@lmthing/ui/{chat,studio,computer}`, `@lmthing/ui/elements/*`);
`pnpm build` of cli succeeds.

---

## Out of scope (note as follow-ups)

- SessionManager legacy-vs-project-mode dual code paths (collapse into a strategy) — flagged by
  exploration; risky, separate effort.
- Async session-init handshake (clients poll today) — add a "ready" event later.
- `resolveAppDist()` heuristic simplification beyond the 2.2 marker update.
- Deep route nesting in Studio knowledge routes (cosmetic).



## Continue from here

Resuming 2.1 and also spawning 2.3 in parallel since they're independent:
Agent "a8c05f4634883ab0b" had no active task; resumed from transcript in the background with your message. You'll be notified when it finishes. Output: /tmp/claude-1000/-home-vasilis-LMTHING-lmthing-sdk-org/acbf5b9b-cbb9-47c7-92d9-0651dd5a6fa6/tasks/a8c05f4634883ab0b.output


● Agent(Phase 2.3: Decompose serve.ts into route registry)
Backgrounded agent (↓ to manage · ctrl+o to expand)

2.1 resumed and 2.3 spawned fresh. Both running in parallel:

- 2.1 (UI merge): resumed from where it stalled, will continue moving libs/ui/src/ into libs/ui/src/chat/ and reorganizing components into surface directories
- 2.3 (serve.ts decomposition): fresh agent extracting the ~800-line server into router.ts + routes/{sessions,projects,spaces,fs,env,prices}.ts + ws/{agent,terminal}.ts

These are independent — 2.3 only touches libs/cli/src/server/, 2.1 touches libs/ui/ and libs/ui/src/. Will ping when either completes.

✻ Waiting for 2 background agents to finish

● Agent "Phase 2.1: Merge libs/ui + libs/ui into single @lmthing/ui by surface" finished · 14m 2s

● API Error: Unable to connect to API (ConnectionRefused)

✻ Waiting for 1 background agent to finish

● Agent "Phase 2.3: Decompose serve.ts into route registry" failed: Agent stalled: no progress for 600s (stream watchdog did not recover)

Both hit issues — 2.1 got an API connection error mid-run, 2.3 stalled again. Let me check what 2.1 actually accomplished before resuming 2.3:

  Ran 4 shell commands

Both worktrees were cleaned up (no commits before failure). Let me resume 2.3 and re-spawn 2.1 with tighter step-by-step guidance:
Agent "a8d221a22a75fb638" had no active task; resumed from transcript in the background with your message. You'll be notified when it finishes. Output: /tmp/claude-1000/-home-vasilis-LMTHING-lmthing-sdk-org/acbf5b9b-cbb9-47c7-92d9-0651dd5a6fa6/tasks/a8d221

● Agent(Phase 2.1: Merge UI packages, small a
Backgrounded agent (↓ to manage · ctrl+o to expand)

Both running again:
- 2.3 resumed with step-by-step instructionguidance
- 2.1 fresh agent with explicit atomic steps, 100-line read limits, and commit after every step

The key change: agents now commit after each individual step instead of trying to do everything before committing,
which means progress is preserved even if t
