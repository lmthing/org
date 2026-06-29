import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ─── MIME table (no external dep) ────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.js':    'text/javascript',
  '.mjs':   'text/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.ttf':   'font/ttf',
  '.ico':   'image/x-icon',
  '.map':   'application/json',
  '.html':  'text/html; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// ─── Bootstrap IIFE (verbatim from serve.ts buildHtml, projectMode = true) ───
//
// Lifted from buildHtml() in serve.ts. Injected before the first
// <script type="module" in the prebuilt index.html so studio/computer/chat
// all receive the same globals: __LM_ACCESS_TOKEN__, __WS_URL__, __LM_PROJECT_MODE__.

const BOOTSTRAP_IIFE = `(function(){
    var p = new URLSearchParams(location.search);
    var sid = p.get('sessionId') || '';
    var tok = p.get('access_token') || '';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    window.__LM_PROJECT_MODE__ = true;
    // Gateway JWT (behind Envoy): stash for the agent-ui fetch/WS layer, then
    // strip it from the address bar so it isn't bookmarked/leaked (mirrors how
    // @lmthing/auth clears ?code=).
    window.__LM_ACCESS_TOKEN__ = tok;
    if (tok) {
      p.delete('access_token');
      var qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
    function wsUrl(extra) {
      var qp = [];
      if (extra) qp.push(extra);
      if (tok) qp.push('access_token=' + encodeURIComponent(tok));
      return proto + '//' + location.host + '/api/ws' + (qp.length ? '?' + qp.join('&') : '');
    }
    if (sid) window.__WS_URL__ = wsUrl('sessionId=' + encodeURIComponent(sid));
    else if (!true) window.__WS_URL__ = wsUrl('');
  })();`;

const BOOTSTRAP_TAG = `<script>${BOOTSTRAP_IIFE}</script>`;
const INJECT_BEFORE = '<script type="module"';

// ─── App dist resolution ──────────────────────────────────────────────────────

/**
 * Locate the `packages/ui/apps` directory by walking up from this module.
 *
 * The relative depth from this file to ui/apps is NOT stable: in the source tree
 * it is `src/server/static-apps.ts` (→ `../../../ui/apps`), but tsup flattens the
 * build into `dist/serve-*.js` at the package's `dist/` root (→ `../../ui/apps`),
 * and the Docker image keeps yet another layout (`/app/packages/...`). Walking up
 * until we find a dir containing `packages/ui/apps` handles all three.
 */
function findAppsBase(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, 'packages', 'ui', 'apps');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      // Fall back to the source-tree-relative guess; the env override still wins.
      return resolve(dirname(fileURLToPath(import.meta.url)), '../../../ui/apps');
    }
    dir = parent;
  }
}

/**
 * Resolve the single unified web app's dist dir (the one served SPA — the
 * studio/computer/chat surfaces are client-side routes under /studio, /computer,
 * /chat inside it). `LM_APP_DIST` (absolute path) overrides the default
 * `<appsBase>/web/dist`.
 */
export function resolveAppDist(): string {
  const base = findAppsBase();
  return process.env['LM_APP_DIST'] ?? resolve(base, 'web/dist');
}

// ─── Bootstrap injection cache ────────────────────────────────────────────────

/** Per-distDir cache of the index.html with the bootstrap <script> spliced in. */
const htmlCache = new Map<string, string>();

async function getInjectedHtml(distDir: string): Promise<string | null> {
  const cached = htmlCache.get(distDir);
  if (cached !== undefined) return cached;

  const indexPath = resolve(distDir, 'index.html');
  let raw: string;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch {
    return null;
  }

  // Splice the bootstrap tag immediately before the first <script type="module"
  // so that window.__LM_ACCESS_TOKEN__ / __WS_URL__ / __LM_PROJECT_MODE__ are
  // set before the app bundle initialises. Single indexOf + string concat.
  const idx = raw.indexOf(INJECT_BEFORE);
  const injected = idx === -1
    ? raw + '\n' + BOOTSTRAP_TAG
    : raw.slice(0, idx) + BOOTSTRAP_TAG + '\n' + raw.slice(idx);

  htmlCache.set(distDir, injected);
  return injected;
}

// ─── Static file serving ──────────────────────────────────────────────────────

async function serveStaticApp(req: IncomingMessage, res: ServerResponse, distDir: string): Promise<void> {
  const reqUrl = req.url ?? '/';
  const urlPath = new URL(reqUrl, 'http://localhost').pathname;

  // /assets/* — hashed filenames, serve with long-lived immutable cache.
  if (urlPath.startsWith('/assets/')) {
    const rel = urlPath.slice('/assets/'.length);
    const assetsDir = resolve(distDir, 'assets');
    const abs = resolve(assetsDir, rel);
    // Path-traversal guard: abs must be inside assetsDir.
    if (abs !== assetsDir && !abs.startsWith(assetsDir + sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(abs);
    } catch (e) {
      const status = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 404 ? 'not found' : 'server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(abs),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(data);
    return;
  }

  // Other real files (favicon.ico, manifest.webmanifest, robots.txt, etc.) —
  // serve with no-cache if a matching file exists on disk.
  if (urlPath !== '/') {
    const rel = urlPath.slice(1); // strip leading /
    const abs = resolve(distDir, rel);
    // Path-traversal guard.
    if (abs !== distDir && !abs.startsWith(distDir + sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }
    try {
      const s = await stat(abs);
      if (s.isFile()) {
        const data = await readFile(abs);
        res.writeHead(200, {
          'Content-Type': mimeFor(abs),
          'Cache-Control': 'no-cache',
        });
        res.end(data);
        return;
      }
    } catch {
      // ENOENT or other — fall through to SPA fallback.
    }
  }

  // SPA fallback: / and all unmatched paths (deep client routes like
  // /projects/123/spaces/x) get the app's index.html with the bootstrap script
  // injected. no-store so the browser always fetches a fresh copy.
  const html = await getInjectedHtml(distDir);
  if (html === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`[lmthing] app not built yet — dist not found at: ${distDir}\nRun the Vite build for this app, or set LM_APP_DIST_* env vars to point at an existing dist.`);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
  });
  res.end(html);
}

// ─── Public factory ───────────────────────────────────────────────────────────

export interface StaticApps {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/**
 * Create a StaticApps instance for the single unified web app dist.
 * `handle` serves the SPA (assets + SPA fallback with bootstrap injection) for
 * every non-/api request — studio/computer/chat are client-side routes in it.
 */
export function createStaticApps(distDir: string): StaticApps {
  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      await serveStaticApp(req, res, distDir);
    },
  };
}
