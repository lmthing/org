import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createStaticApps, resolveAppDist } from './static-apps.js';
import { createDevWeb, type DevWeb } from './dev-web.js';
import type { SessionManager, SessionEntry } from './session-manager.js';
import type { UiControlAction } from '../rpc/events.js';
import { Router } from './router.js';

// ─── Route handlers ───────────────────────────────────────────────────────────
import { applyEnvContent, handleEnvGet, handleEnvPut } from './routes/env.js';
import { handlePricesAzure } from './routes/prices.js';
import { handleBudget } from './routes/budget.js';
import { handleCreateSession, handleListSessions, handleDeleteSession, handleSessionSubRoute } from './routes/sessions.js';
import { handleListSessionLedger } from './routes/session-ledger.js';
import {
  handleListProjects, handleCreateProject, handleDeleteProject,
  handleGetProjectInstructions, handlePutProjectInstructions,
  handleListDocuments, handleCreateDocument,
  handleListProjectSessions, handleListSpaceSessions,
  handleGetProjectSpaceFiles, handlePutProjectSpaceFiles, handlePostProjectSpaceFile,
  handlePutProjectSpaceFile, handleDeleteProjectSpaceFile,
  handleListProjectSpaces, handleGetProjectCompletions,
} from './routes/projects.js';
import { handleCreateSpace } from './routes/spaces.js';
import { handleFsTree, handleFsRead, handleFsWrite } from './routes/fs.js';
import { handleUpload, handleServeUpload } from './routes/uploads.js';
import { handleBackupNow, handleBackupStatus, handleRestore } from './routes/backup.js';
import { runBackup, startBackupTimer } from './backup.js';
import { startSelfIdleWatchdog } from './self-idle.js';
import { startMemWatchdog } from './mem-watchdog.js';
import { buildCronManifest, publishCronManifest } from './cron-manifest.js';
import { handleReportBug } from './routes/report-bug.js';
import { createAppApiHandler } from './routes/app-api.js';
import { createPageServeHandler } from '../app/pages-serve.js';
import { buildProjectPages } from '../app/build/pages.js';
import { createHookRunHandler, createHooksListHandler, createHookDisableHandler, bootCatchUpAndSchedule } from './routes/hooks.js';
import { createInboundHandler } from './routes/webhooks.js';
import { republishAll, buildRepublishDeps } from './republish.js';
import { emitInternalSignal, installInternalSignalSink } from './internal-signals.js';
import type { EventDispatchManager } from './event-dispatch.js';
import {
  handleAppManifest, handleGetAppFile, handlePutAppFile,
  handleListRows, handleUpdateRow, handleBuildStatus, handleRebuild, handleAppCheck,
} from './routes/app-admin.js';
import { handleListApps, handleInstallApp } from './routes/apps.js';
import {
  handleListChannels, handleCreateChannel, handlePatchChannel, handleCreateDm,
  handleListCategories, handleCreateCategory, handlePatchCategory, handleDeleteCategory,
  handleDirectory, handleGetProfile, handlePutProfile,
  handleListMessages, handlePostMessage,
} from './routes/team-channels.js';
import { guardRequest, guardWebSocket, isTeamMode } from './team-guard.js';
import { handleListStoreSpaces, handleInstallStoreSpace, handleListProjectIntegrations } from './routes/store-spaces.js';
import { listProjects } from './projects.js';

// ─── WebSocket handlers ───────────────────────────────────────────────────────
import { handleAgentWsUpgrade } from './ws/agent.js';
import { handleTerminalWsUpgrade } from './ws/terminal.js';
import { handleChannelWsUpgrade } from './ws/team-channels.js';

export interface SessionServerOpts {
  port: number;
  manager: SessionManager;
  /** dist/web/app.tsx anchor — used to resolve react/@lmthing/ui from the CLI root. */
  appTsxPath?: string;
  /** Default space dir used when POST /api/sessions omits one (also for bundling the app). */
  defaultSpaceDir?: string;
  /** Root dir under which POST /api/spaces writes synced spaces (default $SPACES_DIR or /data/spaces). */
  spacesRoot?: string;
  /** Absolute path to `<cwd>/.lmthing`. When provided, project-aware routes are
   *  enabled and the default 'user' project is scaffolded at startup. Takes
   *  precedence over any `lmthingRoot` already set on the manager (they should
   *  match in practice; the manager's value is used for actual operations). */
  lmthingRoot?: string;
}

