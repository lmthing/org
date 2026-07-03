/**
 * Resolve the **catalog root** — the `store/apps/` directory that Phase 9
 * authoring globals ({@link ../authoring/globals.ts}) write app-authoring
 * templates into (`store/apps/<id>/`).
 *
 * Resolution order:
 *  1. `LM_STORE_APPS_DIR` env override (tests / non-standard layouts) — used
 *     verbatim, resolved to an absolute path.
 *  2. Walk UP from `process.cwd()` looking for the monorepo root: the first
 *     ancestor directory that contains BOTH a `store/` directory and a
 *     `pnpm-workspace.yaml` file (the same two markers that make a dir "the
 *     lmthing monorepo root" per `CLAUDE.md`). Returns `<root>/store/apps`.
 *  3. Fallback: `<cwd>/store/apps` (when no such ancestor is found — e.g. the
 *     cli is run outside the monorepo checkout).
 *
 * The resolved directory is always created (`mkdir -p`) before returning so
 * callers never need to guard against it being absent.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function resolveCatalogRoot(): string {
  const override = process.env.LM_STORE_APPS_DIR;
  if (override) {
    const dir = resolve(override);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const monorepoRoot = findMonorepoRoot(process.cwd());
  const dir = monorepoRoot ? join(monorepoRoot, 'store', 'apps') : join(process.cwd(), 'store', 'apps');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Walk up from `startDir` to the nearest ancestor containing both a `store/`
 * directory and a `pnpm-workspace.yaml` file. Returns `undefined` if no such
 * ancestor exists before the filesystem root.
 */
function findMonorepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, 'store')) && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // fs root
    dir = parent;
  }
}
