/**
 * ProjectHookRuntime cascade test ({@link ./runtime.ts}).
 *
 * Regression for the stalled-cascade bug: a hook-triggered run's own db writes fire
 * `onDbWrite` *while the runtime is draining*, so `scheduleDrain` is suppressed and the
 * dispatcher's snapshot-up-front `drain()` never sees them. Without the post-drain re-arm,
 * a cascade A → B (document → interpret, interpret → research, …) stalls after one level.
 * The runtime must re-arm a follow-up drain tick when writes enqueued mid-drain remain.
 */
import { describe, expect, it, vi } from 'vitest';

// runHook is the one external dependency of the runtime's drain loop — mock it so a run can
// synchronously emit a cascaded db write via the captured write listener.
const runHookMock = vi.fn();
vi.mock('../../server/routes/hooks.js', () => ({
  runHook: (...args: unknown[]) => runHookMock(...args),
}));

import { ProjectHookRuntime } from './runtime.js';
import type { LoadedHook } from './loader.js';
import type { WriteListener, ProjectDb } from '../store.js';

const dbHook = (slug: string, table: string): LoadedHook => ({
  slug,
  def: { type: 'database', on: { table, event: 'insert' }, trigger: `x/${slug}#run` },
});

const tick = () => new Promise((r) => setImmediate(r));

describe('ProjectHookRuntime — cascaded database hooks', () => {
  it('re-arms a drain so a hook whose run enqueues another hook completes the cascade', async () => {
    let listener: WriteListener | undefined;
    const fakeDb = { setOnWrite: (fn: WriteListener | undefined) => { listener = fn; } } as unknown as ProjectDb;

    const ran: string[] = [];
    runHookMock.mockReset();
    runHookMock.mockImplementation(async (_mgr, _root, _proj, hook: { slug: string }) => {
      ran.push(hook.slug);
      // Hook "a" (watching `documents`) writes `labs`, which hook "b" watches — the cascade.
      if (hook.slug === 'a') listener?.({ table: 'labs', event: 'insert', rows: [{ id: 'x' }] });
      return { queued: false };
    });

    // eslint-disable-next-line no-new
    new ProjectHookRuntime(
      'health',
      '/tmp/root',
      {} as never,
      fakeDb,
      [dbHook('a', 'documents'), dbHook('b', 'labs')],
    );

    // A user/api write into `documents` (depth 0) fires hook "a".
    listener?.({ table: 'documents', event: 'insert', rows: [{ id: 'd1' }] });

    // Drain "a" (which mid-run enqueues "b"), then the re-armed tick drains "b".
    await tick();
    await tick();
    await tick();

    expect(ran).toEqual(['a', 'b']);
  });
});
