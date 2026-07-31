import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cacheRoot,
  cachedLightpanda,
  installDisabled,
  installLightpanda,
  lightpandaAssetName,
  lightpandaCachePath,
  lightpandaDownloadUrl,
} from './lightpanda-install.js';

/** A `fetch` that streams `body` back, optionally lying about content-length. */
function fakeFetch(body: Buffer, opts: { status?: number; contentLength?: number | null } = {}) {
  return vi.fn(async () => {
    const status = opts.status ?? 200;
    const headers = new Headers();
    const len = opts.contentLength === null ? undefined : (opts.contentLength ?? body.length);
    if (len !== undefined) headers.set('content-length', String(len));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(body));
          c.close();
        },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lp-install-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('lightpandaAssetName', () => {
  it('names the upstream asset for each supported platform', () => {
    expect(lightpandaAssetName('linux', 'x64')).toBe('lightpanda-x86_64-linux');
    expect(lightpandaAssetName('darwin', 'arm64')).toBe('lightpanda-aarch64-macos');
  });

  // The whole point of the undefined: upstream ships nothing for Windows, and a
  // caller must learn that here rather than from a 404 on a URL it invented.
  it('is undefined where upstream publishes nothing', () => {
    expect(lightpandaAssetName('win32', 'x64')).toBeUndefined();
    expect(lightpandaAssetName('linux', 'ia32')).toBeUndefined();
  });
});

describe('cacheRoot', () => {
  it('prefers the root the bundle launcher published', () => {
    expect(cacheRoot({ LMTHING_CACHE_ROOT: '/c/lm', XDG_CACHE_HOME: '/ignored' })).toBe('/c/lm');
  });

  it('falls back to XDG_CACHE_HOME off-darwin', () => {
    if (process.platform === 'darwin') return;
    expect(cacheRoot({ XDG_CACHE_HOME: '/x' })).toBe(join('/x', 'lmthing'));
  });
});

describe('installDisabled', () => {
  it('is off by default', () => {
    expect(installDisabled(undefined)).toBe(false);
  });
  it.each(['0', 'false', 'no', 'off', ''])('treats %s as opt-out', (v) => {
    expect(installDisabled(v)).toBe(true);
  });
});

describe('installLightpanda', () => {
  it('downloads, marks executable, and records the sha256 beside it', async () => {
    const payload = Buffer.from('#!/fake/lightpanda binary');
    const res = await installLightpanda({
      env: { LMTHING_CACHE_ROOT: dir, LMTHING_LIGHTPANDA_URL: 'https://example.test/lp' },
      fetchImpl: fakeFetch(payload),
    });

    expect(res.ok).toBe(true);
    const dest = lightpandaCachePath({ LMTHING_CACHE_ROOT: dir });
    expect(res.path).toBe(dest);
    expect(readFileSync(dest)).toEqual(payload);
    // Without the executable bit the browser cannot be spawned at all, and the
    // failure arrives as EACCES from a subprocess rather than from here.
    expect(statSync(dest).mode & 0o111).toBeTruthy();
    expect(readFileSync(`${dest}.sha256`, 'utf8')).toContain(res.sha256!);
  });

  it('reuses a cached binary instead of downloading again', async () => {
    const dest = lightpandaCachePath({ LMTHING_CACHE_ROOT: dir });
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, 'already here');

    const fetchImpl = fakeFetch(Buffer.from('x'));
    const res = await installLightpanda({ env: { LMTHING_CACHE_ROOT: dir }, fetchImpl });

    expect(res).toMatchObject({ ok: true, cached: true, path: dest });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // A truncated download leaves a file that exists and is executable, and dies at
  // exec with a message about a bad ELF header — nowhere near the real cause.
  it('rejects a truncated download and leaves nothing behind', async () => {
    const res = await installLightpanda({
      env: { LMTHING_CACHE_ROOT: dir, LMTHING_LIGHTPANDA_URL: 'https://example.test/lp' },
      fetchImpl: fakeFetch(Buffer.from('short'), { contentLength: 999_999 }),
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/truncated/);
    expect(cachedLightpanda({ LMTHING_CACHE_ROOT: dir })).toBeUndefined();
  });

  it('reports an HTTP failure rather than throwing', async () => {
    const res = await installLightpanda({
      env: { LMTHING_CACHE_ROOT: dir, LMTHING_LIGHTPANDA_URL: 'https://example.test/lp' },
      fetchImpl: fakeFetch(Buffer.alloc(0), { status: 404 }),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/HTTP 404/);
  });

  it('says so when the platform has no upstream build', async () => {
    const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const res = await installLightpanda({ env: { LMTHING_CACHE_ROOT: dir }, fetchImpl: fakeFetch(Buffer.alloc(0)) });
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/publishes no build/);
    } finally {
      spy.mockRestore();
    }
  });

  // Two agents reaching for the browser at once is ordinary; two concurrent
  // 156 MB downloads writing one path is not something to find in the field.
  it('collapses concurrent installs onto one download', async () => {
    const fetchImpl = fakeFetch(Buffer.from('binary'));
    const env = { LMTHING_CACHE_ROOT: dir, LMTHING_LIGHTPANDA_URL: 'https://example.test/lp' };
    const [a, b] = await Promise.all([
      installLightpanda({ env, fetchImpl }),
      installLightpanda({ env, fetchImpl }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('lightpandaDownloadUrl', () => {
  it('honours an explicit override', () => {
    expect(lightpandaDownloadUrl({ LMTHING_LIGHTPANDA_URL: 'https://x.test/lp' })).toBe('https://x.test/lp');
  });

  it('derives the nightly asset URL for this platform', () => {
    const url = lightpandaDownloadUrl({});
    if (!lightpandaAssetName()) {
      expect(url).toBeUndefined();
      return;
    }
    expect(url).toContain('/releases/download/nightly/');
    expect(url).toContain(lightpandaAssetName()!);
  });
});
