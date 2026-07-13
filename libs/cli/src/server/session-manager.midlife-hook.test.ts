/**
 * Regression: an event hook authored AFTER the project's db has booted must join the LIVE
 * db-write dispatch set — without a pod restart.
 *
 * The db-write → EVENT dispatch runtime (`ProjectHookRuntime`, wired to `ProjectDb.onWrite`)
 * used to be created in ONE place: the first `getProjectDb()` boot, and only if the project
 * already had an event hook or a db emitter def. But a project's db comes into existence when
 * its FIRST TABLE is authored — necessarily BEFORE its first hook exists. So the boot-time
 * wiring found nothing to subscribe, skipped, and the cached db meant it never ran again;
 * `refreshProjectHooks()` (called on every authoring write) then returned early because there
 * was no runtime to reload. Net effect: a hook the agent authored mid-life NEVER fired on a db
 * write for the life of the pod process.
 *
 * That is scenario 10 Act III live: the automator authored `recipe_intake` + a
 * `project/db.recipe_intake.insert` event hook, the intake row landed — and the hook never ran,
 * so the normalized recipe never appeared ("the form is alive" promise, US-5, silently broken).
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
  // The wired hook runtime drains asynchronously (it writes `.data/` hook state), so a bare
  // rm() can race it and throw ENOTEMPTY — retry rather than fail the suite on teardown.
  await Promise.all(
    tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

const INTAKE_SCHEMA = {
  title: 'Recipe intake',
  description: 'raw recipes submitted through the app form',
  columns: {
    id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
    title: { type: 'string', description: 'the dish' },
  },
};

/** A tmp lmthingRoot with one project dir that starts with NO `database/` and NO `hooks/`. */
async function makeRoot(projectId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-midlife-hook-'));
  tmpDirs.push(root);
  await mkdir(join(root, projectId), { recursive: true });
  await writeFile(join(root, projectId, 'instructions.md'), '# test project\n', 'utf8');
  return root;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Privates = {
  getProjectAppGlobals: (r: string, p: string) => Promise<AppGlobalImpls>;
  projectHookRuntimes: Map<string, unknown>;
};
type Authoring = AppGlobalImpls & {
  db: import('../app/store.js').ProjectDb['db'];
  writeProjectTable: (name: string, schema: unknown, rows?: unknown[]) => { ok: boolean; error?: string };
  writeProjectHook: (slug: string, src: string) => { ok: boolean; error?: string };
};

describe('SessionManager — a hook authored after the db booted joins the live dispatch set', () => {
  it('wires the db-write→event runtime on the authoring write, not only at db boot', async () => {
    const projectId = 'family-recipes';
    const root = await makeRoot(projectId);
    const mgr = new SessionManager({ streamFn: createMockStreamFn(() => ''), lmthingRoot: root });
    const priv = mgr as unknown as Privates;

    const ag = (await priv.getProjectAppGlobals(root, projectId)) as Authoring;

    // 1. The app is built first: authoring the first table is what BOOTS the db — and at that
    //    moment the project has no hooks at all, so nothing is subscribed to db writes.
    expect(ag.writeProjectTable('recipe_intake', INTAKE_SCHEMA).ok).toBe(true);
    for (let i = 0; i < 100 && !ag.db.tables().includes('recipe_intake'); i++) await sleep(20);
    expect(ag.db.tables()).toContain('recipe_intake');
    expect(priv.projectHookRuntimes.has(projectId)).toBe(false); // nothing to dispatch to — correct

    // 2. NOW the agent authors the intake hook (the real Act III sequence: table+page first,
    //    hook second). Before the fix this hook was dead on arrival: the db was already cached,
    //    so the boot-time wiring never re-ran and refreshProjectHooks() had no runtime to reload.
    const hook = ag.writeProjectHook(
      'normalize-recipe-intake',
      `export default { type: 'event', on: { event: 'project/db.recipe_intake.insert' }, handler: async ({ input }) => ({ normalized: input.title }) }`,
    );
    expect(hook.ok).toBe(true);

    // The republish seam is fire-and-forget from the synchronous writer — poll for the wiring.
    let wired = false;
    for (let i = 0; i < 100; i++) {
      wired = priv.projectHookRuntimes.has(projectId);
      if (wired) break;
      await sleep(20);
    }
    expect(wired).toBe(true); // ← the regression: was false forever (until a pod restart)

    // 3. And the seam is LIVE: a db write now reaches the dispatcher (the row still lands).
    ag.db.insert('recipe_intake', { title: 'Ρεβίθια στο φούρνο' });
    expect(ag.db.query('recipe_intake').length).toBe(1);

    await sleep(200); // let the dispatcher drain before tearing the db down
    await mgr.closeProjectDbs?.();
  });
});
