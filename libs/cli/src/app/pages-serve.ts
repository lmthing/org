import { readFile } from 'node:fs/promises';
import { resolve, sep, extname, basename } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serve a project's built page bundle at `/app/<project>/*` (Phase 5B).
 *
 * The integrator registers this handler AFTER the app-api route (Phase 3), so
 * `…/app/<project>/api/*` is already consumed and never reaches here — every
 * request we see is a page/asset request for the SPA.
 *
 * ── Serving model ────────────────────────────────────────────────────────────
 * The build (Phase 5A `buildProjectPages`) hands us an `outDir` (…/.data/pages-dist)
 * plus an `assetManifest: string[]` — the exact set of real files it emitted. We
 * serve on a manifest-match basis:
 *   • sub-path IS in the manifest → serve that static file from `outDir`
 *   • sub-path is NOT in the manifest → serve `outDir/index.html` (SPA fallback)
 * Matching against the manifest (rather than probing the filesystem) is what makes
 * a dynamic route param that contains a `.` — e.g. `/items/my.v2.id` — route to the
 * client SPA instead of being mistaken for a missing asset and 404-ing.
 *
 * ── Content Security Policy ──────────────────────────────────────────────────
 * Every served response (assets AND the SPA fallback) carries a strict CSP:
 *
 *   default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
 *   connect-src 'self'; img-src 'self' data: https:; base-uri 'self';
 *   frame-ancestors 'self'
 *
 * Rationale (see project-as-application.md §Safety): LLM-authored pages render
 * fetched third-party content, an XSS surface. We therefore:
 *   • `script-src 'self'` and NO `'unsafe-inline'` for scripts — a poisoned news
 *     item can carry markup but cannot execute inline/injected script.
 *   • `connect-src 'self'` — even a self-XSS cannot exfiltrate to a third party or
 *     reach the top-level admin `/api/*`; the page can only talk to its own
 *     same-origin `/app/<project>/api/*`.
 *   • `style-src` allows `'unsafe-inline'` because bundlers/JSX emit inline styles
 *     (style attributes / CSS-in-JS) that are not a script-execution vector.
 *   • `img-src` allows `data:` (inlined assets) and `https:` (rendered remote
 *     images) — images are not an execution vector.
 *   • `base-uri 'self'` blocks `<base>` hijacking; `frame-ancestors 'self'` lets the
 *     Studio same-origin preview iframe embed it while blocking cross-origin framing.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data: https:; base-uri 'self'; frame-ancestors 'self'";

// ── MIME table (no external dep; mirrors server/static-apps.ts) ───────────────
const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Strip a leading `./` or `/` so manifest entries and request sub-paths compare uniformly. */
function normalize(p: string): string {
  return p.replace(/^\.?\//, '');
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': CSP });
  res.end(body);
}

/**
 * Route handler for `/app/:projectId/*` (the non-api page paths).
 *
 * `getOutDirForProject` is wired by the integrator to build-on-demand / cache; it
 * resolves the project's built bundle (`outDir` + `assetManifest`) or `null` when
 * the project has no page app.
 */
export function createPageServeHandler(
  getOutDirForProject: (
    projectId: string,
  ) => Promise<{ outDir: string; assetManifest: string[] } | null>,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;

    const bundle = await getOutDirForProject(projectId);
    if (!bundle) {
      sendText(res, 404, `project "${projectId}" has no page app`);
      return;
    }
    const { outDir, assetManifest } = bundle;
    const rest = normalize(params['rest'] ?? '');

    // Path-traversal guard: the requested sub-path must resolve INSIDE outDir. A
    // `..` escape (e.g. `../../etc/passwd`) is rejected outright, independent of the
    // manifest — we never serve a byte from outside the bundle.
    const abs = resolve(outDir, rest);
    if (abs !== outDir && !abs.startsWith(outDir + sep)) {
      sendText(res, 400, 'bad request');
      return;
    }

    // Manifest match → serve the real static asset. Anything else → SPA fallback.
    const manifest = new Set(assetManifest.map(normalize));
    if (rest !== '' && manifest.has(rest)) {
      let data: Buffer;
      try {
        data = await readFile(abs);
      } catch {
        // In-manifest but missing on disk (stale build) — degrade to SPA fallback.
        await serveIndex(res, outDir);
        return;
      }
      // Hashed assets are content-addressed → immutable & far-future cacheable.
      // index.html is the one mutable entrypoint → must always be revalidated.
      const isIndex = basename(abs) === 'index.html';
      res.writeHead(200, {
        'Content-Type': mimeFor(abs),
        'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Content-Security-Policy': CSP,
      });
      res.end(data);
      return;
    }

    // Asset-manifest SPA fallback: not a known asset → the client router owns it.
    await serveIndex(res, outDir);
  };
}

async function serveIndex(res: ServerResponse, outDir: string): Promise<void> {
  let html: Buffer;
  try {
    html = await readFile(resolve(outDir, 'index.html'));
  } catch {
    sendText(res, 500, 'page bundle missing index.html');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP,
  });
  res.end(html);
}
