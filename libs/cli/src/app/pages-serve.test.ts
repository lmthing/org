import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPageServeHandler } from './pages-serve.js';

// ── Light fake req/res (no real http socket needed) ───────────────────────────
interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  ended: boolean;
}

function makeRes(): { res: ServerResponse; out: FakeRes } {
  const out: FakeRes = { statusCode: 0, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.statusCode = status;
      if (headers) for (const [k, v] of Object.entries(headers)) out.headers[k.toLowerCase()] = String(v);
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) out.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      out.ended = true;
      return this;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

const fakeReq = {} as IncomingMessage;

// ── Fixture bundle ────────────────────────────────────────────────────────────
let outDir: string;
const assetManifest = ['index.html', 'assets/app-abc123.js'];

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'pages-serve-'));
  await mkdir(join(outDir, 'assets'), { recursive: true });
  await writeFile(
    join(outDir, 'index.html'),
    '<!doctype html>\n<html>\n  <head>\n    <link rel="stylesheet" href="./assets/app.css">\n  </head>\n  <body><div id="root"></div><script type="module" src="./assets/app-abc123.js"></script></body>\n</html>',
  );
  await writeFile(join(outDir, 'assets', 'app-abc123.js'), 'console.log("app")');
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function handlerFor(bundle: { outDir: string; assetManifest: string[] } | null) {
  return createPageServeHandler(async () => bundle);
}

describe('createPageServeHandler', () => {
  it('serves a hashed asset with text/javascript, immutable cache and CSP', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'p1', rest: 'assets/app-abc123.js' });

    expect(out.statusCode).toBe(200);
    expect(out.headers['content-type']).toBe('text/javascript');
    expect(out.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(out.headers['content-security-policy']).toContain("script-src 'self'");
    expect(out.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(out.body.toString()).toBe('console.log("app")');
  });

  it('serves index.html (SPA fallback) for an unknown dotted path, no-cache + CSP', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'p1', rest: 'items/my.dotted.id' });

    expect(out.statusCode).toBe(200);
    expect(out.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(out.headers['cache-control']).toBe('no-cache');
    expect(out.headers['content-security-policy']).toContain("default-src 'self'");
    expect(out.body.toString()).toContain('id="root"');
  });

  it('serves index.html for the bundle root (empty rest)', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'p1', rest: '' });

    expect(out.statusCode).toBe(200);
    expect(out.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(out.body.toString()).toContain('id="root"');
  });

  it('injects <base href="/app/<project>/"> into the SPA fallback so relative assets resolve at any route depth', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    // A depth-≥2 client route (e.g. /app/health/labs/:id): without <base>, the
    // shell's `./assets/…` would resolve against `…/labs/` → 404 → this fallback →
    // the JS loads as text/html and the page is blank. The injected base fixes it.
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'health', rest: 'labs/abc-123' });

    expect(out.statusCode).toBe(200);
    const body = out.body.toString();
    expect(body).toContain('<base href="/app/health/">');
    // Injected exactly once, right inside <head>, and never doubled.
    expect(body.match(/<base\s/gi)?.length).toBe(1);
  });

  it('injects the ROOT-mount base <base href="/<project>/"> when mountPrefix is empty (prod lmthing.app/<project>/)', async () => {
    // Behind Envoy the app is served at the clean root mount, so the base must be
    // `/<project>/` (matching the visible URL), NOT `/app/<project>/`.
    const handler = createPageServeHandler(async () => ({ outDir, assetManifest }), '');
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'health', rest: 'labs/abc-123' });

    expect(out.statusCode).toBe(200);
    const body = out.body.toString();
    expect(body).toContain('<base href="/health/">');
    expect(body).not.toContain('<base href="/app/health/">');
    expect(body.match(/<base\s/gi)?.length).toBe(1);
  });

  it('serves an explicit index.html request with no-cache', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'p1', rest: 'index.html' });

    expect(out.statusCode).toBe(200);
    expect(out.headers['cache-control']).toBe('no-cache');
  });

  it('rejects a `..` path-traversal attempt with 400', async () => {
    const handler = handlerFor({ outDir, assetManifest });
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'p1', rest: '../../etc/passwd' });

    expect(out.statusCode).toBe(400);
    // Never leak file bytes; still carries the CSP header.
    expect(out.headers['content-security-policy']).toBeTruthy();
    expect(out.body.toString()).not.toContain('root:');
  });

  it('404s when the project has no page app', async () => {
    const handler = handlerFor(null);
    const { res, out } = makeRes();
    await handler(fakeReq, res, { projectId: 'nope', rest: '' });

    expect(out.statusCode).toBe(404);
    expect(out.body.toString()).toContain('nope');
  });
});
