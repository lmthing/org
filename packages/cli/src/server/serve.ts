import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { TraceHub } from '../rpc/trace-hub.js';
import { handleAgentApi, agentApiContextFromEntry } from '../web/agent-api.js';
import type { ServerEvent, ClientMessage, UiControlAction } from '../rpc/events.js';
import type { SessionManager, SessionEntry } from './session-manager.js';
import { isSafeRelPath, safeProjectId } from './projects.js';
import { createStaticApps, resolveAppDist } from './static-apps.js';

/**
 * Parse KEY=VALUE lines from a .env-style string and apply them to process.env.
 * Used both at server startup (so a persisted /data/.env survives pod restarts)
 * and by the PUT /api/env handler (so edits apply without a restart).
 */
function applyEnvContent(content: string): void {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) process.env[key] = value;
  }
}

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

// ─── Space sync (POST /api/spaces) ────────────────────────────────────────────

/** A space name must be a single safe path segment (no separators, no traversal). */
function safeSpaceName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name === '.' || name === '..') return null;
  return name;
}


// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** SESSION_RE matches /api/sessions/<id>[/<rest>] capturing id + rest. */
const SESSION_RE = /^\/api\/sessions\/([^/]+)(\/.*)?$/;

/**
 * Multi-session HTTP + WS server. One server hosts many independent agent
 * sessions; each has its OWN renderHost + hub (in the SessionManager), so events
 * never cross sessions. The served app reads sessionId from the query string.
 */
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
  // user-provided credentials (e.g. AZURE_API_KEY) survive pod restarts. The
  // file lives at <cwd>/.env (i.e. /data/.env on the pod). Existing process.env
  // values take precedence is NOT desired here — the custom file is the user's
  // explicit override, so it wins (mirrors PUT semantics).
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
  // The manager's lmthingRoot takes precedence; opts.lmthingRoot is accepted for
  // symmetry (both should match in practice — the manager is already constructed
  // with it by the CLI).
  const effectiveLmthingRoot = manager.lmthingRoot ?? opts.lmthingRoot;

  // Where POST /api/spaces writes synced spaces. In project mode they land under
  // the default 'user' project's spaces/ tree (the single source of truth, same
  // place generated spaces live), so studio reads/writes the real project spaces.
  // Otherwise fall back to the legacy flat dir ($SPACES_DIR or /data/spaces).
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

  const broadcastUiControl = (entry: SessionEntry): ((action: UiControlAction) => void) =>
    (action) => entry.renderHost.emit({ type: 'ui_control', action });

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      try { sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }); } catch { /* already sent */ }
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reqUrl = req.url ?? '/';
    const url = new URL(reqUrl, 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // ─── Prices ───
    if (path === '/api/prices/azure' && method === 'GET') {
      try {
        const { fileURLToPath } = await import('node:url');
        const pricesPath = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
        const raw = readFileSync(pricesPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
      } catch {
        sendJson(res, 404, { error: 'prices not available' });
      }
      return;
    }

    // ─── Restart: reply 200 then exit so the supervisor restarts the process ─
    if (path === '/api/restart' && method === 'POST') {
      sendJson(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100);
      return;
    }

    // ─── Custom env (GET /api/env, PUT /api/env) ─────────────────────────────
    const envFilePath = resolve(process.cwd(), '.env');
    if (path === '/api/env' && method === 'GET') {
      let content = '';
      try { content = readFileSync(envFilePath, 'utf8'); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      sendJson(res, 200, { content });
      return;
    }
    if (path === '/api/env' && method === 'PUT') {
      let parsed: { content?: unknown };
      try {
        parsed = JSON.parse((await readBody(req)) || '{}') as { content?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }); return;
      }
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      writeFileSync(envFilePath, content, 'utf8');
      // Apply to process.env immediately so edits take effect without a restart.
      applyEnvContent(content);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ─── Session lifecycle (collection-level) ───
    if (path === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}') as {
        spaceDir?: string; agentSlug?: string; model?: string; projectId?: string;
        resumeSessionId?: string;
        budget?: { maxEpisodes?: number; maxToolCalls?: number; maxForkDepth?: number; maxWallClockMs?: number };
      };
      try {
        const { sessionId } = manager.createSession({
          spaceDir: parsed.spaceDir,
          agentSlug: parsed.agentSlug,
          model: parsed.model,
          budget: parsed.budget,
          projectId: parsed.projectId,
          resumeSessionId: parsed.resumeSessionId,
        });
        sendJson(res, 201, { sessionId });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (path === '/api/sessions' && method === 'GET') {
      sendJson(res, 200, { sessions: manager.listSessions() });
      return;
    }

    // ─── Project routes (only when lmthingRoot is configured) ───────────────
    if (path === '/api/projects' && method === 'GET') {
      try {
        const projects = await manager.listProjects();
        sendJson(res, 200, { projects });
      } catch (err) {
        sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (path === '/api/projects' && method === 'POST') {
      let parsed: { name?: unknown };
      try {
        parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' }); return;
      }
      if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
        sendJson(res, 400, { error: 'name must be a non-empty string' }); return;
      }
      try {
        const meta = await manager.createProject(parsed.name.trim());
        sendJson(res, 201, { id: meta.id });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // /api/projects/:id  and  /api/projects/:id/...
    const projectMatch = /^\/api\/projects\/([^/]+)(\/.*)?$/.exec(path);
    if (projectMatch) {
      const rawId = decodeURIComponent(projectMatch[1]!);
      const subPath = projectMatch[2] ?? ''; // '' | '/instructions' | '/documents'

      // DELETE /api/projects/:id
      if (subPath === '' && method === 'DELETE') {
        if (rawId === 'user') {
          sendJson(res, 400, { error: 'cannot delete the default project' }); return;
        }
        try {
          await manager.deleteProject(rawId);
          res.writeHead(204); res.end();
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /api/projects/:id/instructions
      if (subPath === '/instructions' && method === 'GET') {
        try {
          const content = await manager.getInstructions(rawId);
          sendJson(res, 200, { content });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // PUT /api/projects/:id/instructions
      if (subPath === '/instructions' && method === 'PUT') {
        let parsed: { content?: unknown };
        try {
          parsed = JSON.parse((await readBody(req)) || '{}') as { content?: unknown };
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' }); return;
        }
        const content = typeof parsed.content === 'string' ? parsed.content : '';
        try {
          await manager.setInstructions(rawId, content);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /api/projects/:id/documents
      if (subPath === '/documents' && method === 'GET') {
        try {
          const documents = await manager.listDocuments(rawId);
          sendJson(res, 200, { documents });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // POST /api/projects/:id/documents
      if (subPath === '/documents' && method === 'POST') {
        let parsed: { name?: unknown; content?: unknown };
        try {
          parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown; content?: unknown };
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' }); return;
        }
        if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
          sendJson(res, 400, { error: 'name must be a non-empty string' }); return;
        }
        const content = typeof parsed.content === 'string' ? parsed.content : '';
        try {
          await manager.addDocument(rawId, parsed.name.trim(), content);
          sendJson(res, 201, { ok: true });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /api/projects/:id/sessions
      if (subPath === '/sessions' && method === 'GET') {
        try {
          const sessions = await manager.listProjectSessions(rawId);
          sendJson(res, 200, { sessions });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /api/projects/:id/spaces/:spaceId/files — read a space's files
      // PUT /api/projects/:id/spaces/:spaceId/files — wipe-and-rewrite them
      const spaceFilesMatch = /^\/spaces\/([^/]+)\/files$/.exec(subPath);
      if (spaceFilesMatch) {
        const spaceId = decodeURIComponent(spaceFilesMatch[1]!);
        if (!safeProjectId(spaceId)) {
          sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
        }
        if (method === 'GET') {
          try {
            const files = await manager.readProjectSpaceFiles(rawId, spaceId);
            sendJson(res, 200, { files });
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (method === 'PUT') {
          let parsed: { files?: unknown };
          try {
            parsed = JSON.parse((await readBody(req)) || '{}') as { files?: unknown };
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' }); return;
          }
          const files = (parsed.files ?? {}) as Record<string, unknown>;
          if (typeof files !== 'object' || files === null || Array.isArray(files)) {
            sendJson(res, 400, { error: 'files must be an object' }); return;
          }
          for (const rel of Object.keys(files)) {
            if (!isSafeRelPath(rel)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
          }
          const normalized: Record<string, string> = {};
          for (const [rel, content] of Object.entries(files)) {
            normalized[rel] = typeof content === 'string' ? content : String(content ?? '');
          }
          try {
            await manager.writeProjectSpaceFiles(rawId, spaceId, normalized);
            sendJson(res, 200, { ok: true });
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        // POST /api/projects/:id/spaces/:spaceId/files — create a single file.
        // Body: { path: string, content: string }. 201 on success.
        if (method === 'POST') {
          let parsed: { path?: unknown; content?: unknown };
          try {
            parsed = JSON.parse((await readBody(req)) || '{}') as { path?: unknown; content?: unknown };
          } catch {
            sendJson(res, 400, { error: 'invalid JSON body' }); return;
          }
          if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
            sendJson(res, 400, { error: 'path must be a non-empty string' }); return;
          }
          const content = typeof parsed.content === 'string' ? parsed.content : String(parsed.content ?? '');
          try {
            await manager.writeProjectSpaceFile(rawId, spaceId, parsed.path, content);
            sendJson(res, 201, { ok: true });
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
      }

      // PUT    /api/projects/:id/spaces/:spaceId/files/<relPath> — update a single file.
      //        Body: { content: string } (or a raw string body).
      // DELETE /api/projects/:id/spaces/:spaceId/files/<relPath> — delete a single file.
      const spaceFileMatch = /^\/spaces\/([^/]+)\/files\/(.+)$/.exec(subPath);
      if (spaceFileMatch && (method === 'PUT' || method === 'DELETE')) {
        const spaceId = decodeURIComponent(spaceFileMatch[1]!);
        if (!safeProjectId(spaceId)) {
          sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
        }
        const relPath = spaceFileMatch[2]!.split('/').map(decodeURIComponent).join('/');

        if (method === 'PUT') {
          const raw = await readBody(req);
          let content: string;
          try {
            const parsed = JSON.parse(raw || '{}') as { content?: unknown };
            content = typeof parsed.content === 'string' ? parsed.content : raw;
          } catch {
            // Not JSON — treat the body itself as the raw file content.
            content = raw;
          }
          try {
            await manager.writeProjectSpaceFile(rawId, spaceId, relPath, content);
            sendJson(res, 200, { ok: true });
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (method === 'DELETE') {
          try {
            await manager.deleteProjectSpaceFile(rawId, spaceId, relPath);
            res.writeHead(204); res.end();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as { code?: string } | undefined)?.code;
            if (code === 'ENOENT') {
              sendJson(res, 404, { error: `file not found: ${relPath}` });
            } else {
              sendJson(res, 400, { error: message });
            }
          }
          return;
        }
      }

      // GET /api/projects/:id/spaces — spaces created under this project
      if (subPath === '/spaces' && method === 'GET') {
        try {
          const spaces = await manager.listProjectSpaces(rawId);
          sendJson(res, 200, { spaces });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // GET /api/projects/:id/completions — autocomplete words (spaces, agents, actions)
      if (subPath === '/completions' && method === 'GET') {
        try {
          const completions = await manager.getAutocompleteWords(rawId);
          sendJson(res, 200, { completions });
        } catch (err) {
          sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    }

    // ─── Space sync: write an edited space to disk so a session can load it ───
    // Body: { name: string, files: Record<relativePath, content> }. The target
    // dir is wiped first so deletions in the editor are reflected. Returns the
    // absolute spaceDir to pass as POST /api/sessions { spaceDir }.
    if (path === '/api/spaces' && method === 'POST') {
      let parsed: { name?: unknown; files?: unknown };
      try {
        parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown; files?: unknown };
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const name = safeSpaceName(parsed.name);
      if (!name) { sendJson(res, 400, { error: 'invalid or missing space name' }); return; }
      const files = (parsed.files ?? {}) as Record<string, unknown>;
      if (typeof files !== 'object' || files === null) { sendJson(res, 400, { error: 'files must be an object' }); return; }
      for (const rel of Object.keys(files)) {
        if (!isSafeRelPath(rel)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
      }

      const target = resolve(spacesRoot, name);
      if (target !== join(spacesRoot, name)) { sendJson(res, 400, { error: 'invalid space name' }); return; }

      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      for (const [rel, content] of Object.entries(files)) {
        const dest = resolve(target, rel);
        if (dest !== target && !dest.startsWith(target + sep)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
      }
      sendJson(res, 201, { spaceDir: target });
      return;
    }

    // ─── Per-session routes: /api/sessions/:id[/rest] ───
    const m = SESSION_RE.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const rest = m[2] ?? ''; // '' | '/state' | '/node/x' | '/events' | '/asks' | '/message' | '/ask/y'
      const entry = manager.getSession(id);

      if (rest === '' && method === 'DELETE') {
        if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }
        await manager.disposeSession(id);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }

      // Map the per-session sub-path onto the canonical /api/<rest> route so the
      // existing agent-api handlers are reused unchanged.
      const pathOverride = `/api${rest}`;
      const ctx = agentApiContextFromEntry(entry, {
        sendMessage: (content) => manager.sendMessage(id, content),
        broadcastUiControl: broadcastUiControl(entry),
      });
      const handled = await handleAgentApi(req, res, ctx, { pathOverride });
      if (!handled) sendJson(res, 404, { error: `unknown API route ${method} ${path}` });
      return;
    }

    // ─── Raw filesystem API (/api/fs/*) ──────────────────────────────────────
    const fsRoot = resolve(effectiveLmthingRoot ?? process.cwd());

    if (path === '/api/fs/tree' && method === 'GET') {
      const files: string[] = [];
      const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.cache']);

      async function walkFs(dir: string, rel: string): Promise<void> {
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const name = entry.name;
          if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(name)) continue;
            await walkFs(join(dir, name), rel ? `${rel}/${name}` : name);
          } else if (entry.isFile()) {
            files.push(rel ? `${rel}/${name}` : name);
          }
        }
      }

      await walkFs(fsRoot, '');
      sendJson(res, 200, { files });
      return;
    }

    if (path === '/api/fs/read' && method === 'GET') {
      const filePath = url.searchParams.get('path') ?? '';
      if (!isSafeRelPath(filePath)) { sendJson(res, 400, { error: 'invalid path' }); return; }
      const abs = resolve(fsRoot, filePath);
      if (abs !== fsRoot && !abs.startsWith(fsRoot + sep)) { sendJson(res, 400, { error: 'path traversal' }); return; }
      let content = '';
      try { content = await readFile(abs, 'utf8'); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') { sendJson(res, 404, { error: 'file not found' }); return; }
        sendJson(res, 400, { error: 'cannot read file (binary or unreadable)' }); return;
      }
      sendJson(res, 200, { content });
      return;
    }

    if (path === '/api/fs/write' && method === 'PUT') {
      let parsed: { path?: unknown; content?: unknown };
      try { parsed = JSON.parse((await readBody(req)) || '{}') as { path?: unknown; content?: unknown }; }
      catch { sendJson(res, 400, { error: 'invalid JSON body' }); return; }
      const filePath = typeof parsed.path === 'string' ? parsed.path : '';
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      if (!isSafeRelPath(filePath)) { sendJson(res, 400, { error: 'invalid path' }); return; }
      const abs = resolve(fsRoot, filePath);
      if (abs !== fsRoot && !abs.startsWith(fsRoot + sep)) { sendJson(res, 400, { error: 'path traversal' }); return; }
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }); return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // ─── Unknown /api/* ───
    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: `unknown API route ${method} ${path}` });
      return;
    }

    // ─── Static app ───
    await staticApps.handle(req, res);
    return;
  }

  // ─── WebSocket: /api/ws?sessionId=<id> (agent) or /api/ws (control/terminal) ───
  // The PTY cwd for terminal sessions: the runtime root (so the shell lands in
  // the same tree the agent runs in), falling back to the process cwd.
  const terminalCwd = effectiveLmthingRoot ?? process.cwd();
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const termMatch = url.pathname.match(/^\/api\/terminals\/([^/]+)$/);
    if (termMatch) {
      const command = url.searchParams.get('command') ?? undefined;
      wss.handleUpgrade(req, socket, head, (ws) => {
        registerTerminalSocket(ws, command);
      });
      return;
    }
    if (url.pathname !== '/api/ws') { socket.destroy(); return; }
    const id = url.searchParams.get('sessionId') ?? '';
    // No sessionId → control socket (terminal multiplexing), not bound to an
    // agent SessionEntry. computer/ connects this way for its terminal.
    if (!id) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        registerControlSocket(ws);
      });
      return;
    }
    const entry = manager.getSession(id);
    if (!entry) {
      // Unknown session — refuse the upgrade with 404.
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      registerSocket(ws, entry);
    });
  });

  /**
   * A control socket multiplexes PTY terminals (no agent session). Each socket
   * owns its own TerminalManager so terminals die with the connection. node-pty
   * is loaded lazily inside terminal.ts — if unavailable (e.g. under Bun), the
   * open attempt surfaces an `error` event and the socket stays usable.
   */
  function registerControlSocket(ws: WebSocket): void {
    let terminals: import('./terminal.js').TerminalManager | null = null;
    const send = (e: ServerEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };
    const fail = (message: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message } satisfies ServerEvent)); };

    // Envoy Gateway already validated the JWT before forwarding the connection;
    // confirm to the client so PodRuntime transitions to 'running'.
    send({ type: 'auth.ok' });

    const ensureTerminals = async (): Promise<import('./terminal.js').TerminalManager> => {
      if (terminals) return terminals;
      const { TerminalManager } = await import('./terminal.js');
      terminals = new TerminalManager();
      return terminals;
    };

    ws.on('message', (data: Buffer) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; } catch { return; }
      switch (msg.type) {
        case 'terminal.open': {
          const termId = msg.sessionId;
          const command = (msg as { command?: string }).command;
          void ensureTerminals()
            .then((mgr) => mgr.open(termId, terminalCwd, (out) => send({ type: 'terminal.data', sessionId: termId, data: out }), command))
            .then(() => send({ type: 'terminal.opened', sessionId: termId }))
            .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
          break;
        }
        case 'terminal.input':
          terminals?.input(msg.sessionId, msg.data);
          break;
        case 'terminal.resize':
          terminals?.resize(msg.sessionId, msg.cols, msg.rows);
          break;
        case 'terminal.close':
          terminals?.close(msg.sessionId);
          break;
      }
    });

    ws.on('close', () => { terminals?.closeAll(); });
  }

  function registerTerminalSocket(ws: WebSocket, command?: string): void {
    void (async () => {
      let mgr: import('./terminal.js').TerminalManager | null = null;
      try {
        const { TerminalManager } = await import('./terminal.js');
        mgr = new TerminalManager();
        await mgr.open('sole', terminalCwd, (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }, command);
      } catch (err) {
        ws.close(1011, err instanceof Error ? err.message : String(err));
        return;
      }
      ws.on('message', (data: Buffer) => {
        if (!mgr) return;
        const str = data.toString();
        try {
          const msg = JSON.parse(str) as { type: string; data?: string; cols?: number; rows?: number };
          if (msg.type === 'input' && msg.data != null) mgr.input('sole', msg.data);
          else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') mgr.resize('sole', msg.cols, msg.rows);
        } catch { /* ignore parse errors */ }
      });
      ws.on('close', () => { mgr?.closeAll(); mgr = null; });
    })();
  }

  function registerSocket(ws: WebSocket, entry: SessionEntry): void {
    entry.renderHost.addClient(ws);

    // Attach this entry's hub to the socket; detach on close.
    const sink = {
      send: (msg: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); },
      get bufferedAmount() { return ws.bufferedAmount; },
      isOpen: () => ws.readyState === WebSocket.OPEN,
    };
    entry.hub.attach(sink);
    ws.on('close', () => entry.hub.detach(sink));

    const send = (e: ServerEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };
    send({
      type: 'hello',
      protocolVersion: 1,
      sessionId: entry.sessionId,
      spaceName: entry.spaceDir,
      agentSlug: entry.agentSlug,
      traceAvailable: false,
    });
    const snap = entry.hub.snapshot();
    send({ type: 'trace_snapshot', events: snap.events, lastSeq: snap.lastSeq, truncatedBefore: snap.truncatedBefore });
    const asks = entry.renderHost.pendingAsks();
    if (asks.length > 0) send({ type: 'ask_pending', asks });

    ws.on('message', (data: Buffer) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; } catch { return; }
      try {
        switch (msg.type) {
          case 'sendMessage':
            manager.sendMessage(entry.sessionId, msg.content ?? '');
            break;
          case 'submitForm':
            entry.renderHost.submitForm(msg.id, msg.value);
            break;
          case 'cancelAsk':
            entry.renderHost.cancelAsk(msg.id);
            break;
          case 'subscribeTrace': {
            const since = entry.hub.snapshotSince(msg.sinceSeq ?? 0);
            send({ type: 'trace_snapshot', events: since.events, lastSeq: since.lastSeq, truncatedBefore: since.truncatedBefore });
            break;
          }
        }
      } catch (err) {
        // A synchronous throw (e.g. sendMessage before the session finished
        // initializing) would otherwise be swallowed by the ws listener and the
        // client would just hang. Surface it as an error event instead.
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  await new Promise<void>((res) => httpServer.listen(port, res));
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const httpBase = `http://localhost:${actualPort}`;
  console.log(`Multi-session server ready: ${httpBase}`);
  console.log(`Create a session:  POST ${httpBase}/api/sessions`);

  return {
    port: actualPort,
    close: async () => {
      wss.close();
      await new Promise<void>((res) => httpServer.close(() => res()));
    },
  };
}
