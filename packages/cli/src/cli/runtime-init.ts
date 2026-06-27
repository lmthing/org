import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { defaultSystemSpaceDirs } from '@lmthing/core';

/** Path to the shipped-hash manifest: records, per system space, the content hash of
 *  the shipped source that produced the materialized copy. Used to tell whether the
 *  user's copy is pristine (safe to auto-update) or locally modified (hold back). */
function manifestPath(root: string): string {
  return join(root, 'system', '.shipped.json');
}

function readManifest(root: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(manifestPath(root), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeManifest(root: string, manifest: Record<string, string>): void {
  mkdirSync(join(root, 'system'), { recursive: true });
  writeFileSync(manifestPath(root), JSON.stringify(manifest, null, 2), 'utf8');
}

/** Stable content hash of a directory tree: sha256 over each file's relative path +
 *  bytes, in sorted order. Ignores mtimes (which change on copy). Returns '' for a
 *  missing dir. */
export function hashDir(dir: string): string {
  if (!existsSync(dir)) return '';
  const h = createHash('sha256');
  const walk = (d: string): void => {
    const entries = readdirSync(d).sort();
    for (const name of entries) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        h.update(relative(dir, full));
        h.update('\0');
        h.update(readFileSync(full));
        h.update('\0');
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

/**
 * The system space whose presence proves a runtime root is fully materialized.
 * `user-thing` is the default agent every session loads, so if it's missing the
 * runtime is broken (or only half-initialized) regardless of whether `system/`
 * exists as an empty directory.
 */
const SENTINEL_SYSTEM_SPACE = 'user-thing';

/**
 * True when `<root>/system/<sentinel>` is absent. Used to decide whether to
 * (re-)materialize: a persistent volume can carry an empty `system/` from an
 * earlier broken materialization, and checking only for the `system/` dir would
 * skip the needed repair.
 */
export function runtimeNeedsInit(root: string): boolean {
  return !existsSync(join(root, 'system', 'spaces', SENTINEL_SYSTEM_SPACE));
}

/**
 * Materialize a runtime into `<root>`:
 * - Copies every system space shipped with @lmthing/core into `<root>/system/spaces/<name>/`.
 * - Creates the default 'user' project skeleton under `<root>/user/`.
 *
 * When called, this OVERWRITES the system-space dirs via cpSync and leaves
 * existing user files (instructions.md, project.json) intact. It is *not* an
 * auto-update mechanism, though: callers gate it behind `runtimeNeedsInit()`,
 * which only fires when the runtime is uninitialized/half-initialized. An
 * already-populated `<root>/system/` is therefore preserved across image
 * upgrades (the user's copy wins); adopting newer shipped system spaces is an
 * explicit, opt-in action — see `.issues/system-spaces-opt-in-update.md`. The
 * `lmthing init` command calls this directly, which does refresh on demand.
 *
 * Returns the number of system spaces copied. Zero means the bundled assets
 * could not be resolved (e.g. @lmthing/core is bundled into the cli and its
 * system-spaces are not co-located with the bundle) — callers should treat that
 * as a hard misconfiguration, since every session would then fail to find the
 * `thing` agent.
 */
export function materializeRuntime(root: string): number {
  const systemDest = join(root, 'system', 'spaces');
  mkdirSync(systemDest, { recursive: true });
  let copied = 0;
  const manifest = readManifest(root);
  for (const srcDir of defaultSystemSpaceDirs()) {
    if (!existsSync(srcDir)) {
      process.stderr.write(`[lmthing] WARNING: system space source not found: ${srcDir}\n`);
      continue;
    }
    const name = basename(srcDir);
    cpSync(srcDir, join(systemDest, name), { recursive: true });
    manifest[name] = hashDir(srcDir); // record the shipped hash we just materialized
    copied++;
  }
  if (copied > 0) writeManifest(root, manifest);
  if (copied === 0) {
    process.stderr.write(
      '[lmthing] WARNING: no system spaces were materialized — sessions will fail to ' +
      'find the "thing" agent. Check that system-spaces ship alongside the cli bundle.\n',
    );
  }

  // Default 'user' project skeleton.
  const userRoot = join(root, 'user');
  mkdirSync(join(userRoot, 'spaces'), { recursive: true });
  mkdirSync(join(userRoot, 'documents'), { recursive: true });

  const instructionsPath = join(userRoot, 'instructions.md');
  if (!existsSync(instructionsPath)) writeFileSync(instructionsPath, '', 'utf8');

  const projectJsonPath = join(userRoot, 'project.json');
  if (!existsSync(projectJsonPath)) {
    writeFileSync(
      projectJsonPath,
      JSON.stringify({ id: 'user', name: 'user', createdAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  }

  return copied;
}

export interface SyncResult {
  /** System spaces whose materialized copy was (re-)written from the shipped source. */
  updated: string[];
  /** System spaces with a shipped update available but held back (locally modified). */
  heldBack: string[];
}

/**
 * Reconcile the materialized `<root>/system/spaces/*` against the shipped source
 * (`defaultSystemSpaceDirs()`), honoring `.issues/system-spaces-opt-in-update.md`:
 *
 * - **New / missing** space → copy it.
 * - **Up to date** (recorded hash === shipped hash) → skip.
 * - **Pristine but outdated** (materialized matches the recorded shipped hash, i.e. the
 *   user never edited it) → AUTO-ADOPT the shipped version. This is provably safe — no
 *   user content is lost — and is what makes a developer's source edits take effect
 *   without a manual copy, and what un-stales a plain user volume after an image upgrade.
 * - **Locally modified AND outdated** (materialized differs from the recorded hash) →
 *   HOLD BACK and report it, so the user's customization is never silently overwritten.
 *   Pass `adopt: true` (CLI `--adopt-system-spaces` / env `LM_ADOPT_SYSTEM_SPACES=1`) to
 *   overwrite anyway, backing the old copy up to `<name>.bak-<ts>` first.
 * - **Legacy, no recorded hash** → cannot prove pristine, so treat like "locally
 *   modified": hold back (or adopt with backup under `adopt`). Record the hash so the
 *   next mismatch is classifiable.
 *
 * Safe to call on every boot; cheap (hashes a handful of small dirs).
 */
export function syncSystemSpaces(root: string, opts: { adopt?: boolean } = {}): SyncResult {
  const adopt = opts.adopt === true || process.env['LM_ADOPT_SYSTEM_SPACES'] === '1';
  const systemDest = join(root, 'system', 'spaces');
  const manifest = readManifest(root);
  const updated: string[] = [];
  const heldBack: string[] = [];
  let changed = false;

  // Replace dest with a fresh copy of src (rm first so files deleted upstream don't linger).
  const replace = (src: string, dest: string): void => {
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  };

  for (const srcDir of defaultSystemSpaceDirs()) {
    if (!existsSync(srcDir)) continue;
    const name = basename(srcDir);
    const dest = join(systemDest, name);
    const shippedHash = hashDir(srcDir);
    const recorded = manifest[name];

    if (!existsSync(dest)) {
      mkdirSync(systemDest, { recursive: true });
      cpSync(srcDir, dest, { recursive: true });
      manifest[name] = shippedHash; changed = true; updated.push(name);
      continue;
    }
    if (recorded === shippedHash) continue; // up to date

    const currentHash = hashDir(dest);
    if (currentHash === shippedHash) {
      // Already matches shipped (e.g. manually refreshed) — just record the hash.
      manifest[name] = shippedHash; changed = true;
      continue;
    }
    const pristine = recorded !== undefined && currentHash === recorded;
    if (pristine) {
      // Provably unmodified by the user → adopt the shipped update (nothing to lose).
      replace(srcDir, dest);
      manifest[name] = shippedHash; changed = true; updated.push(name);
    } else if (adopt) {
      // Locally modified, but the user opted in → back up then overwrite.
      try { renameSync(dest, `${dest}.bak-${Date.now()}`); } catch { rmSync(dest, { recursive: true, force: true }); }
      cpSync(srcDir, dest, { recursive: true });
      manifest[name] = shippedHash; changed = true; updated.push(name);
    } else {
      // Locally modified (or legacy, unprovable) → hold back; record a baseline so the
      // next shipped change is classifiable, but never overwrite the user's copy.
      heldBack.push(name);
      if (recorded === undefined) { manifest[name] = currentHash; changed = true; }
    }
  }

  if (changed) writeManifest(root, manifest);
  return { updated, heldBack };
}
