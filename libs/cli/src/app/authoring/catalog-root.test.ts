/**
 * Tests for {@link ./catalog-root.ts}'s `resolveCatalogRoot`.
 *
 * Covers: `LM_STORE_APPS_DIR` env override wins over everything else, walking
 * up to a monorepo root (dir with both `store/` and `pnpm-workspace.yaml`)
 * from a nested cwd, and the `<cwd>/store/projects` fallback when no such
 * ancestor exists.
 *
 * `process.chdir()` isn't supported under vitest's worker-thread pool, so cwd
 * is faked via `vi.spyOn(process, 'cwd')` instead of actually changing it.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCatalogRoot } from './catalog-root.js';

let scratch: string;
let originalEnv: string | undefined;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lm-catalog-root-'));
  originalEnv = process.env.LM_STORE_APPS_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEnv === undefined) delete process.env.LM_STORE_APPS_DIR;
  else process.env.LM_STORE_APPS_DIR = originalEnv;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('resolveCatalogRoot', () => {
  it('LM_STORE_APPS_DIR override wins and is created', () => {
    const override = join(scratch, 'custom', 'apps');
    process.env.LM_STORE_APPS_DIR = override;
    const result = resolveCatalogRoot();
    expect(result).toBe(override);
    expect(existsSync(override)).toBe(true);
  });

  it('walks up to the nearest ancestor with store/ + pnpm-workspace.yaml', () => {
    delete process.env.LM_STORE_APPS_DIR;
    const monorepoRoot = join(scratch, 'repo');
    mkdirSync(join(monorepoRoot, 'store'), { recursive: true });
    writeFileSync(join(monorepoRoot, 'pnpm-workspace.yaml'), 'packages: []\n');
    const nested = join(monorepoRoot, 'sdk', 'org', 'libs', 'cli');
    mkdirSync(nested, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(nested);

    const result = resolveCatalogRoot();
    expect(result).toBe(join(monorepoRoot, 'store', 'projects'));
    expect(existsSync(result)).toBe(true);
  });

  it('falls back to <cwd>/store/projects when no monorepo root is found', () => {
    delete process.env.LM_STORE_APPS_DIR;
    const isolated = join(scratch, 'isolated');
    mkdirSync(isolated, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(isolated);

    const result = resolveCatalogRoot();
    expect(result).toBe(join(isolated, 'store', 'projects'));
    expect(existsSync(result)).toBe(true);
  });
});
