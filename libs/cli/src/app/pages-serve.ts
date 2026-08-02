import { readFile } from 'node:fs/promises';
import { resolve, sep, extname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
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
 * Rationale (see org/app/features.md (safety)): LLM-authored pages render
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
 *
 * `fallback` is what answers when the first path segment is NOT a project with a
 * built app. On the reserved `/app/<project>/` mount there is nothing else it could
 * be, so the default is a 404. On the ROOT mount (`/<project>/…`) that same pattern
 * also matches every non-app path on the pod — `/studio`, `/assets/x.js`, any SPA
 * route — so the integrator passes the SPA handler here and those fall through
 * untouched. Without it, mounting at the root would shadow the whole SPA.
 */
export function createPageServeHandler(
  getOutDirForProject: (
    projectId: string,
  ) => Promise<{ outDir: string; assetManifest: string[] } | null>,
  mountPrefix = '/app',
  fallback?: (req: IncomingMessage, res: ServerResponse) => void,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (req, res, params) => {
    const projectId = params['projectId']!;

    const bundle = await getOutDirForProject(projectId);
    if (!bundle) {
      if (fallback) { fallback(req, res); return; }
      sendText(res, 404, `project "${projectId}" has no page app`);
      return;
    }
    const { outDir, assetManifest } = bundle;
    const rest = normalize(params['rest'] ?? '');

    // The app is mounted at `<mountPrefix>/<project>/` on the pod (this handler's
    // route pattern), so that is the exact, prefix-safe base for the SPA shell's
    // *relative* asset URLs (`./assets/…`). `mountPrefix` is `/app` for the
    // reserved-prefix mount (localhost single-serve, `*.test`) and `''` for the
    // production root mount (lmthing.app/<project>/, where Envoy's catch-all sends
    // the request straight to the pod) — the base MUST equal the visible URL or a
    // deep route (`…/labs/:id`) resolves `./assets/x` against `…/labs/` → 404 →
    // this very fallback → the browser loads index.html as a module and errors on
    // the `text/html` MIME type. The `<base>` fixes every depth in both mounts.
    const appBase = `${mountPrefix}/${projectId}/`;

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
        await serveIndex(res, outDir, appBase, projectId);
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

    // A request for an ASSET that the build never emitted is a 404 — not the SPA shell.
    // Handing back `index.html` (200, `text/html`) for a missing `.js`/`.css`/`.ico` is how a
    // stale bundle turns into "Unexpected token '<'" and how every app page logged a CSP console
    // error for its favicon: the browser asked for an icon and got HTML (scenario 07's browser
    // pass). Only extensions we actually serve count as an asset ask, so a dynamic route param
    // that merely contains a dot (`/items/my.v2.id`) still reaches the client router.
    if (rest !== '' && isAssetRequest(rest)) {
      sendText(res, 404, 'not found');
      return;
    }

    // Asset-manifest SPA fallback: not a known asset → the client router owns it.
    await serveIndex(res, outDir, appBase, projectId);
  };
}

/** A sub-path whose extension is one this server serves — i.e. the browser is asking for a
 *  build artifact, not a client route. `.html` is excluded: it is the SPA shell's own path. */
function isAssetRequest(rest: string): boolean {
  const ext = extname(rest).toLowerCase();
  return ext !== '' && ext !== '.html' && ext in MIME;
}

/**
 * Serve the SPA shell, injecting into `<head>`:
 *  - `<base href="${appBase}">` so the shell's relative asset URLs resolve to
 *    `${appBase}assets/…` at **any** route depth (not just the root), and
 *  - `window.__APP_BASE__` — the client router's basename override
 *    (`@app/runtime` `resolveAppBase`). On the `/app/<project>/` mount the router
 *    can derive its base from the `…/app/<project>` path segment, but on the ROOT
 *    mount (`lmthing.app/<project>/…`, where Envoy strips nothing) there is no
 *    `/app/` segment to match, so without this override the router sees the full
 *    pathname and renders "No page for /<project>/". Injecting it makes both mounts
 *    work (on `/app` it is the same value the path regex would derive).
 *  - `window.__APP_PROJECT_ID__` — the project id, the twin escape hatch. On the
 *    ROOT mount the segment after `/app/` that `projectIdFromLocation` regex-matches
 *    is absent too, so without this override the host renders "No project id in this
 *    URL" and the app never loads at its clean URL. Injected on BOTH mounts (harmless
 *    on `/app`, where it equals the value the path regex would recover).
 * Idempotent — never doubles an existing `<base>`.
 */
async function serveIndex(res: ServerResponse, outDir: string, appBase: string, projectId: string): Promise<void> {
  let html: Buffer;
  try {
    html = await readFile(resolve(outDir, 'index.html'));
  } catch {
    sendText(res, 500, 'page bundle missing index.html');
    return;
  }
  let text = html.toString('utf8');
  // Per-response nonce so the `__APP_BASE__` bootstrap can run under the strict
  // `script-src 'self'` CSP (which otherwise blocks ALL inline script — the whole
  // point, to stop LLM-authored content from injecting executable script). The nonce
  // is random per request and unguessable, so it does not weaken that protection.
  const nonce = randomBytes(16).toString('base64');
  if (!/<base\s/i.test(text)) {
    // `__APP_BASE__` is the base WITHOUT the trailing slash (resolveAppBase strips it):
    // `/app/blog/` → `/app/blog`, `/blog/` → `/blog`.
    const appBaseNoSlash = appBase.replace(/\/+$/, '') || '/';
    text = text.replace(
      /<head>/i,
      `<head>\n    <base href="${appBase}">\n    <script nonce="${nonce}">window.__APP_BASE__ = ${JSON.stringify(appBaseNoSlash)};window.__APP_PROJECT_ID__ = ${JSON.stringify(projectId)};</script>`,
    );
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`),
  });
  res.end(text);
}
