# Continue the app-format v2 effort — W7 (IR) · W9 (slice pipeline) · W10 (gates) + two follow-ups

**Status of the plan (`APPFORMAT_IMPROVE.md`).** W1–W6 and W8 are implemented and on `main`. The
render/format half is done and **live-verified end-to-end**: the real `system-appbuilder` builds an app,
it is served by the prebuilt AppHost (`apps/app-shell`) with **zero per-project build artifacts**, and it
opens in a real browser rendering real data on every route with a working write/toggle path. What remains
is the **intelligence + reliability half** (W7, W9, W10) plus two concrete follow-ups the live run exposed.

This issue is the single pick-up point. Read `APPFORMAT_IMPROVE.md` §7 (W7), §8 (W9), §10+§6 (W10), and
§11a (what was proven) for the grounded detail; this file is the ordered "what next and why".

---

## What is DONE (do not redo)

- **W1** vocabulary (12 sections / 32 elements / 10 fields), **W2** always-on assistant, **W3** nested
  layouts, **W4** v2 file layout (v1 still read), **W5** legacy-TSX-writer removal, **W8** tasklist engine
  (`subgraph`/`checkpoint`/dynamic `forEach` — built, tests in `libs/core/src/tasklist/subgraph.test.ts`,
  **not yet consumed by anything**).
- **W6** — one renderer, zero project build. Steps 0–8 all landed, incl. the compute Dockerfile now
  building + shipping `apps/app-shell/dist` (`devops/argocd/compute/Dockerfile`) so the shell is not dark
  in prod. `runProjectAppCheck` uses `renderSpecAppSmoke` for a spec app; `wrapper.ts` and the wrapper
  helpers are deleted.

Commits (all on `main`, `sdk/org` submodule unless noted): W6 core `6431d70b`; matchRoute fix `2740c4af`;
appbuilder v2-paths `f3404c2c`; renderer `from`-envelope fix `35a0ca09`; Dockerfile `af68e179` (parent repo).

---

## Two HOST/renderer bugs found in the live run — FIXED, with a lasting lesson

Both were the **"structurally-perfect blank page over real data"** class (§L7/§L9). Both **passed every
build gate** and the browser still showed empty data. The reason is the gate/browser mismatch, and it is
the most important thing to carry forward:

> **Gates call endpoints BY NAME and mount views WITHOUT firing effects. The browser calls BY PATH and
> fetches. So a defect in path-routing or in effect-driven data resolution is invisible to every current
> gate and only a live end-to-end run catches it.**

1. **Route precedence** — `libs/cli/src/app/api/loader.ts#matchRoute` returned the first table-order match,
   so `/jobs/list` matched `/jobs/:id` (`id="list"`) → detail handler → empty. Fixed with static-over-param
   specificity (test in `loader.test.ts`). This broke ~every generated app (`<entity>/list` beside `[id]`).
2. **`from`-into-own-query envelope** — `libs/ui/src/view/sections/common.tsx#useSectionSource` resolved a
   list's `from` against the raw `{items:[record]}` instead of the record, so a stats+list dashboard off one
   endpoint rendered stats + an empty list. Fixed to unwrap via `extractRecord` (test in `render.test.tsx`).

**Action for W10:** add a real **by-path, effect-firing render probe** — mount every view against a client
that resolves endpoints BY PATH (not name) and actually fetches, asserting non-empty per route. That gate
is the one that would have caught both. `renderSpecAppSmoke`/`renderSmokeViews` do NOT (name + no effects).

---

## What is LEFT — ordered

### 1. W7 — App IR + declarative API  (**highest priority**)

The live `30-bike-workshop` runs showed a weaker model (DeepSeek `azure:DeepSeek-V4-Pro`) burning most of
its ~1.7M-token / 18–28-min build on failures W7 makes **unrepresentable**:

- a handler returning `uncollected_job_count` its own `FrontPageOutput` never declared (many repair rounds
  on ONE endpoint — the handler↔contract-disagreement class);
- invented imports/APIs each rejected-and-retried: `import ../../types/contract`,
  `import { query } from '@app/runtime'`, `readProjectTable`, `Request` as a handler param, `db` vs `ctx.db`.

The format caught them all (the app still shipped correct), but slowly. `api/<name>.query.json` (tiers 1–3,
§7) with a **generated** handler cannot disagree with its own contract → the class stops existing. This is
net-new work beside the existing writers; `model/<entity>.entity.json` (§2.1) and `compile()/generate()/
check()` are the deliverables. Start here.

### 2. W9 — planning + slice pipeline

Rewrite `build_live_project` (still the original 23-node CONTRACT→BUILD→PROVE DAG at
`libs/core/system-spaces/system-appbuilder/tasklists/build_live_project/`) as P1–P5 + per-slice `subgraph`
+ transactional promotion + owner-routed repair (§8). W8's engine features exist and are unused; this is
their consumer. The spine guarantee (app openable+green after slice 0 and every promotion) is the goal.

### 3. W10 — gate ladder completion

L2 grounding, L10 interaction probes, L11 round-trip, L12 promotion; G1/G3/G4 (G2 exists). **Plus the
by-path render probe above** — treat it as first-class, since it closes the exact gap that shipped the two
host bugs.

---

## Two concrete follow-ups from the live run

- **Assistant-dock WebSocket.** On every AppHost page the chat dock opens
  `ws://…/app/<projectId>/api/ws?sessionId=…` and it fails to handshake in a bare test pod
  (`Connection closed before receiving a handshake response`) — the one console error on an otherwise-clean
  page. It is chat-dock realtime chrome (W2/W3), orthogonal to the app's data rendering, and likely behaves
  differently behind the gateway (auth/session). But "no console errors" is a stated goal (§ definition of
  working). Diagnose: does the standalone pod route/upgrade `/app/<id>/api/ws`? Is a token required that the
  dock does not send? Repro: build any spec app, serve via `bin.js serve` with `LM_APP_SHELL_DIST` set, open
  `/app/<id>/`, check the console.
- **`APPFORMAT.md` is stale.** Its header says "Format v2 is in" but the body still describes v1 — the
  generated-wrapper "whole trick" (§2, §3.7), `pages/<route>.tsx`, "Section kinds (8) / Elements (24) /
  FIELD_KINDS (5)", and §4 node 16 still says `buildProjectApp()` esbuild bundle (now `renderSpecAppSmoke`
  for spec apps). Bring it to v2 (12/32/10, `views/`+top-level `components/`+`shell.view.json`, no wrapper).
  `org/docs/` had a matching source-of-truth pass started but not finished — `pnpm docs:check` should be
  green before closing.

---

## How to verify progress (the loop that found everything above)

The live scenario harness is the truth. From `sdk/org`:

```
node scenarios/run-scenario.mjs 30-bike-workshop --through 2 --keep-server --keep-project --verbose
```

It builds through the REAL space agent (from TS source, so uncommitted fixes are live), serves via the
prebuilt AppHost, and keeps the pod up. Then open `/app/bike-workshop/` in a browser (chrome-devtools MCP)
and check: real data on every route, the collect toggle updates the dashboard, **zero console errors**. Run
`08-small-shop`/`31-food-coop`/`32-festival` for other domains. Do NOT trust a green build envelope alone —
by construction it cannot see the by-path/effect-driven failures (see the lesson above).

Delete this issue when W7, W9, W10 and the two follow-ups are done and live-verified.
