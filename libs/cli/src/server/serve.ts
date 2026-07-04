import { createServer } from 'node:http';
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
import { handleBackupNow, handleBackupStatus, handleRestore } from './routes/backup.js';
import { runBackup, startBackupTimer } from './backup.js';
import { handleReportBug } from './routes/report-bug.js';
import { createAppApiHandler } from './routes/app-api.js';
import { createPageServeHandler } from '../app/pages-serve.js';
import { buildProjectPages } from '../app/build/pages.js';
import { createHookRunHandler, bootCatchUpAndSchedule } from './routes/hooks.js';
import {
  handleAppManifest, handleGetAppFile, handlePutAppFile,
  handleListRows, handleUpdateRow, handleBuildStatus, handleRebuild,
} from './routes/app-admin.js';
import { handleListApps, handleInstallApp } from './routes/apps.js';
import { listProjects } from './projects.js';

// ─── WebSocket handlers ───────────────────────────────────────────────────────
import { handleAgentWsUpgrade } from './ws/agent.js';
import { handleTerminalWsUpgrade } from './ws/terminal.js';

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

  // Env
  router.add('GET', '/api/env', handleEnvGet);
  router.add('PUT', '/api/env', handleEnvPut);

  // Sessions (collection-level)
  router.add('POST', '/api/sessions', handleCreateSession);
  router.add('GET', '/api/sessions', handleListSessions);

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

  // Spaces sync
  router.add('POST', '/api/spaces', handleCreateSpace);

  // Per-session routes (DELETE session + all sub-routes via catch-all)
  router.add('DELETE', '/api/sessions/:id', handleDeleteSession);
  router.add('*', '/api/sessions/:id/*', handleSessionSubRoute);

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

  // Studio admin/dev management API (Phase 8) — reserved `/api/`, NOT the app's own
  // `/app/<project>/api/*`. Register the specific sub-routes before the bare `/app` manifest.
  router.add('GET', '/api/projects/:projectId/app/build', handleBuildStatus(manager, effectiveLmthingRoot));
  router.add('POST', '/api/projects/:projectId/app/build', handleRebuild(manager, effectiveLmthingRoot));
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

  // ─── HTTP server ──────────────────────────────────────────────────────────
  const httpServer = createServer((req, res) => {
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
  if (effectiveLmthingRoot) {
    try {
      const root = effectiveLmthingRoot;
      const projects = (await listProjects(root)).map((p) => p.id).filter((id) => id !== 'system');
      // Warm each project's db so its database-hook runtime is wired (getProjectDb side-effect).
      for (const id of projects) { try { await manager.getProjectDb(root, id); } catch { /* skip */ } }
      const runHookFn = async (projectId: string, slug: string): Promise<unknown> => {
        const r = await fetch(`${httpBase}/api/projects/${projectId}/hooks/${slug}/run`, { method: 'POST' });
        return r.json().catch(() => ({}));
      };
      const { tick } = await bootCatchUpAndSchedule(manager, root, projects, actualPort, runHookFn);
      hookTick = tick;
    } catch (err) {
      console.warn('[hooks] boot catch-up/schedule failed:', err instanceof Error ? err.message : err);
    }
  }

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
      try { manager.closeProjectDbs(); } catch { /* best-effort */ }
      if (devWeb) await devWeb.close();
      wss.close();
      await new Promise<void>((res) => httpServer.close(() => res()));
    },
  };
}
