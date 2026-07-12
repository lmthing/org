/**
 * ProjectHookRuntime cascade test ({@link ./runtime.ts}).
 *
 * Since S6 db-write dispatch flows as EVENT hooks subscribing to the synthetic
 * `project/db.<table>.<event>` event (the database-hook replacement). This is the
 * regression for the stalled-cascade bug: a hook-triggered run's own db writes
 * fire `onDbWrite` *while the runtime is draining*, so `scheduleDrain` is
 * suppressed and the dispatcher's snapshot-up-front `drain()` never sees them.
 * Without the post-drain re-arm, a cascade A → B stalls after one level. The
 * runtime must re-arm a follow-up drain tick when events enqueued mid-drain remain.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// runHook is the external dependency of the runtime's drain loop — mock it so a run can
// synchronously emit a cascaded db write via the captured write listener.
const runHookMock = vi.fn();
vi.mock('../../server/routes/hooks.js', () => ({
  runHook: (...args: unknown[]) => runHookMock(...args),
}));

import { ProjectHookRuntime } from './runtime.js';
import { clearEmitterDefCache } from '../../server/emitter-manifests.js';
import type { LoadedHook } from './loader.js';
import type { WriteListener, ProjectDb } from '../store.js';

const eventHook = (slug: string, address: string): LoadedHook => ({
  slug,
  owner: 'project',
  def: { type: 'event', on: { event: address }, trigger: `x/${slug}#run` },
});

const tick = () => new Promise((r) => setImmediate(r));

describe('ProjectHookRuntime — cascaded db-write event hooks', () => {
  it('re-arms a drain so a hook whose run enqueues another event completes the cascade', async () => {
    let listener: WriteListener | undefined;
    const fakeDb = { setOnWrite: (fn: WriteListener | undefined) => { listener = fn; } } as unknown as ProjectDb;

    const ran: string[] = [];
    runHookMock.mockReset();
    runHookMock.mockImplementation(async (_mgr, _root, _proj, hook: { slug: string }) => {
      ran.push(hook.slug);
      // Hook "a" (subscribing to db.documents.insert) writes `labs`, which "b" subscribes to.
      if (hook.slug === 'a') listener?.({ table: 'labs', event: 'insert', rows: [{ id: 'x' }] });
      return { queued: false };
    });

    // eslint-disable-next-line no-new
    new ProjectHookRuntime(
      'health',
      '/tmp/root',
      {} as never,
      fakeDb,
      [eventHook('a', 'project/db.documents.insert'), eventHook('b', 'project/db.labs.insert')],
    );

    // A user/api write into `documents` (depth 0) fires hook "a".
    listener?.({ table: 'documents', event: 'insert', rows: [{ id: 'd1' }] });

    // Drain "a" (which mid-run enqueues "b"'s synthetic event), then the re-armed tick drains "b".
    await tick();
    await tick();
    await tick();

    expect(ran).toEqual(['a', 'b']);
  });

  it('passes the written row as the event hook ctx.input (synthetic payload = row)', async () => {
    let listener: WriteListener | undefined;
    const fakeDb = { setOnWrite: (fn: WriteListener | undefined) => { listener = fn; } } as unknown as ProjectDb;

    const inputs: unknown[] = [];
    runHookMock.mockReset();
    runHookMock.mockImplementation(async (_mgr, _root, _proj, _hook, _row, opts: { input?: unknown }) => {
      inputs.push(opts?.input);
      return { queued: false };
    });

    // eslint-disable-next-line no-new
    new ProjectHookRuntime('health', '/tmp/root', {} as never, fakeDb, [
      eventHook('a', 'project/db.posts.insert'),
    ]);

    listener?.({ table: 'posts', event: 'insert', rows: [{ id: 'p1', title: 'hello' }] });
    await tick();
    await tick();

    expect(inputs).toEqual([{ id: 'p1', title: 'hello' }]);
  });

  it('reload() adds a newly authored hook to the live dispatch set (no restart)', async () => {
    let listener: WriteListener | undefined;
    const fakeDb = { setOnWrite: (fn: WriteListener | undefined) => { listener = fn; } } as unknown as ProjectDb;

    const ran: string[] = [];
    runHookMock.mockReset();
    runHookMock.mockImplementation(async (_mgr, _root, _proj, hook: { slug: string }) => {
      ran.push(hook.slug);
      return { queued: false };
    });

    // The project boots its db-write dispatch with ONE hook.
    const rt = new ProjectHookRuntime('health', '/tmp/root', {} as never, fakeDb, [
      eventHook('a', 'project/db.tips.insert'),
    ]);

    // A hook authored AFTER the db booted (the automator's "summarize on store") must fire
    // without a restart — this is the bug the reload() seam fixes.
    rt.reload([
      eventHook('a', 'project/db.tips.insert'),
      eventHook('summarize', 'project/db.tips.insert'),
    ]);

    listener?.({ table: 'tips', event: 'insert', rows: [{ id: 't1' }] });
    await tick();
    await tick();

    expect(ran.sort()).toEqual(['a', 'summarize']);
  });
});

describe('ProjectHookRuntime — db emitter defs + synthetic event (real worker)', () => {
  let root: string;
  const PROJECT = 'shop';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    clearEmitterDefCache();
  });

  function writeFixture(rel: string, source: string): void {
    const path = join(root, PROJECT, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source, 'utf8');
  }

  it('a {type:db} emitter transforms a row into a typed event, alongside the synthetic event — a mixed drain with independent slug coalescing', async () => {
    root = mkdtempSync(join(tmpdir(), 'hooks-runtime-'));
    clearEmitterDefCache();
    // A db emitter def: a row written to `orders` → a typed `order.created` event.
    writeFixture(
      'events/order-emitter.ts',
      `export default {
        type: 'db', on: { table: 'orders', event: 'insert' },
        emits: { 'order.created': { payload: { id: 'string', total: 'number' } } },
        emit(row) { return [{ event: 'order.created', payload: { id: row.row.id, total: row.row.total } }]; },
      }`,
    );

    let listener: WriteListener | undefined;
    const fakeDb = { setOnWrite: (fn: WriteListener | undefined) => { listener = fn; } } as unknown as ProjectDb;

    const fired: Array<{ slug: string; input: unknown }> = [];
    runHookMock.mockReset();
    runHookMock.mockImplementation(async (_mgr, _root, _proj, hook: { slug: string }, _row, opts: { input?: unknown }) => {
      fired.push({ slug: hook.slug, input: opts?.input });
      return { queued: false };
    });

    // TWO event hooks: one on the SYNTHETIC raw-table event, one on the db-emitter TYPED event.
    const rawSub: LoadedHook = { slug: 'raw-sub', owner: 'project', def: { type: 'event', on: { event: 'project/db.orders.insert' }, trigger: 'x/raw#run' } };
    const typedSub: LoadedHook = { slug: 'typed-sub', owner: 'project', def: { type: 'event', on: { event: 'project/order.created' }, trigger: 'x/typed#run' } };

    // eslint-disable-next-line no-new
    new ProjectHookRuntime(PROJECT, root, {} as never, fakeDb, [rawSub, typedSub]);

    listener?.({ table: 'orders', event: 'insert', rows: [{ id: 'o1', total: 42 }] });
    // Allow the synchronous synthetic drain + the async worker-emit drain to complete.
    await new Promise((r) => setTimeout(r, 400));

    const bySlug = Object.fromEntries(fired.map((f) => [f.slug, f.input]));
    expect(Object.keys(bySlug).sort()).toEqual(['raw-sub', 'typed-sub']);
    // Synthetic event payload IS the row; the db-emitter event is the typed transform.
    expect(bySlug['raw-sub']).toEqual({ id: 'o1', total: 42 });
    expect(bySlug['typed-sub']).toEqual({ id: 'o1', total: 42 });
  });
});
