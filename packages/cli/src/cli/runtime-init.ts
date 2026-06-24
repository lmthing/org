import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { defaultSystemSpaceDirs } from '@lmthing/core';

/**
 * The system space whose presence proves a runtime root is fully materialized.
 * `thing` is the default agent every session loads, so if it's missing the
 * runtime is broken (or only half-initialized) regardless of whether `system/`
 * exists as an empty directory.
 */
const SENTINEL_SYSTEM_SPACE = 'thing';

/**
 * True when `<root>/system/<sentinel>` is absent. Used to decide whether to
 * (re-)materialize: a persistent volume can carry an empty `system/` from an
 * earlier broken materialization, and checking only for the `system/` dir would
 * skip the needed repair.
 */
export function runtimeNeedsInit(root: string): boolean {
  return !existsSync(join(root, 'system', SENTINEL_SYSTEM_SPACE));
}

/**
 * Materialize a runtime into `<root>`:
 * - Copies every system space shipped with @lmthing/core into `<root>/system/<name>/`.
 * - Creates the default 'user' project skeleton under `<root>/user/`.
 *
 * Idempotent: existing user files (instructions.md, project.json) are not
 * overwritten; system-space dirs are always refreshed via cpSync.
 *
 * Returns the number of system spaces copied. Zero means the bundled assets
 * could not be resolved (e.g. @lmthing/core is bundled into the cli and its
 * system-spaces are not co-located with the bundle) — callers should treat that
 * as a hard misconfiguration, since every session would then fail to find the
 * `thing` agent.
 */
export function materializeRuntime(root: string): number {
  const systemDest = join(root, 'system');
  mkdirSync(systemDest, { recursive: true });
  let copied = 0;
  for (const srcDir of defaultSystemSpaceDirs()) {
    if (!existsSync(srcDir)) {
      process.stderr.write(`[lmthing] WARNING: system space source not found: ${srcDir}\n`);
      continue;
    }
    cpSync(srcDir, join(systemDest, basename(srcDir)), { recursive: true });
    copied++;
  }
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
