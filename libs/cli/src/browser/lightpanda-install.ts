/**
 * Fetch the Lightpanda browser on demand, into the same cache a bundled
 * `lmthing` extracts itself into.
 *
 * ## Why it is not in the executable
 *
 * Lightpanda is ~156 MB on Linux — larger than the Node runtime, the CLI, the
 * SPA, the system spaces and zerostack put together. Embedding it would roughly
 * triple the download for everyone, and most runs never browse at all. So the
 * bundle ships without it and fetches it the first time an agent actually
 * reaches for a browser (`lightpanda-proxy.ts` is what notices), or ahead of
 * time on request (`lmthing browser install`).
 *
 * ## Why the URL is computed here rather than baked in at build time
 *
 * A bundled executable only ever runs on the platform it was built for, so the
 * asset name is knowable from `process.platform`/`process.arch` at runtime. The
 * build scripts therefore do NOT record a download URL — this table is the only
 * one, and cannot disagree with a second copy that someone forgot to update.
 *
 * ## Why there is no version to pin
 *
 * Upstream publishes a single rolling `nightly` tag and overwrites its assets in
 * place; there are no versioned releases to pin to. Rather than imply a pin it
 * does not have, this records the sha256 of whatever it actually fetched, beside
 * the binary, so an installed browser can at least be identified after the fact.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Upstream's only tag. See the note above — this is not a version. */
const LIGHTPANDA_TAG = 'nightly';

/**
 * Upstream asset names, keyed by `<node platform>-<node arch>`.
 *
 * The absent rows are the point: Lightpanda publishes nothing for Windows, and
 * nothing for 32-bit anything. {@link lightpandaAssetName} returning undefined is
 * how every caller learns that browsing cannot be installed here, instead of a
 * download 404ing later with a URL nobody can act on.
 */
const ASSETS: Record<string, string> = {
  'linux-x64': 'lightpanda-x86_64-linux',
  'linux-arm64': 'lightpanda-aarch64-linux',
  'darwin-x64': 'lightpanda-x86_64-macos',
  'darwin-arm64': 'lightpanda-aarch64-macos',
};

/** The upstream asset for a platform, or undefined when there is none. */
export function lightpandaAssetName(platform: string = process.platform, arch: string = process.arch): string | undefined {
  return ASSETS[`${platform}-${arch}`];
}

/** The download URL for this platform, or undefined when unsupported. */
export function lightpandaDownloadUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env['LMTHING_LIGHTPANDA_URL'];
  if (override && override.trim()) return override.trim();
  const asset = lightpandaAssetName();
  if (!asset) return undefined;
  return `https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_TAG}/${asset}`;
}

/**
 * The cache root.
 *
 * A bundled run has one already — the launcher publishes `LMTHING_CACHE_ROOT`
 * after resolving it, so the browser lands beside the extracted runtime instead
 * of in a second directory computed by slightly different rules.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const published = env['LMTHING_CACHE_ROOT'] || env['LMTHING_BUNDLE_CACHE'];
  if (published && published.trim()) return published.trim();
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'lmthing');
  if (process.platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    return join(local && local.trim() ? local.trim() : join(homedir(), 'AppData', 'Local'), 'lmthing', 'Cache');
  }
  const xdg = env['XDG_CACHE_HOME'];
  return join(xdg && xdg.trim() ? xdg.trim() : join(homedir(), '.cache'), 'lmthing');
}

/** Where an installed Lightpanda lives. Per-platform, so one cache can be shared. */
export function lightpandaCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(cacheRoot(env), 'lightpanda', `${process.platform}-${process.arch}`, 'lightpanda');
}

/**
 * An already-installed Lightpanda in the cache, if there is one.
 *
 * `exists` is narrowed to `(p: string) => boolean` rather than reusing
 * `existsSync`'s `PathLike` signature, so it accepts the same injected stub the
 * rest of this module's callers already pass around.
 */
