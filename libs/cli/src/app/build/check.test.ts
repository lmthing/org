/**
 * {@link runProjectAppCheck} — the three-phase aggregator (typecheck → contract → build).
 *
 * Regression coverage for the "checks clean ≠ builds" gap: before the `contract` phase
 * existed, `runProjectAppCheck` ran ONLY `typecheckProjectApp` then `buildProjectPagesChecked`
 * (the esbuild bundle) — it never ran `generateProjectContracts` (the SAME per-endpoint
 * `ts-json-schema-generator` pass `POST .../app/build` runs, via `pages.ts#runBuild` →
 * `schema.ts#generateAppTypes`) on its own, so a contract-generation throw either propagated
 * UNCAUGHT out of `buildApp()` (the agent-facing global — see `libs/core/src/globals/
 * build-app.ts`) or, if it happened to be swallowed somewhere downstream, left `POST
 * .../app/check` reporting `ok:true` for a project `POST .../app/build` could not actually
 * build. These tests reproduce a contract-gen failure that `typecheckProjectApp` genuinely
 * cannot see (a malformed `database/*.json` — `typecheckProjectApp`'s `SOURCE_DIRS` are
 * `pages`/`components`/`api` only, it never touches `database/`) and assert `check.ts` now
 * surfaces it as a structured `phase:'contract'` `AppCheckError` instead of throwing.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runProjectAppCheck } from './check.js';
import { generateProjectContracts } from './contracts.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const PING_HANDLER = `export const name = 'ping';

export interface Output { pong: boolean }

export default async function handler(): Promise<Output> {
  return { pong: true };
}
`;

/** A project that typechecks CLEAN (one trivial `api/` handler, no `pages/`) but whose
 *  `database/broken.json` is invalid JSON — `loadProjectApp` (called from `generateAppTypes`,
 *  which both `generateProjectContracts` and the real `POST .../app/build` run) throws
 *  fail-loud on it, while `typecheckProjectApp`'s `SOURCE_DIRS` never look at `database/` at
 *  all, so its own `tsc` pass is unaffected. */
async function projectWithBrokenDatabase(): Promise<string> {
  const root = await scratch('lm-check-brokendb-');
  await mkdir(join(root, 'api', 'ping'), { recursive: true });
  await mkdir(join(root, 'database'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'brokendb-scratch', version: '0.0.0' }));
  await writeFile(join(root, 'api', 'ping', 'GET.ts'), PING_HANDLER, 'utf8');
  await writeFile(join(root, 'database', 'broken.json'), '{ not valid json', 'utf8');
  return root;
}

describe('runProjectAppCheck — contract phase', () => {
  it('a broken database/*.json trips generateProjectContracts directly (sanity: this IS a real contract-gen failure)', async () => {
    const root = await projectWithBrokenDatabase();
    await expect(generateProjectContracts(root)).rejects.toThrow(/invalid JSON/);
  });

  it('typecheckProjectApp alone stays CLEAN for the same project — database/ is out of its scope', async () => {
    const { typecheckProjectApp } = await import('./typecheck.js');
    const root = await projectWithBrokenDatabase();
    expect(await typecheckProjectApp(root)).toEqual([]);
  }, 30_000);

  it('runProjectAppCheck reports a structured phase:"contract" error instead of throwing, and never reports ok:true', async () => {
    const root = await projectWithBrokenDatabase();
    const result = await runProjectAppCheck(root);
    expect(result.ok).toBe(false);
    expect(result.built).toBe(false);
    expect(result.routes).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].phase).toBe('contract');
    expect(result.errors[0].message).toMatch(/invalid JSON/);
  }, 30_000);

  it('does not run the esbuild build phase once the contract phase has failed (short-circuits, same as typecheck)', async () => {
    const root = await projectWithBrokenDatabase();
    const result = await runProjectAppCheck(root);
    // The only error is the contract one — no esbuild/`phase:'build'` noise layered on top.
    expect(result.errors.every((e) => e.phase === 'contract')).toBe(true);
  }, 30_000);
});
