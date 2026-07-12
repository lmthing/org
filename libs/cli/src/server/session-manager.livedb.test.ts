/**
 * Regression: a long-lived interactive session's `db` must reflect the LIVE project db,
 * not a build-time snapshot.
 *
 * THING opens a project and builds its `appGlobals` ONCE — usually before the app has any
 * tables, so `getProjectDb` returns `null`. Its delegates (the automator) inherit that
 * `appGlobals` and inject `db` at child-VM creation. Before the fix, `db` was a snapshot of
 * that initial `null`, so an automator delegated AFTER the first table was authored still
 * found no `db` and could not mutate a row — the S06 Act V failure ("update the db from a
 * later message" → `'db' is not defined`). The fix makes `appGlobals.db` a STABLE forwarder
 * over the per-project db cache, so the SAME object reflects whatever db is booted at the
 * moment it is read.
 *
 * Keyless + in-process (real better-sqlite3 app boot); no model turn loop.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockStreamFn } from '@lmthing/core';
import type { AppGlobalImpls } from '@lmthing/core';
import { SessionManager } from './session-manager.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const TABLE_SCHEMA = {
  title: 'Things',
  description: 'test rows',
  columns: {
    id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
    name: { type: 'string', description: 'a name' },
  },
};

/** A tmp lmthingRoot with one project dir that starts with NO `database/` (db-less). */
async function makeRoot(projectId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-livedb-'));
  tmpDirs.push(root);
  await mkdir(join(root, projectId), { recursive: true });
  await writeFile(join(root, projectId, 'instructions.md'), '# test project\n', 'utf8');
  return root;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SessionManager — live db forwarder (appGlobals.db reflects the current project db)', () => {
  it('a db-less project exposes db.tables() === [] (no ReferenceError), then reflects a table authored later on the SAME appGlobals', async () => {
    const projectId = 'trip';
    const root = await makeRoot(projectId);
    const mgr = new SessionManager({ streamFn: createMockStreamFn(() => ''), lmthingRoot: root });

    // Build appGlobals ONCE, while the project has no tables — exactly THING's lifecycle.
    const ag = (await (
      mgr as unknown as { getProjectAppGlobals: (r: string, p: string) => Promise<AppGlobalImpls> }
    ).getProjectAppGlobals(root, projectId)) as AppGlobalImpls & {
      db: import('../app/store.js').ProjectDb['db'];
      writeProjectTable: (name: string, schema: unknown, rows?: unknown[]) => { ok: boolean; error?: string };
    };

    // db is present (matching the DTS, which declares it from the capability grant) and its
    // "what exists?" probe answers [] rather than throwing on a db-less project.
    expect(typeof ag.db).toBe('object');
    expect(ag.db.tables()).toEqual([]);
    // A mutating verb throws a CLEAR error (not a ReferenceError) before any table exists.
    expect(() => ag.db.insert('things', { name: 'x' })).toThrow(/has no database yet/);

    // Author the first table THROUGH the same appGlobals (fires the async db re-derive).
    const res = ag.writeProjectTable('things', TABLE_SCHEMA);
    expect(res.ok).toBe(true);

    // The re-derive is fire-and-forget; poll the SAME `ag.db` until the live db appears.
    let tables: string[] = [];
    for (let i = 0; i < 100; i++) {
      tables = ag.db.tables();
      if (tables.includes('things')) break;
      await sleep(20);
    }
    expect(tables).toContain('things');

    // And the SAME forwarder now performs real reads/writes against the booted db — this is
    // what makes a later automator delegate's `db.update` land (S06 Act V).
    ag.db.insert('things', { name: 'zzcheck' });
    const rows = ag.db.query('things');
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe('zzcheck');

    await mgr.closeProjectDbs?.();
  });
});