export interface SessionServerHandle {
  /** The port the HTTP+WS server is actually listening on. */
  port: number;
  /** Shut down the WS + HTTP server (used by tests; bin.ts keeps it running). */
  close: () => Promise<void>;
}

/**
 * First path segments the ROOT app mount (`/<project>/…`) must never claim, because this
 * same server answers them: the reserved API prefix, the `/app/<project>/` mount itself,
 * the SPA's own bundle + icon, and the SPA's client routes. A project named after one of
 * these is served at `/app/<project>/` (it keeps its clean URL nowhere else); everything
 * else falls through to the SPA, so the root mount can stay always-on.
 */
const RESERVED_ROOT_SEGMENTS = new Set([
  'api', 'app', 'assets', 'favicon.ico', 'install',
  'chat', 'studio', 'computer', 'team',
]);

export async function startSessionServer(opts: SessionServerOpts): Promise<SessionServerHandle> {
  const { manager, port } = opts;

  // Redirect all console output to /tmp/lmthing-server.log so the computer app
  // can tail it in the read-only "process" terminal tab.
  try {
    const { createWriteStream } = await import('node:fs');
    const _logStream = createWriteStream('/tmp/lmthing-server.log', { flags: 'a' });
    for (const level of ['log', 'warn', 'error'] as const) {
      const orig = console[level].bind(console) as (...args: unknown[]) => void;
      console[level] = (...args: unknown[]) => {
        try { _logStream.write(args.map(String).join(' ') + '\n'); } catch { /* ignore write errors */ }
        orig(...args);
      };
    }
  } catch { /* if we can't create the log file, continue without it */ }

  // Apply a persisted custom env file (written via PUT /api/env) at startup so
  // user-provided credentials (e.g. AZURE_API_KEY) survive pod restarts.
  try {
    const startupEnv = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    applyEnvContent(startupEnv);
    console.log('[serve] applied persisted .env');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[serve] could not read .env:', e instanceof Error ? e.message : e);
    }
  }

  // Ensure the default project exists when running in project mode.
  const effectiveLmthingRoot = manager.lmthingRoot ?? opts.lmthingRoot;

  // Where POST /api/spaces writes synced spaces.
  const spacesRoot = effectiveLmthingRoot
    ? join(effectiveLmthingRoot, 'user', 'spaces')
    : resolve(opts.spacesRoot ?? process.env['SPACES_DIR'] ?? '/data/spaces');
  if (effectiveLmthingRoot) {
    try {
      await manager.ensureDefaultProject();
    } catch (err) {
      console.warn('[serve] could not scaffold default project:', err instanceof Error ? err.message : err);
    }
  }

  const staticApps = createStaticApps(resolveAppDist());
  // Dev only: when LM_DEV_WEB points at the web app source, serve it in-process
  // via Vite (HMR) on THIS port — no separate dev-server port. Set by `pnpm thing`.
  let devWeb: DevWeb | null = null;

  const broadcastUiControl = (entry: SessionEntry): ((action: UiControlAction) => void) =>
    (action) => entry.renderHost.emit({ type: 'ui_control', action });

  const ctx = { manager, spacesRoot, effectiveLmthingRoot, broadcastUiControl };

  // ─── Build the route registry ─────────────────────────────────────────────
  const router = new Router();

  // Prices
  router.add('GET', '/api/prices/azure', handlePricesAzure);

  // Budget (lmthingcloud rolling windows: remaining % per 1d/7d/30d)
  router.add('GET', '/api/budget', handleBudget);

  // Restart
  router.add('POST', '/api/restart', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => process.exit(0), 100);
  });

  // Keep-warm heartbeat. The SPA pings this (POST) while its tab is visible so a
  // user actively reading/using an open surface doesn't idle out and eat a cold
  // wake on their next click. It's a POST, so the outer server wrapper's activity
  // tracking bumps `lastMutatingRequestAt` for free — the handler just 200s. A
  // hidden/closed tab stops pinging → the pod idles out normally.
  router.add('POST', '/api/keepalive', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  });

  // Env
  router.add('GET', '/api/env', handleEnvGet);
  router.add('PUT', '/api/env', handleEnvPut);

  // Sessions (collection-level)
  router.add('POST', '/api/sessions', handleCreateSession);
  router.add('GET', '/api/sessions', handleListSessions);

  // Session/delegate ledger (settings UI)
  router.add('GET', '/api/session-ledger', handleListSessionLedger);

  // Projects
  router.add('GET', '/api/projects', handleListProjects);
  router.add('POST', '/api/projects', handleCreateProject);
  router.add('DELETE', '/api/projects/:projectId', handleDeleteProject);
  router.add('GET', '/api/projects/:projectId/instructions', handleGetProjectInstructions);
  router.add('PUT', '/api/projects/:projectId/instructions', handlePutProjectInstructions);
  router.add('GET', '/api/projects/:projectId/documents', handleListDocuments);
  router.add('POST', '/api/projects/:projectId/documents', handleCreateDocument);
  router.add('GET', '/api/projects/:projectId/sessions', handleListProjectSessions);
  router.add('GET', '/api/projects/:projectId/spaces/:spaceId/sessions', handleListSpaceSessions);
  router.add('GET', '/api/projects/:projectId/spaces/:spaceId/files', handleGetProjectSpaceFiles);
  router.add('PUT', '/api/projects/:projectId/spaces/:spaceId/files', handlePutProjectSpaceFiles);
  router.add('POST', '/api/projects/:projectId/spaces/:spaceId/files', handlePostProjectSpaceFile);
  router.add('PUT', '/api/projects/:projectId/spaces/:spaceId/files/*', handlePutProjectSpaceFile);
  router.add('DELETE', '/api/projects/:projectId/spaces/:spaceId/files/*', handleDeleteProjectSpaceFile);
  router.add('GET', '/api/projects/:projectId/spaces', handleListProjectSpaces);
  router.add('GET', '/api/projects/:projectId/completions', handleGetProjectCompletions);
  router.add('GET', '/api/projects/:projectId/integrations', handleListProjectIntegrations(effectiveLmthingRoot));

  // Liveness. The kubelet's startup probe targets this: it comes from inside the
  // cluster rather than through Envoy, so it carries no identity and must stay
  // answerable without one (team-guard.ts#PUBLIC_PATHS). It therefore discloses
  // nothing — reaching this line already proves the server is listening.
  // Must be async: dispatch() calls .catch() on whatever a handler returns, so a
  // synchronous handler crashes the process on its very first request.
  router.add('GET', '/api/health', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  });

  // Spaces sync
  router.add('POST', '/api/spaces', handleCreateSpace);

  // Team channels — the shared chat surface, registered ONLY on a team pod so a
  // personal pod's API is byte-identical to what it was before teams existed.
  // Structuring the team (channels, categories) is configuring it, so team-guard
  // makes those editor-only; reading, posting, opening a DM and setting your own
  // handle are open to every member.
  if (isTeamMode()) {
    router.add('GET', '/api/team/channels', handleListChannels(effectiveLmthingRoot));
    router.add('POST', '/api/team/channels', handleCreateChannel(effectiveLmthingRoot));
    router.add('PATCH', '/api/team/channels/:channelId', handlePatchChannel(effectiveLmthingRoot));
    router.add('GET', '/api/team/channels/:channelId/messages', handleListMessages(effectiveLmthingRoot));
    router.add('POST', '/api/team/channels/:channelId/messages', handlePostMessage(manager, effectiveLmthingRoot));
    router.add('POST', '/api/team/dms', handleCreateDm(effectiveLmthingRoot));
    router.add('GET', '/api/team/categories', handleListCategories(effectiveLmthingRoot));
    router.add('POST', '/api/team/categories', handleCreateCategory(effectiveLmthingRoot));
    router.add('PATCH', '/api/team/categories/:categoryId', handlePatchCategory(effectiveLmthingRoot));
    router.add('DELETE', '/api/team/categories/:categoryId', handleDeleteCategory(effectiveLmthingRoot));
    router.add('GET', '/api/team/directory', handleDirectory(effectiveLmthingRoot));
    router.add('GET', '/api/team/profile', handleGetProfile(effectiveLmthingRoot));
    router.add('PUT', '/api/team/profile', handlePutProfile(effectiveLmthingRoot));
  }

  // Per-session routes (DELETE session + all sub-routes via catch-all)
  router.add('DELETE', '/api/sessions/:id', handleDeleteSession);
  router.add('*', '/api/sessions/:id/*', handleSessionSubRoute);

  // Chat attachments (vision/audio/file upload): store + serve back for the UI.
  router.add('POST', '/api/uploads', handleUpload);
  router.add('GET', '/api/uploads/:id', handleServeUpload);

  // Filesystem
  router.add('GET', '/api/fs/tree', handleFsTree);
  router.add('GET', '/api/fs/read', handleFsRead);
  router.add('PUT', '/api/fs/write', handleFsWrite);

  // Workspace backup / restore to the user's GitHub repo
  router.add('POST', '/api/backup', handleBackupNow);
  router.add('GET', '/api/backup/status', handleBackupStatus);
  router.add('POST', '/api/restore', handleRestore);

  // Bug reports: forward the report + session trace history to the gateway
  router.add('POST', '/api/report-bug', handleReportBug);

  // Project-app API runtime — `/app/<project>/api/<name>` (browser-facing; the agent's
  // apiCall enters the same runtime by name). Handlers run Node, worker-isolated. This
  // is OUTSIDE the reserved `/api/*` (so the 404 rule above never intercepts it) and
  // matched by the router before the static SPA fallback.
  const appApiHandler = createAppApiHandler(manager, effectiveLmthingRoot);
  router.add('*', '/app/:projectId/api/*', appApiHandler);

  // Hook-run endpoint (Phase 6) — the ONE authoritative run path that Studio's manual
  // run, the pod crond, and the boot catch-up/tick all funnel through. Reserved `/api/`.
  router.add('POST', '/api/projects/:projectId/hooks/:slug/run', createHookRunHandler(manager, effectiveLmthingRoot));

  // Hooks list + enable/disable (settings UI)
  router.add('GET', '/api/hooks', createHooksListHandler(effectiveLmthingRoot));
  router.add('POST', '/api/projects/:projectId/hooks/:slug/disabled', createHookDisableHandler(manager, effectiveLmthingRoot));

  // Inbound-webhook dispatcher (Phase 1) — external `POST /api/inbound/:path` fires the
  // project's `webhook` hook bound to `:path` (globally unique per pod). Reserved `/api/`.
  router.add('POST', '/api/inbound/:path', createInboundHandler(manager, effectiveLmthingRoot));

  // Studio admin/dev management API (Phase 8) — reserved `/api/`, NOT the app's own
  // `/app/<project>/api/*`. Register the specific sub-routes before the bare `/app` manifest.
  router.add('GET', '/api/projects/:projectId/app/build', handleBuildStatus(manager, effectiveLmthingRoot));
  // A rebuild emits NEW content-hashed assets, so the cached bundle (below) is stale the moment
  // it returns: its manifest still lists the old `entry-*.js`, while the fresh index.html asks
  // for the new one → the asset falls through to the SPA shell and the app renders BLANK.
  router.add(
    'POST',
    '/api/projects/:projectId/app/build',
    handleRebuild(manager, effectiveLmthingRoot, (projectId) => {
      pageBuildCache.delete(projectId);
    }),
  );
  // The AUTHORITATIVE verdict (typecheck THEN bundle) — `app/build` above is esbuild-only and
  // reports `built:true` for an app that does not type-check. Same call as the `buildApp()` global.
  router.add('POST', '/api/projects/:projectId/app/check', handleAppCheck(manager, effectiveLmthingRoot));
  router.add('GET', '/api/projects/:projectId/app/data/:table', handleListRows(manager, effectiveLmthingRoot));
  router.add('PATCH', '/api/projects/:projectId/app/data/:table/:id', handleUpdateRow(manager, effectiveLmthingRoot));
  router.add('GET', '/api/projects/:projectId/app/files/*', handleGetAppFile(manager, effectiveLmthingRoot));
  router.add('PUT', '/api/projects/:projectId/app/files/*', handlePutAppFile(manager, effectiveLmthingRoot));
  router.add('GET', '/api/projects/:projectId/app', handleAppManifest(manager, effectiveLmthingRoot));

  // Per-project built-pages cache (declared before the install route so a reinstall can
  // invalidate it). The bundle is built lazily per project (esbuild; buildProjectPages caches
  // by content hash internally) and the result is cached here for the server's lifetime.
  const pageBuildCache = new Map<string, { outDir: string; assetManifest: string[] } | null>();

  // Store distribution (Phase 10) — list the catalog + install a catalog app into the
  // user's runtime root (materialize `store/projects/<id>/` → `<root>/<projectId>/`, then boot
  // + build). Reserved `/api/*`, so these match before the SPA catch-all. On (re)install we
  // DROP the cached page build so the freshly-rebuilt assets (new hashes) are served instead
  // of the stale manifest (which would 404 the new assets/entry-*.js → blank app).
  router.add('GET', '/api/apps', handleListApps());
  router.add(
    'POST',
    '/api/apps/install',
    handleInstallApp(manager, effectiveLmthingRoot, undefined, (projectId) => {
      pageBuildCache.delete(projectId);
    }),
  );

  // Store-installable integration spaces (a project installs the ones it needs
  // into its OWN `spaces/` dir, rather than every session always carrying all
  // of them — see routes/store-spaces.ts). Dropping the page cache mirrors the
  // app-install invalidation above; harmless when the project has no pages.
  router.add('GET', '/api/store/spaces', handleListStoreSpaces());
  router.add(
    'POST',
    '/api/store/spaces/install',
    handleInstallStoreSpace(effectiveLmthingRoot, undefined, (projectId, spaceId?: string) => {
      pageBuildCache.delete(projectId);
      // Republish-on-write (S9): a freshly installed space may add webhook/cron
      // emitter defs + `events/*.ts` — regenerate the manifest + crontab and drop
      // the emitter scan cache so they go live without a pod restart. Fire-and-forget
      // (the install response never blocks on it); no-op until boot wires it.
      void manager.republish();
      // S8 instrumentation: space installed into a project. The install route's
      // callback contract currently passes only `projectId`; `spaceId` rides along
      // once the route forwards it (this callback already accepts it — additive).
      emitInternalSignal('space.installed', { projectId, ...(spaceId ? { spaceId } : {}) });
    }),
  );

  // Project-app PAGES — `/app/<project>/*` (non-api). The built React bundle is served
  // with an asset-manifest SPA fallback (dotted route params route client-side) + a strict
  // CSP. Registered AFTER the api route so `…/api/*` matches first.
  const getOutDirForProject = async (projectId: string): Promise<{ outDir: string; assetManifest: string[] } | null> => {
    if (!effectiveLmthingRoot) return null;
    if (!pageBuildCache.has(projectId)) {
      let built: { outDir: string; assetManifest: string[] } | null = null;
      try {
        const r = await buildProjectPages(join(effectiveLmthingRoot, projectId));
        if (r.assetManifest.length > 0) built = { outDir: r.outDir, assetManifest: r.assetManifest };
      } catch (err) {
        console.error(`[app] page build failed for "${projectId}": ${err instanceof Error ? err.message : String(err)}`);
      }
      pageBuildCache.set(projectId, built);
    }
    return pageBuildCache.get(projectId) ?? null;
  };
  router.add('*', '/app/:projectId/*', createPageServeHandler(getOutDirForProject));

  // Project-app ROOT mount — `/<project>/*` (+ `/<project>/api/*`), the SAME app
  // served with NO `/app` prefix so lmthing.app can show clean URLs
  // (`lmthing.app/blog/…`): in prod Envoy reserves `/api`,`/assets`,`/favicon.ico`,
  // `/install` and Exact `/` for the shell (a separate nginx image) and sends the
  // rest of the catch-all straight here.
  //
  // ALWAYS registered — and it falls THROUGH (to the SPA) for any first segment that
  // is not a project with a built app, which is what makes that safe. It used to be
  // gated on LMTHING_GATEWAY_URL (present only on gateway-provisioned pods) because a
  // bare `/:projectId/*` would otherwise shadow every SPA route on a local serve. That
  // gate is how EVERY app came to render blank in prod: a pod whose `user-env` Secret
  // predated the variable never got it, so `/<project>/` matched no route at all, fell
  // to the SPA catch-all, and answered 200 with the POD SHELL — whose own bundle is
  // root-absolute `/assets/index-*.js` and 404s under the app's mount. The app looked
  // built, served and empty, and `/<project>/api/<route>` returned that same HTML
  // instead of JSON. Serving must not depend on an env var that can go missing.
  // Registered LAST, so the literal `/api/*` and `/app/*` routes above always win over
  // the `:projectId` param.
  const webFallback = (req: IncomingMessage, res: ServerResponse): void => {
    if (devWeb) { devWeb.handle(req, res); return; }
    void staticApps.handle(req, res);
  };
  const rootPageServe = createPageServeHandler(getOutDirForProject, '', webFallback);
  router.add('*', '/:projectId/api/*', async (req, res, params) => {
    if (RESERVED_ROOT_SEGMENTS.has(params['projectId']!)) { webFallback(req, res); return; }
    await appApiHandler(req, res, params);
  });
  router.add('*', '/:projectId/*', async (req, res, params) => {
    if (RESERVED_ROOT_SEGMENTS.has(params['projectId']!)) { webFallback(req, res); return; }
    await rootPageServe(req, res, params);
  });

  // ─── Activity tracking (for the self-idle watchdog) ───────────────────────
  // "Busy" = a turn is running OR a mutating request is in flight (e.g. a hook
  // run). We deliberately IGNORE GET/HEAD/OPTIONS so the K8s readiness probe
  // (GET /api/sessions every 5s) and SPA polling never keep an idle pod awake —
  // only real activity (agent turns, session creates, message posts, hook runs)
  // counts, matching the session reaper's notion of idleness.
  const serverStartTime = Date.now();
  let inFlightMutating = 0;
  let lastMutatingRequestAt = serverStartTime;
  const isBusy = (): boolean =>
    manager.runningCount() > 0 || inFlightMutating > 0;
  const lastActivityMs = (): number =>
    Math.max(manager.lastActivityAt(), lastMutatingRequestAt, serverStartTime);

  // ─── HTTP server ──────────────────────────────────────────────────────────
  const httpServer = createServer((req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();

    // On a TEAM pod, decide who is calling and whether their role permits this
    // before any handler runs. Inert on a personal pod (see team-guard.ts).
    const verdict = guardRequest(req, new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!verdict.ok) {
      res.writeHead(verdict.status ?? 403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: verdict.error ?? 'forbidden' }));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      inFlightMutating++;
      lastMutatingRequestAt = Date.now();
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        inFlightMutating = Math.max(0, inFlightMutating - 1);
        lastMutatingRequestAt = Date.now();
      };
      res.on('finish', settle);
      res.on('close', settle);
    }
    const matched = router.dispatch(req, res, ctx);
    if (matched) return;
    // Unknown /api/* → 404
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `unknown API route ${req.method ?? 'GET'} ${path}` }));
      return;
    }
    // Web app: Vite dev middleware (HMR) when enabled, else the built dist.
    if (devWeb) { devWeb.handle(req, res); return; }
    void staticApps.handle(req, res);
  });

  // ─── WebSocket upgrade ────────────────────────────────────────────────────
  const terminalCwd = effectiveLmthingRoot ?? process.cwd();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    // Dev: let Vite's own upgrade listener handle its HMR socket (identified by
    // the `vite-hmr` subprotocol); don't claim it for the agent WS.
    if (devWeb && String(req.headers['sec-websocket-protocol'] ?? '').includes('vite-hmr')) return;
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Same role gating as HTTP — a viewer may talk, but not open a terminal.
    const verdict = guardWebSocket(req, url.pathname);
    if (!verdict.ok) {
      socket.write(
        `HTTP/1.1 ${verdict.status ?? 403} Forbidden\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    if (url.pathname === '/api/team/ws') {
      handleChannelWsUpgrade(req, socket, head, wss);
      return;
    }
    const termMatch = url.pathname.match(/^\/api\/terminals\/([^/]+)$/);
    if (termMatch) {
      handleTerminalWsUpgrade(req, socket, head, wss, terminalCwd, termMatch[1]!);
      return;
    }
    handleAgentWsUpgrade(req, socket, head, { wss, manager, terminalCwd });
  });

  const devWebDir = process.env['LM_DEV_WEB'];
  if (devWebDir) {
    devWeb = await createDevWeb(devWebDir, httpServer);
    console.log(`[serve] dev web (Vite HMR) enabled from ${devWebDir}`);
  }

  await new Promise<void>((res) => httpServer.listen(port, res));
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const httpBase = `http://localhost:${actualPort}`;
  console.log(`Multi-session server ready: ${httpBase}`);
  console.log(`Create a session:  POST ${httpBase}/api/sessions`);

  // Hooks (Phase 6): regenerate the pod crontab (guarded), run overdue cron hooks once
  // (boot catch-up), and — with no crond (local dev) — start an in-process 60s tick. All
  // drive the same hook-run endpoint above. Also warms each project's db so its `database`
  // hooks wire to the onWrite seam.
  let hookTick: NodeJS.Timeout | undefined;
  let selfIdleTimer: NodeJS.Timeout | undefined;
  if (effectiveLmthingRoot) {
    // Internal-signal sink (S8): route fire-and-forget runtime signals (session /
    // hook / install / document / project lifecycle) to `internal`-type emitter
    // defs → subscribing event hooks. Installed SYNCHRONOUSLY (not in the async
    // boot block below) so signals from the very first request are routed;
    // anything fired before this line is dropped by design (fire-and-forget bus).
    installInternalSignalSink({
      root: effectiveLmthingRoot,
      // The concrete SessionManager satisfies EventDispatchManager structurally
      // (runHeadless/runHeadlessThreaded/getProjectDb/runTasklistHeadless).
      manager: manager as EventDispatchManager,
      listProjectIds: async () =>
        (await listProjects(effectiveLmthingRoot)).map((p) => p.id).filter((id) => id !== 'system'),
    });
    // Run all boot-time app/cron work OFF the readiness path. The HTTP server is
    // already listening (above), so the K8s startup probe (`GET /api/sessions`)
    // must NOT be blocked by the synchronous better-sqlite3 opens/reconciles in the
    // db-warm loop or by an overdue cron hook that runs a full agent turn. This runs
    // in the background (not awaited) and yields the event loop between units so the
    // probe is serviced promptly; the pod is Ready in ~1-2s regardless of how many
    // apps/overdue crons exist. `hookTick`/`selfIdleTimer` are assigned into the
    // outer `let`s so `close()` still clears them (a shutdown racing boot just sees
    // `undefined` — harmless).
    void (async () => {
    try {
      const root = effectiveLmthingRoot;
      const projects = (await listProjects(root)).map((p) => p.id).filter((id) => id !== 'system');
      // Warm each project's db so its database-hook runtime is wired (getProjectDb
      // side-effect). Yield after each so the readiness probe runs between the
      // synchronous db open + schema reconcile of one project and the next.
      for (const id of projects) {
        try { await manager.getProjectDb(root, id); } catch { /* skip */ }
        await new Promise<void>((r) => setImmediate(r));
      }
      const runHookFn = async (projectId: string, slug: string): Promise<unknown> => {
        const r = await fetch(`${httpBase}/api/projects/${projectId}/hooks/${slug}/run`, { method: 'POST' });
        return r.json().catch(() => ({}));
      };
      const { tick } = await bootCatchUpAndSchedule(manager, root, projects, actualPort, runHookFn);
      hookTick = tick;

      // ── Externalized cron + self-idle scale-to-zero (prod pods only) ────────
      // Gated on the gateway-injected env (compute JWT + gateway URL), which is
      // ABSENT under `lmthing serve` — so this whole block is inert in local dev.
      const gatewayUrl = process.env.LMTHING_GATEWAY_URL;
      const computeJwt = process.env.LMTHING_COMPUTE_JWT;
      // Publish the cron schedule to the gateway on boot + whenever it changes
      // (a hook ran ⇒ nextRunAt advanced). The gateway wakes the pod at each due
      // next_run_at while it sleeps.
      let lastManifestJson = '';
      const publishManifestIfChanged = async (): Promise<void> => {
        if (!gatewayUrl || !computeJwt) return;
        try {
          const jobs = await buildCronManifest(root, projects, Date.now());
          const json = JSON.stringify(jobs);
          if (json === lastManifestJson) return;
          lastManifestJson = json;
          await publishCronManifest(gatewayUrl, computeJwt, jobs);
        } catch (err) {
          console.warn('[cron-manifest] build/publish failed:', err instanceof Error ? err.message : err);
        }
      };
      await publishManifestIfChanged();

      // Republish-on-write callable (S9): rebuild+publish the inbound-webhook
      // manifest (so the gateway can route `<gateway>/webhooks/<path>` here, waking
      // the pod), regenerate the crontab, and drop the emitter scan cache. The SAME
      // callable is reused after installs (serve.ts store-install callback) and
      // authoring writes (S11, via `manager.republish()`). Wire it now that the
      // server port + gateway config are known, then run it once at boot (this
      // replaces the former inline webhook-manifest publish). Gateway publish is
      // inert without gateway env — same gating as the cron manifest above.
      const republish = (): Promise<void> =>
        republishAll(
          buildRepublishDeps({
            root,
            listProjectIds: async () =>
              (await listProjects(root)).map((p) => p.id).filter((id) => id !== 'system'),
            serverPort: actualPort,
            gateway: gatewayUrl && computeJwt ? { url: gatewayUrl, jwt: computeJwt } : undefined,
          }),
        );
      manager.setRepublish(republish);
      // An authored page/api write must also drop the SERVED bundle, or the running app keeps
      // showing the pre-write build (see session-manager's `onAppWrite`).
      manager.setInvalidatePageBuild((projectId) => {
        pageBuildCache.delete(projectId);
      });
      await republish();

      if (gatewayUrl && computeJwt && process.env.LMTHING_SELF_IDLE !== '0') {
        selfIdleTimer = startSelfIdleWatchdog({
          gatewayUrl,
          jwt: computeJwt,
          idleMs: manager.idleTtlMs,
          isBusy,
          lastActivityMs,
          onTick: publishManifestIfChanged,
        });
      }
    } catch (err) {
      console.warn('[hooks] boot catch-up/schedule failed:', err instanceof Error ? err.message : err);
    }
    })();
  }

  // In-pod memory watchdog (P3): sheds idle sessions before the cgroup OOMKills.
  // Inert off-container (no cgroup v2 memory limit) — a no-op under `lmthing serve`.
  const memTimer = startMemWatchdog({ evictOneIdle: () => manager.evictOneIdle() });

  // Workspace backup: start the auto timer (no-op unless GITHUB_BACKUP_AUTO=1),
  // and flush a final backup on SIGTERM so idle scale-to-zero / restarts don't
  // lose un-backed-up changes. Best-effort with a hard cap so we exit within
  // the pod's termination grace period.
  if (effectiveLmthingRoot) {
    const backupRoot = effectiveLmthingRoot;
    startBackupTimer(backupRoot);
    process.on('SIGTERM', () => {
      const flush = runBackup({ trigger: 'shutdown', workTree: backupRoot }).catch((err) => {
        console.warn('[serve] shutdown backup failed:', err instanceof Error ? err.message : err);
      });
      const cap = new Promise((r) => setTimeout(r, 25_000).unref?.());
      void Promise.race([flush, cap]).finally(() => process.exit(0));
    });
  }

  return {
    port: actualPort,
    close: async () => {
      if (hookTick) clearInterval(hookTick);
      if (selfIdleTimer) clearInterval(selfIdleTimer);
      if (memTimer) clearInterval(memTimer);
      try { manager.closeProjectDbs(); } catch { /* best-effort */ }
      if (devWeb) await devWeb.close();
      wss.close();
      await new Promise<void>((res) => httpServer.close(() => res()));
    },
  };
}
