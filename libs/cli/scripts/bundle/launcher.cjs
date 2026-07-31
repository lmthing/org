'use strict';
/**
 * The entrypoint compiled INTO the single-file executable.
 *
 * A bundled `lmthing` is Node's own binary with a payload appended (`node:sea`).
 * This file is the SEA main script, and its whole job is to turn that back into
 * the on-disk tree the CLI needs (see `payload.mjs` for why a tree is
 * unavoidable), then hand over to the real entrypoint.
 *
 * ## Why it extracts instead of running from memory
 *
 * `node:sea` can serve embedded assets to code that asks for them by name, but
 * nothing in the CLI asks. It resolves the system spaces by walking up from
 * `import.meta.url`, esbuilds `@app/runtime` from TypeScript source on disk,
 * loads a native addon for PTYs, and spawns a vendored binary as a subprocess.
 * Those are filesystem operations by nature — a virtual-fs shim would have to
 * intercept `fs`, `require`, esbuild's own resolver AND `execve`, and would fail
 * differently on each. Extracting once is the honest version of the same thing.
 *
 * ## CommonJS, deliberately
 *
 * SEA main scripts must be CJS. The real entrypoint is ESM, reached below with a
 * dynamic `import()` of an absolute `file://` URL — which works because this is a
 * genuine Node runtime, not an emulation of one.
 */

const { getAsset } = require('node:sea');
const { execFileSync } = require('node:child_process');
const { enableCompileCache } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** Written into the executable by `build.mjs`; describes what the payload holds. */
const INFO = JSON.parse(getAsset('bundle.json', 'utf8'));

/**
 * Where the extracted tree lives.
 *
 * Platform cache conventions, because this IS a cache: deleting it costs the
 * next run a few seconds and nothing else. `LMTHING_BUNDLE_CACHE` overrides, for
 * read-only homes and for CI.
 */
function cacheRoot() {
  const override = process.env.LMTHING_BUNDLE_CACHE;
  if (override && override.trim()) return path.resolve(override.trim());
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'lmthing');
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    return path.join(local && local.trim() ? local.trim() : path.join(home, 'AppData', 'Local'), 'lmthing', 'Cache');
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg && xdg.trim() ? xdg.trim() : path.join(home, '.cache'), 'lmthing');
}

/**
 * Unpack the payload to `dest`, atomically.
 *
 * Extraction goes to a private temp dir and is then `rename`d into place, so a
 * half-written tree is never visible under the real path. That matters more than
 * it looks: two `lmthing` processes starting at once on a cold cache is the
 * NORMAL case (a shell and an editor plugin), and a reader that found a
 * partially-extracted tree would fail with a missing-module error naming a file
 * that is about to exist.
 *
 * Losing the rename race is success, not failure — the winner's tree is
 * byte-identical, because the path is the payload's own content hash.
 */
function extractPayload(dest) {
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const tarball = path.join(parent, `payload-${process.pid}.tar.gz`);
  try {
    fs.writeFileSync(tarball, Buffer.from(getAsset('payload.tar.gz')));
    // System `tar` rather than a JS implementation: it is present on every
    // platform this bundle targets (there is no Windows target — see
    // `targets.mjs`), and it already handles the two things a hand-rolled
    // extractor gets wrong and only notices later — the executable bit on the
    // vendored binaries, and symlinks.
    execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.writeFileSync(path.join(tmp, '.complete'), `${INFO.id}\n`);
    try {
      fs.renameSync(tmp, dest);
    } catch (err) {
      // Another process got there first. Its tree has the same content hash as
      // ours, so it is the same tree.
      if (!fs.existsSync(dest)) throw err;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const detail = err && err.stderr ? String(err.stderr).trim() : err && err.message;
    throw new Error(
      `lmthing: could not unpack its runtime into ${parent}\n  ${detail}\n` +
        `  (set LMTHING_BUNDLE_CACHE to a writable directory to relocate it)`,
    );
  } finally {
    fs.rmSync(tarball, { force: true });
  }
}

function main() {
  const root = path.join(cacheRoot(), 'runtime', INFO.id);
  if (!fs.existsSync(path.join(root, '.complete'))) {
    fs.rmSync(root, { recursive: true, force: true });
    extractPayload(root);
  }

  // Point the CLI at what it now has, without overriding a deliberate choice —
  // an operator who set any of these meant it.
  const setDefault = (key, value) => {
    if (!process.env[key] || !process.env[key].trim()) process.env[key] = value;
  };
  setDefault('LM_APP_DIST', path.join(root, INFO.appDist));
  // Null on Windows, where upstream publishes no zerostack. Leaving the variable
  // UNSET is the point: pointing it at a path that does not exist would turn
  // "not available on this platform" into a spawn failure naming a missing file.
  if (INFO.zerostack) setDefault('LMTHING_ZEROSTACK_BIN', path.join(root, INFO.zerostack));
  // Tells the CLI it is running as a bundle, and where its tree is. This is also
  // what switches on installing Lightpanda on first browse — see
  // `autoInstallEnabled` in `src/browser/lightpanda.ts`.
  process.env.LMTHING_BUNDLE_ROOT = root;
  process.env.LMTHING_BUNDLE_ID = INFO.id;
  // Published rather than recomputed on the other side: the Lightpanda installer
  // caches into this same directory, and two independent implementations of
  // "where is the cache" would agree right up until someone set XDG_CACHE_HOME.
  process.env.LMTHING_CACHE_ROOT = cacheRoot();

  // V8 bytecode cache — the same trick the compute image bakes at build time.
  // Cold start compiles the whole bundle; caching turns every later start into a
  // deserialize. Keyed by path + content + V8 version, all fixed inside one
  // extracted tree. Never fatal: a read-only or full cache dir must not stop the
  // CLI from running.
  try {
    enableCompileCache(path.join(cacheRoot(), 'v8', INFO.id));
  } catch {
    /* best effort */
  }

  const entry = path.join(root, INFO.entry);
  return import(pathToFileURL(entry).href);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
