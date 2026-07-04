# Project-as-Application — Phased Implementation Plan

> Executable, fan-out-ready delivery plan for [`project-as-application.md`](./project-as-application.md).
> Every phase is independently **testable**, **non-breaking**, and **pushed to `main`** on both the
> org submodule (`sdk/org`) and the monorepo. Phases that touch **LLM prompts, globals, the space
> format, or system spaces** carry a mandatory **live DeepSeek test** (via `sdk/org/.env`).
>
> This file is the orchestration contract. Each `Phase N` § is written so its **Fan-out plan** can be
> pasted into Opus subagent prompts with minimal editing. Read [§0 Global protocol](#0-global-protocol)
> first — it applies to **every** phase and is not repeated.

---

## 0. Global protocol

These rules are invariants for **every** phase. A phase is not "done" until all of them pass.

### 0.1 Definition of Done (the regression gate — run at the end of every phase)

From `sdk/org`:

```bash
pnpm install            # if deps changed
pnpm build              # all packages → dist/
pnpm typecheck          # tsc --noEmit, strict, ALL packages — MUST be green
pnpm test               # vitest run — new tests + every pre-existing suite green
pnpm --filter @lmthing/core test -- system-spaces-dag   # system spaces still load/typecheck
pnpm lint:tokens        # (root, only if any web styling touched) design-token gate
```

**Non-breaking is a hard gate.** No phase may make a previously-green suite red. If a change is
inherently breaking (e.g. the DTS refactor), the phase must include the compensating edits (e.g.
system-space frontmatter/tasklist fixes) **in the same phase** so the tree stays green end to end.

### 0.2 Live DeepSeek test (mandatory for prompt / globals / space-format / system-space changes)

Run from `sdk/org` (`.env` loads from cwd only). Model alias `S` = `azure:DeepSeek-V4-Flash`
(the free DeepSeek-pro Azure deployment). Keys already in `sdk/org/.env`
(`AZURE_API_KEY`, `AZURE_RESOURCE_NAME`).

```bash
pnpm build
# Headless single-shot against the real model:
node libs/cli/dist/cli/bin.js --space <fixtureDir> --request "<msg>" --model S --trace /tmp/p<N>.ndjson
# Target a specific agent directly:
node libs/cli/dist/cli/bin.js --space <fixtureDir> --agent <slug> --request "<msg>" --model S --trace /tmp/p<N>.ndjson
# Live suite harness (gated):
LM_LIVE=1 pnpm vitest run libs/cli/src/testing/live-llm.test.ts
```

Use a fresh isolated root per live run: `LMTHING_ROOT=$(mktemp -d)`. Inspect the trace: pair
`node_start`/`node_end`, confirm no hang, confirm the intended `db.*`/`apiCall`/`display` calls fired.
**A phase that changes a prompt, a global, the space format, or a system space MUST paste its live-run
trace evidence into the phase completion report** — deterministic mock tests are necessary but not
sufficient for those phases.

Which phases require a live run: **1, 2, 4, 6, 7, 9, 11** (marked 🔴 LIVE below). Phases **3, 5, 8, 10**
are Node/browser surfaces validated with integration + chrome-devtools MCP instead (marked 🟢) — Phase 10
adds a live check only if the installed demo app runs hooks/agents.

### 0.3 Push protocol (submodule first, then monorepo pointer) — every phase

`sdk/org` is a git submodule (`.gitmodules` → `github.com/lmthing/org.git`); both repos track `main`.
The monorepo currently shows a dirty ` M sdk/org` pointer — **reconcile/commit it as part of Phase 1's
first push** so the baseline is clean.

```bash
# 1) Push the submodule FIRST (its commit must exist on origin before the pointer references it):
cd sdk/org
git add -A && git commit -m "feat(app): <phase N — scope>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main

# 2) Bump the pointer in the monorepo:
cd /home/vasilis/LMTHING/lmthing
git add sdk/org
git commit -m "chore: bump sdk/org — <phase N — scope>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

Never bump the monorepo pointer before the submodule commit is pushed (the referenced SHA must exist
on the remote). Phase 8 also touches monorepo-only files (`devops/`, domain nginx/Envoy config) — those
commit in the monorepo directly, no submodule involved.

### 0.4 Fan-out protocol (multiple Opus subagents per phase)

Each phase below has a **Fan-out plan**: a set of parallel Opus subagent tasks partitioned so they own
**disjoint files** wherever possible, plus a **sequential integrator** step. Rules:

- **Partition by file ownership, not by feature**, to avoid merge collisions. Files that several tasks
  must touch (listed as ⚠️ **shared/serialize** per phase — usually `exec/bootstrap.ts`,
  `exec/capability.ts`, `server/serve.ts`, `server/session-manager.ts`) are owned by **exactly one**
  task; other tasks request edits to them through the integrator, or run **after** that owner.
- Launch parallel tasks **in one message** (concurrent). Give each the [§0.1 gate] scoped to its files
  (`pnpm --filter <pkg> typecheck/test`).
- The **integrator** task runs last, serially: merges branches/edits, wires the ⚠️ shared files, runs
  the **full** §0.1 gate + the phase's live/integration test, writes the completion report, and does the
  §0.3 push. Only the integrator pushes.
- Keep the orchestrator lean: subagents return **a short report + the diff summary**, not file dumps.
- Progress tracking: maintain `sdk/org/.app-progress.md` (checklist per phase/sub-task, updated every
  step) — mirrors the PROGRESS.md discipline for large multi-part work.

### 0.5 Backward-compatibility invariants (guard in every phase)

1. A session with **no `projectRoot`** gets **no** app-capability globals and behaves exactly as today
   (THING top-level). Assert this in a test each phase that touches injection.
2. The synthetic **`system` project** has no app layer — the project/app loader must tolerate a
   spaces-only project (no `database/pages/api/hooks`). Assert `system` still lists/loads.
3. `writeSpaceFiles`'s wipe stays scoped to `spaces/<spaceId>/`; the app layer lives at the **project
   root** (sibling of `spaces/`) so it is never touched. Do **not** put `.data/` under a space dir.
4. Existing agent `instruct.md` frontmatter keys (`title`, `knowledge`, `functions`, `components`,
   `actions`, `defaultAction`, `canDelegateTo`, `dependencies`) keep working — the new allow-list must
   **include all of them** (audited list, §Phase 1).
5. `@lmthing/core` never imports `cli`/`ui` and stays browser-safe (no native deps). `better-sqlite3`
   lives **only** in `libs/cli`.

### 0.6 Store catalog & app locations (`store/apps/`)

The canonical home of every project-app is the **public store catalog**, not a pod. This is a monorepo
concern that mirrors the existing `store/spaces/<id>/` precedent (the store already distributes space
templates and has a `publish` route).

- **Every new project-app is created in `store/apps/<appId>/`** — monorepo-tracked, the full app-layer
  template (`package.json database/ pages/ api/ hooks/ components/ lib/`) **minus** runtime
  `.data/`/`types/`. New apps — hand-authored **or** produced by `system-appbuilder` — land here. This
  is the canonical source and the public catalog entry.
- **A running instance lives in the user's pod** at `<root>/<projectId>/` (PVC), **materialized from a
  catalog template by the install endpoint** (Phase 10). Same source→per-user-copy model as system
  spaces: a pristine install re-syncs on re-install; a locally-edited copy holds back (divergence flag,
  `--adopt`-style override).
- **`store/apps/manifest.json`** (generated at store build) is the browse index (id, title, description,
  icon, tables, pages, screenshots) — a **static asset** served by lmthing.store, so the public store SPA
  browses with **no** server call.
- **Two list surfaces:** *available apps* = the static catalog manifest (+ `GET /api/apps` on the CLI
  server for in-pod listing); *installed projects* = the existing `GET /api/projects`. The user can list
  both.
- **Where each piece runs:** the store site is a public **static SPA** (`store/`, lmthing.store); the
  **install** and **list-installed** operations hit the **CLI server** in the user's pod; cross-origin
  authorization (store site → the authenticated user's pod) rides the existing Envoy JWT + per-user
  routing (per the `authentication`/devops skills), with a thin `cloud/gateway` proxy only if CORS/JWT
  requires it.

---

## Dependency graph & waves

```
P1 ──┬─> P2 ──┬─> P3 ─────┐
     │        ├─> P4 ─> P5 │
     │        ├─> P6 ──────┼─> P8 ─> P9 ─> P10 ─> P11
     │        └─> P7 ──────┘
     └─(system-space audit lands WITH P1)
```

| Wave | Phases | Can run in parallel? |
|---|---|---|
| A | **P1** | Foundational — solo. Blocks all. |
| B | **P2** | Solo (needs P1). |
| C | **P3, P4, P7** | Parallel after P2 (disjoint: api-runtime / build-pipeline / chat-session). |
| D | **P5, P6** | Parallel (P5 needs P4; P6 needs P3). |
| E | **P8** | After P3–P7 (manifest surfaces them all). |
| F | **P9** | After P8 (authoring globals + domains exist; appbuilder authors into `store/apps/`). |
| G | **P10** | Store distribution — after P9 (install materializes a catalog app + boots/builds it). |
| H | **P11** | Last (demo app in `store/apps/` + docs; end-to-end install exercise). |

Within each phase, fan out further (below). Across a wave, whole phases run as parallel subagents.

---

## Phase 1 — Core db interfaces + capability globals + DTS refactor + `projectRoot` threading  🔴 LIVE

**Goal.** Land the *interface* and *injection* foundation in `@lmthing/core` (browser-safe, no sqlite):
the `DbApi`/`AsyncDbApi`/`ApiCallFn` interfaces, the modular capability→{inject, dts} registry, the new
`capabilities:` frontmatter (config-bearing, fail-loud), and `projectRoot`/`projectId` threaded as a
first-class context field. Keep **all system spaces green** (behavior-preserving DTS + frontmatter
allow-list). No storage engine yet (that's P2).

**Files (grounded in the map):**
- `libs/core/src/db/` (new) — `DbApi` (sync agent surface) + `AsyncDbApi` (Promise surface) + `ApiCallFn`
  interfaces; hand-rolled schema validator (required `description` on table/column/relation, exactly-one
  PK, `references`/`relations` resolve to existing tables/columns — fail-loud). No engine.
- `libs/core/src/typecheck/library-dts.ts` — split `COMMON_DTS` so `execShell`/`writeFileRaw` (currently
  declared **unconditionally** at lines ~92–101) become **gated fragments**; add one fragment per new
  gated global (`db:read`, `db:write`, `db:schema`, `pages:write`, `api:write`, `hooks:write`,
  `api:call`). ⚠️ **shared** with the registry.
- `libs/core/src/exec/bootstrap.ts` — `buildAmbientDts` + `createChildVM`: drive **both** DTS selection
  and global injection from **one capability→{inject, dts} registry**. Extend the `Pick<CapabilityProfile,…>`
  and injection step 5. ⚠️ **shared/serialize** (integrator owns).
- `libs/core/src/exec/capability.ts` — extend `CapabilityProfile` with the scoped grants (not just
  booleans): `db:read/write/schema` (+ `tables` scope), `pages:write`, `api:write`, `hooks:write`,
  `api:call` (+ `allow` scope). Set them in `sessionCapabilities`/`forkCapabilities`/`delegateCapabilities`
  (read-only fork roles intersect with `allowWrite` — never receive a write/authoring cap). ⚠️ **shared/serialize**.
- `libs/core/src/globals/host-tools.ts` — inject `LMTHING_PROJECT_ROOT`/`LMTHING_PROJECT_ID` env
  (mirror `LMTHING_PROJECT_SPACES_DIR` at lines ~129–135); register the new capability-gated globals via
  `setGlobal`, each checking its scope (`tables`/`allow`) on every call, reusing the read-only error shape.
- `libs/core/src/session/types.ts`, `session/session.ts`, `fork/fork.ts`, `delegate/delegate.ts` — thread
  `projectRoot`/`projectId` at the **same six sites** `projectSpacesDir` uses today (opts type →
  `buildAmbientDts` → `createChildVM` → ForkEngine → nested delegate).
- `libs/core/src/spaces/frontmatter.ts` + `spaces/load.ts` — new `capabilities:` key parsing +
  **fail-loud** per-capability config schema, modeled exactly on `validateKnowledgeOptionFrontmatter`
  (module-level allow-list `Set` + unknown-key throw). **Introduce agent-frontmatter unknown-key
  validation** with the allow-list = existing keys **∪** `capabilities` — audited existing set:
  `{title, knowledge, functions, components, actions, defaultAction, canDelegateTo, dependencies}`.
  `tables` existence checked only when a project context (its own `database/`) exists; bare caps on
  system spaces defer the table check to run time.
- `libs/core/system-spaces/*` — the **behavior-preserving audit** (must land here to stay green):
  (a) confirm every existing agent frontmatter key is in the allow-list; (b) re-typecheck all
  tasklists/agents against the modular DTS; (c) grep read-only tasks (`explore`/`plan`) for now-gated
  `execShell`/`writeFileRaw` references and fix; (d) THING gets **no** `capabilities:` key (yet — its
  `canDelegateTo: system-appbuilder` lands in P9).

**Tests (unit).** Registry: "cap not listed ⇒ absent from DTS **and** not injected" (fixes the
`writeFileRaw`/`execShell` unconditional-declaration bug — add a test that a read-only role's DTS lacks
both). Schema validator: missing description / dup PK / dangling FK / dangling relation each throw with
an actionable message. Frontmatter: unknown key throws; each existing system-space frontmatter loads;
bare `api:call` (no `allow`) throws; `tables` naming a non-existent table throws (project context).
Threading: a session with no `projectRoot` injects **no** app globals.

**🔴 Live test.** From `sdk/org`: (1) `--request` a THING smoke run on `--model S` in a fresh root —
confirm it still orchestrates/delegates exactly as before (behavior-preserving proof). (2) A tiny space
fixture whose agent declares `capabilities: [db:read: { tables: [x] }]` loads and typechecks live
against DeepSeek without error, and a stray call to a non-listed global fails the agent's typecheck.
Paste both traces into the report.

**Fan-out plan (4 parallel + integrator):**
- **1A — db interfaces + validator** (`libs/core/src/db/**` only). Disjoint. Owns the schema-validator tests.
- **1B — frontmatter/loader validation** (`spaces/frontmatter.ts`, `spaces/load.ts` + their tests).
  Disjoint from 1A/1C.
- **1C — DTS modularization** (`typecheck/library-dts.ts` + tests). Produces the fragment map; hands the
  registry shape to the integrator.
- **1D — projectRoot threading + host-tools env** (`session/types.ts`, `fork.ts`, `delegate.ts`,
  `host-tools.ts` env block only — **not** the injection registry). Threads the new context field.
- **Integrator (serial)** — owns ⚠️ `exec/capability.ts` + `exec/bootstrap.ts` (the registry that wires
  1C's fragments to 1A's globals and 1D's context), performs the **system-space audit** (needs the whole
  tree assembled), runs §0.1 + both live runs, pushes (§0.3, including reconciling the dirty pointer).

---

## Phase 2 — CLI db engine + project app loader  🔴 LIVE

**Goal.** `better-sqlite3`-backed implementations of P1's interfaces, project-scoped loading of
`database/pages/api/hooks`, conditional DR restore, boot schema reconcile, backup wiring. All in
`libs/cli` (native dep isolated here).

**Files:**
- `libs/cli/src/app/` (new) — `better-sqlite3` store implementing sync `DbApi` (agent, same-process) and
  `AsyncDbApi` (main-process proxy target); `PRAGMA foreign_keys=ON`; `query({ include })` = relation
  join; `createTable`/`addColumn` migrations; `.sql` dump/restore.
- boot sequence in `serve.ts` (or a new `app/boot.ts` it calls): per project with an app — **restore
  only if `.data/app.db` absent** (DR; never clobber live), open db, **reconcile** `database/*.json` vs
  live tables → additive migrations, **fail loud** on non-additive divergence (surface to Studio in P8).
- `libs/cli/src/app/loader.ts` (new) — load `database/pages/api/hooks` at **project** scope from
  `<root>/<projectId>/` (siblings of `spaces/`). Tolerate a spaces-only project (`system`) — no app.
- `libs/cli/src/server/projects.ts` — add app-file route helpers (path-scoped) used by P8; **no change to
  `writeSpaceFiles`** (app layer is outside `spaces/`).
- `libs/cli/src/server/backup.ts` — **two edits**: add `**/.data/app.db` to `EXCLUDE_PATTERNS`
  (line ~34); add a **pre-dump step** in `runBackup` right before `git add -A` (after line ~279) that
  regenerates `<project>/.data/app.sql` for every project with a db (`app.sql` + `hooks-state.json`
  tracked, binary db never).
- `package.json` (cli) — add `better-sqlite3`; document prebuilt-binary needs for the pod image.

**Tests (unit/integration).** CRUD + additive evolution (`addColumn`/`createTable`); `query include`
join; FK `onDelete` cascade/setNull/restrict enforced; conditional restore (db present → dump untouched;
db absent + sql present → rebuilt); boot reconcile applies additive, throws on non-additive; loader loads
a scratch project and skips the app for `system`; backup excludes the binary db and emits `app.sql`.

**🔴 Live test.** Scratch project with `database/feed_items.json`; run a project-scoped agent (`--model S`,
`LMTHING_ROOT=$(mktemp -d)`, project bound) holding `capabilities: [db:write: { tables: [feed_items] }]`
that emits `db.insert('feed_items', …)`; confirm the row lands in `app.db` and a `db:read`-only agent
cannot write (host error names allowed tables). Paste trace.

**Fan-out plan (3 parallel + integrator):**
- **2A — store engine** (`libs/cli/src/app/store.ts` + migrations + dump/restore + tests). Disjoint.
- **2B — project app loader** (`libs/cli/src/app/loader.ts` + `boot.ts` + tests). Depends on 2A's types
  (start against P1 interfaces, integrate 2A last).
- **2C — backup edits** (`server/backup.ts` two edits + test) — small, disjoint.
- **Integrator** — owns ⚠️ `server/serve.ts` boot-call wiring + `server/projects.ts` helpers, runs
  §0.1 + live, pushes.

---

## Phase 3 — API runtime (Node file-based handlers)  🟢

**Goal.** Node, worker-isolated, **async** file-based api router mounted at `/app/<project>/api/*`.

**Files:**
- `libs/cli/src/app/api/` (new) — file-based router: endpoint = dir, method = filename
  (`GET.ts`/`POST.ts`/…); worker isolation (a bad handler crashes the app, not the pod); `ctx.db`
  (`AsyncDbApi`) / `ctx.spawn` / `ctx.apiCall` as **async message-channel proxies to the main process**
  (every db write executes main-side — worker is a crash boundary only, no `Atomics`). `spawn` =
  fire-and-forget returning `runId` with `onError` fail-close. `HttpError` + error contract.
- `server/serve.ts` — mount `/app/<project>/api/*` **below** the reserved `/api/*` (router `add`, returns
  true to short-circuit before SPA fallback). ⚠️ **shared/serialize**.
- Method-aware input assembly (path ∪ query for GET/DELETE, path ∪ body for POST/PATCH/PUT). ajv
  validation lands with P4's generated schema — for P3 use a pass-through validator seam.

**Tests (integration).** Route a scratch `api/mark-read/POST.ts` and `api/feed-list/GET.ts`; assert
method routing, path-param merge, worker crash isolation, `spawn` returns a runId and `onError` fires on a
dead run, `HttpError(status,…)` maps correctly, unknown throw → 500 with generic body (no leak).

**Fan-out plan (2 parallel + integrator):** **3A** router+worker+ctx proxies (`app/api/**`); **3B**
error contract + method-aware assembly seam. **Integrator** wires the mount in ⚠️ `serve.ts`, runs
§0.1 + curl integration, pushes.

---

## Phase 4 — Typed-contract build pipeline  🔴 LIVE

**Goal.** `ts-json-schema-generator` + `ajv` + row-type generation → `types/generated.d.ts`, api request
validation, the agent's typed `apiCall` DTS overload + tool signatures, client row/IO types.

**Files:**
- `libs/cli/src/app/build/schema.ts` (new) — handler tsc; `Input`/`Output` → JSON Schema; row types from
  `database/*.json` (incl. typed relation fields); emit `types/generated.d.ts` (git-ignored build artifact).
- Wire the generated schema into **four consumers**: (1) handler typecheck, (2) P3's ajv request
  validation seam (`coerceTypes:true`), (3) the agent's **`apiCall` DTS overload** injected via P1's
  registry (malformed call fails typecheck **inside the agent sandbox**) + `{name,description}`+schema as
  tool signature, (4) page client types (P5).

**Tests (unit).** Schema generation from a fixture `database/` + `api/`; ajv accepts/rejects assembled
Input (query-string coercion); generated `apiCall` overload compiles a valid call and **fails** a
type-mismatched call; row types include relation fields.

**🔴 Live test.** Agent (`--model S`) with `capabilities: [api:call: { allow: [markRead] }]` calls
`apiCall('markRead', { id })`; then a call with `id` as the wrong type — confirm it **fails the agent's
live typecheck** (DTS overload), and a name outside the allowlist errors naming allowed names. Trace.

**Fan-out plan (2 parallel + integrator):** **4A** schema+row-type generation; **4B** the four-consumer
wiring (esp. the ⚠️ P1 registry `apiCall` DTS overload — coordinate with whoever owns the registry).
**Integrator** runs §0.1 + live, pushes.

---

## Phase 5 — Pages build + serving  🟢

**Goal.** Per-project client React bundle (esbuild/Vite) with `_app`/`_layout`, `@app/runtime`
(`useApi`/`useApiMutation`/`apiCall`), design-system imports; served under `/app/<project>/*` with
asset-manifest SPA fallback.

**Files:**
- `libs/cli/src/app/build/pages.ts` (new) — per-project bundle **on save** (not per request), cached
  (hash/mtime); relative asset URLs; `useApi` resolves api base from the `…/app/<project>` prefix in
  `window.location` (one build works local + both TLDs). `@app/runtime` + `@app/types` provided by the
  build runtime. Design-token gate still applies (no raw colors).
- `server/serve.ts` — serve the bundle under `/app/<project>/*` with **asset-manifest SPA fallback**
  (path not in manifest and not `…/api/*` → `index.html`; dotted route params route correctly), below
  reserved `/api/*`. ⚠️ **shared/serialize**.

**Tests (integration + browser).** Build a scratch `pages/index.tsx` + `pages/items/[id].tsx`; assert
manifest, SPA fallback for a dotted param, relative assets. **chrome-devtools MCP**: load
`localhost:8080/app/<project>/`, confirm the page renders and calls `…/api/feed-list`, row shows,
`mark-read` flips `read` and the page reflects it. `pnpm lint:tokens` green.

**Fan-out plan (2 parallel + integrator):** **5A** build pipeline + `@app/runtime` client; **5B** serving
+ manifest fallback (⚠️ `serve.ts`). **Integrator** runs §0.1 + browser drive, pushes.

---

## Phase 6 — Hooks runtime  🔴 LIVE

**Goal.** In-proc db-change dispatch (decoupled post-commit queue), hook-run endpoint, crontab sync (pod
crond, regenerated on boot; in-process 60s tick local-dev fallback), boot catch-up, loop guard, budget
queue; and `SessionManager.runHeadless(...)` (net-new — the manager only drives interactive sessions today).

**Files:**
- `libs/cli/src/app/hooks/` (new) — loader; **database** dispatch: the main-process `db.*` write path
  **enqueues** matching hooks post-commit and returns; queue drains on the event loop after the eval (no
  re-entrancy). Loop guard (depth cap 3, self-write exclusion, per-hook cooldown/coalesce). Budget queue
  (≤1 pending entry per hook, drain on next attempt after window rolls). `hooks-state.json`.
- `server/session-manager.ts` — **`runHeadless({ projectId, spaceRef, agentSlug, message, budget })`**
  consolidating the `bin.ts --request` headless pattern into the manager. ⚠️ **shared/serialize**.
- `server/serve.ts` — `POST /api/projects/<project>/hooks/<slug>/run` (crond + Studio manual run both hit
  it); boot **crontab regen** (crond starts empty on a fresh pod → must run on boot) + boot **catch-up**
  (run each overdue cron hook once, coalesced, budget-respecting). Local dev: in-process 60s tick.
  ⚠️ **shared/serialize**.

**Tests (unit).** Due/backoff + loop-guard as **pure functions**; decoupled queue never fires
re-entrantly inside a write; boot catch-up runs an overdue hook **once**, immediate second restart →
**no** double-run; budget-exhausted → single coalesced pending entry, runs after window rolls.

**🔴 Live test.** Scratch project with `hooks/enrich-new-items.ts` (database, delegates to a real
`curator` agent) + `hooks/refresh-feed.ts` (cron `every:"5m"`, local tick). Insert a row (via agent or
api) → hook delegates to DeepSeek (`--model S`) → enrich writes back → confirm the row is enriched and
the loop guard stops a cascade. Restart → one catch-up run, no double-run. Trace.

**Fan-out plan (3 parallel + integrator):** **6A** dispatch queue + loop guard + budget (pure, `app/hooks/**`,
heavily unit-tested); **6B** `runHeadless` (⚠️ `session-manager.ts`); **6C** hook-run endpoint + crontab
sync + boot catch-up (⚠️ `serve.ts`). **Integrator** wires 6A↔6B↔6C, runs §0.1 + live, pushes.

---

## Phase 7 — Chat (drop-in agent conversation)  🔴 LIVE

**Goal.** `<Chat agent="space/agent" />` component + extend session-create with a project-relative
`spaceRef`; persist history **under the space**.

**Files:**
- `server/session-manager.ts` + `routes/sessions.ts` — extend `createSession` (already takes
  `{spaceDir, agentSlug, projectId}`) with **`spaceRef`** so a new session loads that specific agent
  (full caps, project-rooted). WS binding by `sessionId` **unchanged**. ⚠️ **shared/serialize**.
- History under the space — **net-new plumbing**: parameterize the snapshot dir by `spaceId`
  (`<project>/spaces/<spaceId>/sessions/`), store `spaceId` on the `SessionEntry`/`PersistedSessionMeta`
  at create-time, add `listSpaceSessions(root, projectId, spaceId)` mirroring `listProjectSessions`; wire
  resume to compute the per-space dir. `Session.resume` reused unchanged. (Today sessions persist only at
  `<project>/sessions/`; `<project>/spaces/<spaceId>/sessions/` is currently excluded from space-file
  reads — keep it backup-excluded.)
- `@app/runtime` `<Chat>` — renders the turn stream with the catalog descriptor renderer (`@lmthing/ui`
  `render-descriptor`, the **one** place that renderer lives in the app), round-trips `ask()` over the
  same socket.

**Tests (integration).** `createSession({ spaceRef })` loads the right agent with full caps; per-space
snapshot dir written; `listSpaceSessions` returns it; resume rehydrates on a fresh VM; WS protocol
unchanged (existing WS tests stay green).

**🔴 Live test.** `<Chat agent="curation/curator">` opens a WS session (`--model S`) on the curator; a
message that makes it `db.insert` a feed item lands in `app.db` (fires the P6 enrich hook), the page
(P5) updates, history is written under `<project>/spaces/curation/sessions/` and resumes on reconnect.
Trace + browser evidence.

**Fan-out plan (2 parallel + integrator):** **7A** `spaceRef` + per-space snapshot/list plumbing
(⚠️ `session-manager.ts`); **7B** `<Chat>` component (`@app/runtime` + `@lmthing/ui`, design-token gate).
**Integrator** runs §0.1 + live + browser, pushes.

---

## Phase 8 — Studio admin/dev + `lmthing.app`/`lmthing.studio` Host anchoring  🟢

**Goal.** Studio management API + app-file routes + Studio UI (editors, data browser, live preview) and
the two-TLD Host anchoring (monorepo devops).

**Files (org submodule):**
- `server/routes/app.ts` (new) + `serve.ts` — `GET /api/projects/<project>/app` (manifest: pages, tables
  +schema, endpoints name/method/IO, hooks +last-run, build status); data browser (read/edit rows);
  manual **hook run** (reuse P6 endpoint); build status/rebuild; **`GET/PUT
  /api/projects/<project>/app/files/<path>`** — **path-scoped** (writes exactly the named file, never
  bulk-`rm`s a dir; refuses `.data/` + `types/`). ⚠️ `serve.ts` shared/serialize.
- `apps/web/src/routes/studio/$projectId/app/` (new) — sibling of `$spaceId`, same `route.tsx`+tab-subdir
  convention: `manifest/ data/ preview/` (editors, data browser, live `…/app/<project>/` preview iframe).
  Strict CSP + sanitize on served pages (P5) — the same-origin preview is the one XSS-sensitive spot.

**Files (monorepo only — commit in monorepo, no submodule):**
- `devops/` + domain nginx/Envoy — `lmthing.app` serves the public app SPA shell at `/` (login → the
  `/apps` launcher; static, JWT-free — same image as studio/chat) and proxies the app itself at
  `/app/<project>/*` to the user's pod (no admin `/api/*` reachable — safe by construction);
  `lmthing.studio` passes `/app/*` + `/api/*` and maps `/` → Studio (pod-routed for those prefixes;
  static shell only otherwise). **Build & validate the engine locally
  (`localhost:8080/app/<project>/`) first; stand up the domain last** (net-new infra).
- **Auth model — SINGLE-USER apps, no app auth (see spec §Serving & domains).** A project-app is only
  for its owner and runs in that user's private pod (the security boundary), so the app layer performs
  **no auth**. **Localhost needs no auth at all** — `lmthing serve` serves `/app/<project>/*` to any
  local request. In prod the only auth is the **platform** picking *which pod*: the user logs in once
  on the `lmthing.app` shell, which sets a **scoped `access_token` cookie**; the gateway's `app-jwt`
  SecurityPolicy validates the per-user JWT from that **cookie** (so page navigations + their relative
  assets route) as well as the `Authorization: Bearer` header / `access_token` param (so SPA fetches
  and the install POST route). One JWT+Lua policy pair covers both `/api/*` (`app-api-proxy`) and
  `/app/*` (`app-pages-proxy`) → `lmthing.user-<sub>.svc:8080`. The pod never checks auth; the gateway
  routes on it. Wiring in `devops/argocd/envoy/app-{routes,policies}.yaml`.

**Tests (integration + browser).** Manifest returns pages/tables/endpoints/hooks/build-status;
app-file route writes exactly one file and **refuses** `.data/`/`types/`; **chrome-devtools MCP** drives
the Studio data browser, manual hook run, and preview iframe; CSP header present on served pages.

**Fan-out plan (3 parallel + integrator):** **8A** management API + app-file routes (org, ⚠️ `serve.ts`);
**8B** Studio UI routes (`apps/web`, token gate); **8C** domain/Envoy config (monorepo devops — separate
push). **Integrator** runs §0.1 + browser, pushes org then monorepo (two pointer commits: submodule for
8A/8B, monorepo for 8C).

---

## Phase 9 — `system-appbuilder` space + THING wiring + system-space audit  🔴 LIVE

**Goal.** The expertise that wields the P1–P8 primitives, cloned from `system-architect`; THING delegates
in and holds no app caps.

**Files:**
- `libs/core/system-spaces/system-appbuilder/` (new) — agents `app-architect` (`project:manage` +
  delegation), `data-modeler` (`db:schema`,`db:read`), `page-builder` (`pages:write`,`db:read`, owns
  npm+build), `api-author` (`api:write`,`db:read`), `automator` (`hooks:write`). Cloned from
  `system-architect`'s builder-function + **per-file `forEach` tasklist** structure (`writeAgentFile`
  analogues → `writePage`/`writeApi`/`writeHook`/`writeTableSchema`; `createProject`/`selectProject`).
  Build the app **incrementally** (createProject → per-table createTable/addColumn → per-page writePage →
  per-endpoint writeApi → per-hook writeHook), one node per file, never one giant scaffold call.
  Register in `SYSTEM_SPACE_NAMES` (`spaces/system.ts`).
- **Authoring target = `store/apps/<appId>/`** (§0.6) — `createProject(id, { title })` scaffolds a **new
  catalog app** under the store catalog (the canonical source), **not** the pod; `selectProject(id)` binds
  an already-installed pod project for iteration. All appbuilder per-file `forEach` writes
  (`writePage`/`writeApi`/`writeHook`/`writeTableSchema`) land in `store/apps/<appId>/`. The catalog root
  is resolved from a configurable path/env (local/dev: the monorepo `store/apps/` on disk; the deployed
  publish path is Phase 10). `'system'` reserved; missing/duplicate id fails loud.
- Authoring globals `writePage/writeApi/writeHook/writeTableSchema` + `createProject`/`selectProject`
  (the "write + apply": rebuild / route-reload / migration) — wired through P1's registry + the P2/P3/P5/P6
  engines.
- `libs/core/system-spaces/user-thing/agents/thing/instruct.md` — add `canDelegateTo: system-appbuilder`
  (**no** `capabilities:` key on THING).
- **System-space audit completion** — verify `system-engineer` (and any file-writing system agent) lands
  writes against `projectRoot`, not its own `spaceDir` (fixes the standing
  `delegate-writes-resolve-against-system-space-dir` known issue). Delete that `.issues/` entry when fixed+tested.

**Tests (unit).** Appbuilder space loads + typechecks against the modular DTS; each agent's caps gate
correctly; `system-engineer` write resolves to `projectRoot` (regression test for the known issue);
THING has no app caps but can delegate to `system-appbuilder`.

**🔴 Live test (capstone).** From a fresh root, `--model S`: **"Build me a personalized feed"** → THING
delegates to `system-appbuilder/app-architect#build` → architect `createProject`s a new
**`store/apps/<appId>/`** catalog entry → fans out to modeler (creates `feed_items`) → page-builder
(writes `pages/index.tsx`, builds) → api-author (writes `feed-list`/`mark-read`) → automator (wires the
enrich/refresh hooks). Confirm end-to-end: the app is authored under **`store/apps/<appId>/`** (not the
system space, not a pod), a subsequent install (Phase 10) + boot serves the built page at
`/app/<project>/`, and an inserted row enriches via hook. Paste the full trace tree.

**Fan-out plan (3 parallel + integrator):** **9A** authoring globals + `createProject`/`selectProject`
(⚠️ P1 registry + engines); **9B** appbuilder agents/tasklists/knowledge (clone from `system-architect`);
**9C** system-space audit (`system-engineer` projectRoot writes + THING `canDelegateTo` + `.issues/`
cleanup). **Integrator** runs §0.1 + the capstone live run, pushes.

---

## Phase 10 — Store distribution: public catalog + CLI-server install endpoint + listing  🟢

**Goal.** Turn `store/apps/` into a **public, installable catalog** and wire the pod to consume it: a
public store site that browses apps, an **install endpoint on the CLI server** that materializes a catalog
app into the user's pod and boots/builds it, and **list** surfaces (available + installed). This brings the
spec's "Distribution (later phase)" note (spec lines ~816–820) into scope, following the existing
`store/spaces/` + `store/src/routes/publish.tsx` precedents.

**Files (monorepo):**
- `store/apps/` (new) — the catalog dir (§0.6). A build step generates **`store/apps/manifest.json`** and
  copies each app template (minus `.data/`/`types/`) into `store/dist/apps/` as **static assets** served by
  nginx (`store/nginx.conf`). No server needed to browse.
- `store/src/routes/apps/index.tsx` + `store/src/routes/apps/$appId.tsx` (new) — public browse list (from
  the static manifest) + app detail with an **"Install to my pod"** action. Reuse the existing
  `category/$categoryId` + `publish` route patterns and the shared design system (token gate; no raw color).
- `store/vite.config.ts` / build script — emit the manifest + copy templates into `dist`.

**Files (org submodule — `libs/cli`):**
- `libs/cli/src/server/routes/apps.ts` (new) + `serve.ts` (⚠️ shared/serialize) —
  **`POST /api/apps/install { appId, projectId? }`**: resolve the catalog app (local/dev: monorepo
  `store/apps/` on disk via a configurable path/env, e.g. `LM_STORE_APPS_DIR`; prod: fetch the published
  files from lmthing.store static assets or a gateway proxy), **materialize** into `<root>/<projectId>/`
  (default `projectId = appId`) with a **path-scoped writer** (never wipe an existing install's `.data/`;
  pristine re-sync vs locally-edited hold-back, `--adopt`-style override — same semantics as system-space
  materialization), then run the **P2 boot sequence** (restore-skip → reconcile → types → P5 build).
  **`GET /api/apps`** — in-pod catalog listing. (`GET /api/projects` already lists installed.)
- Reuse the GitHub-backup/materialize helpers in `libs/cli/src/server/` and the system-space pristine
  re-sync pattern (`runtime-init.ts`).

**Files (monorepo — `cloud/gateway`, only if needed):**
- A thin proxy/authorization route or Envoy rule so the public store site's Install action reaches the
  **authenticated user's pod** install endpoint (per `authentication`/devops skills). Prefer the store SPA
  calling the pod endpoint directly via the existing per-user routing (as `lmthing.app`/`lmthing.studio` do);
  add a `cloud/gateway` route only if CORS/JWT forces it.

**Tests (integration + browser).** Install materializes a catalog app into a fresh pod project; boot builds
it; the page serves at `/app/<project>/`. Re-install of an **unedited** copy re-syncs; an **edited** copy
holds back (divergence flag). `GET /api/apps` lists the catalog; `GET /api/projects` shows the installed
one. **chrome-devtools MCP**: browse `store` apps list → open detail → Install drives the endpoint →
installed app appears and serves. Path-scoped writer refuses traversal / never bulk-`rm`s.

**Live note.** The install→boot→serve path is Node/browser (🟢). **If** the installed demo app runs
hooks/agents on first use, live-test that slice with `--model S` (§0.2).

**Fan-out plan (3 parallel + integrator):**
- **10A — install endpoint + `GET /api/apps`** (org `libs/cli`, ⚠️ `serve.ts`; materialize + boot + path-scoped writer + re-sync semantics + tests).
- **10B — public store SPA** (monorepo `store/`: `apps/index.tsx` + `apps/$appId.tsx` + Install UI; token gate).
- **10C — catalog build + routing glue** (monorepo: manifest generation + template copy into `dist`; `cloud/gateway`/Envoy proxy only if required).
- **Integrator** — wires 10A↔10B↔10C, runs §0.1 + browser drive, **pushes org submodule first (10A), then
  the monorepo (10B/10C) with the pointer bump** (two pointer commits, §0.3).

---

## Phase 11 — Demo app (in `store/apps/`) + docs  🔴 LIVE

**Goal.** A working demo app **as the first `store/apps/` catalog entry**, installed end-to-end via the
Phase 10 endpoint, plus the doc updates that keep space authoring on the new format.

**Files:**
- `store/apps/demo-feed/` (new) — `database/feed_items.json`, `api/feed-list/GET.ts` +
  `api/mark-read/POST.ts`, `pages/index.tsx`, `hooks/refresh-feed.ts` — the §Verification app, and the
  seed entry in the store catalog manifest.
- `sdk/org/SPACE_DEVELOPMENT.md` — new "Project apps" section **+** the space-format changes (the
  `capabilities:` key, fail-loud validation, two-surface db).
- `libs/core/system-spaces/system-architect` — update its **space-format knowledge** so it scaffolds
  current-format spaces (adds `capabilities:` + validation rules) — it is the `app-architect` template; a
  stale architect propagates the old format.
- `CLAUDE.md` (both org + monorepo) — gotchas: project-rooted db; api in Node; pages client-side; hooks
  in-proc dispatch; `<Chat>` is the one place the descriptor renderer lives in the app; agent chat history
  under the space, not the project.

**Tests.** The §Verification checklist (spec lines 708–728) runs green end to end.

**🔴 Live test.** **Install the demo app from the store** (Phase 10 `POST /api/apps/install { appId:
'demo-feed' }`) into a fresh pod, then run the full §Verification sequence on `--model S` against the
**installed** project (page serves, mock/real curator inserts → hook enriches → mark-read flips → page
reflects; cron tick + restart catch-up with no double-run; chat control surface). Confirm the app appears
in `GET /api/apps` (available) and `GET /api/projects` (installed). Then a **fresh live scaffold** through
the updated `system-architect` to prove it now emits current-format frontmatter. Traces.

**Fan-out plan (2 parallel + integrator):** **11A** demo app under `store/apps/demo-feed/` (+ catalog seed);
**11B** docs (`SPACE_DEVELOPMENT.md`, `system-architect` knowledge, both `CLAUDE.md`). **Integrator** runs
the full §Verification live (via install), pushes.

---

## Appendix — per-phase completion report template

Each integrator appends this to `sdk/org/.app-progress.md` and returns it to the orchestrator:

```
### Phase N — <title>  ✅
- Scope delivered: <bullets>
- Gate: build ✅ typecheck ✅ test ✅ (<N new tests>) system-spaces ✅ lint:tokens <✅|n/a>
- Non-breaking: <which pre-existing suites re-run; confirmation none regressed>
- Live/browser evidence: <trace path(s) + one-line what fired>  (or: 🟢 integration only, why)
- Pushed: sdk/org <sha> ; monorepo pointer <sha>
- Follow-ups / risks: <any>
```