export function cachedLightpanda(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const p = lightpandaCachePath(env);
  return exists(p) ? p : undefined;
}

/** Whether the boolean-ish env value opts OUT. Mirrors `autostartDisabled`. */
export function installDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ['0', 'false', 'no', 'off', ''].includes(raw.trim().toLowerCase());
}

export interface InstallResult {
  ok: boolean;
  /** Absolute path of the installed binary, when `ok`. */
  path?: string;
  /** sha256 of what was fetched — the only identity this artifact has. */
  sha256?: string;
  /** True when it was already present and nothing was downloaded. */
  cached?: boolean;
  reason?: string;
}

export interface InstallDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Re-download even when a cached copy exists. */
  force?: boolean;
  /** Called with (receivedBytes, totalBytes|undefined) as the download proceeds. */
  onProgress?: (received: number, total?: number) => void;
}

/**
 * One in-flight install per process.
 *
 * Two agents reaching for the browser at the same moment is ordinary, and two
 * concurrent 156 MB downloads writing the same path is not something to discover
 * in the field. Callers all await the same promise.
 */
let inflight: Promise<InstallResult> | null = null;

/**
 * Ensure Lightpanda is installed in the cache, downloading it if needed.
 *
 * Never throws — browsing being unavailable is a degraded state the whole
 * browser layer already models, and turning it into an exception here would take
 * down callers that are only *offering* to browse.
 */
export function installLightpanda(deps: InstallDeps = {}): Promise<InstallResult> {
  if (inflight) return inflight;
  inflight = doInstall(deps).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doInstall(deps: InstallDeps): Promise<InstallResult> {
  const { env = process.env, fetchImpl = fetch, log = () => {}, force = false, onProgress } = deps;

  const dest = lightpandaCachePath(env);
  if (!force && existsSync(dest)) return { ok: true, path: dest, cached: true };

  const url = lightpandaDownloadUrl(env);
  if (!url) {
    return {
      ok: false,
      reason:
        `Lightpanda publishes no build for ${process.platform}-${process.arch} — ` +
        `browsing needs an external server (set LIGHTPANDA_MCP_URL) on this platform`,
    };
  }

  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  rmSync(tmp, { force: true });

  try {
    log(`[browser] downloading Lightpanda (~156 MB) from ${url}`);
    const res = await fetchImpl(url, { redirect: 'follow' });
    if (!res.ok || !res.body) {
      return { ok: false, reason: `download failed: HTTP ${res.status} ${res.statusText}` };
    }

    const total = Number(res.headers.get('content-length')) || undefined;
    let received = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    // Counted in a Transform rather than a `data` listener: attaching one of
    // those switches the stream into flowing mode before `pipeline` has hooked
    // up the destination, which drops the leading chunks. The count is also
    // unconditional — it feeds the truncation check below, so making it depend
    // on a caller passing `onProgress` would mean unwatched downloads went
    // unverified (and, when the check was still run, always looked truncated).
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        onProgress?.(received, total);
        cb(null, chunk);
      },
    });
    await pipeline(source, counter, createWriteStream(tmp, { mode: 0o755 }));

    // A truncated download is the failure mode that matters: the file exists, is
    // executable, and dies at exec with a message about a bad ELF header. Check
    // the length we were promised before anything is allowed to run it.
    if (total !== undefined && received !== total) {
      rmSync(tmp, { force: true });
      return { ok: false, reason: `download truncated: got ${received} of ${total} bytes` };
    }

    const sha256 = await hashFile(tmp);
    // Atomic publish: no reader ever sees a partially-written browser.
    renameSync(tmp, dest);
    writeFileSync(`${dest}.sha256`, `${sha256}  ${url}\n`);
    log(`[browser] Lightpanda installed at ${dest}`);
    return { ok: true, path: dest, sha256 };
  } catch (e) {
    rmSync(tmp, { force: true });
    return { ok: false, reason: `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
