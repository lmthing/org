import { readFile, stat, readdir } from 'node:fs/promises';
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

// The unified app self-authenticates via @lmthing/auth (token in localStorage)
// and computes its own WS URL, so its index.html is served verbatim — no
// bootstrap injection is needed.

// ─── App dist resolution ──────────────────────────────────────────────────────

/**
 * Locate the `apps` directory by walking up from this module.
 *
 * The relative depth from this file to apps/ is NOT stable: in the source tree
 * it is `libs/cli/src/server/static-apps.ts` (→ `../../../apps`), but tsup flattens
 * the build into `libs/cli/dist/serve-*.js` at the package's `dist/` root
 * (→ `../../apps`), and the Docker image keeps yet another layout
 * (`/app/libs/...`). Walking up until we find a dir containing `apps` handles
 * all three.
 */
function findAppsBase(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, 'apps');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      // Fall back to the source-tree-relative guess; the env override still wins.
      return resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps');
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

/**
 * Resolve the prebuilt `@lmthing/app-shell` dist dir — the ONE static Vite build
 * that renders EVERY view-spec app (the project id is a runtime route param, so
 * a single dist serves all of them). Mirrors {@link resolveAppDist}: walks up from
 * this module to find `apps/app-shell/dist`, with `LM_APP_SHELL_DIST` (absolute path)
 * as the override following the `LM_APP_DIST` precedent.
 *
 * Used for a project with view specs unless `LM_APP_SHELL === '0'`; otherwise the
 * legacy per-project esbuild bundle is served and this dist is never touched.
 */
export function resolveAppShellDist(): string {
  const base = findAppsBase();
  return process.env['LM_APP_SHELL_DIST'] ?? resolve(base, 'app-shell/dist');
}

/**
 * Walk a dist directory and return every file as a relative path (forward-slash
 * separated) — the asset-manifest shape {@link createPageServeHandler} expects. Used
 * once at boot for the static app-shell, whose Vite build does not hand us a manifest
 * the way the per-project esbuild build does.
 */
export async function scanDistManifest(distDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const entry of entries) {
      const name = String(entry.name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (entry.isDirectory()) {
        await walk(join(dir, name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(distDir, '');
  return out;
}

// ─── index.html cache ─────────────────────────────────────────────────────────

/** Per-distDir cache of the served index.html (read once, served verbatim). */
const htmlCache = new Map<string, string>();

async function getIndexHtml(distDir: string): Promise<string | null> {
  const cached = htmlCache.get(distDir);
  if (cached !== undefined) return cached;
  try {
    const raw = await readFile(resolve(distDir, 'index.html'), 'utf8');
    htmlCache.set(distDir, raw);
    return raw;
  } catch {
    return null;
  }
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
  // /projects/123/spaces/x) get the app's index.html. no-store so the browser
  // always fetches a fresh copy.
  const html = await getIndexHtml(distDir);
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
