/**
 * Internal SIGNAL seam (S8) — routing + fire-and-forget + loop protection.
 *
 * Covers:
 *   - END-TO-END (real scan + real worker): an instrumented-path signal →
 *     project `events/*.ts` internal def (worker-isolated pure `emit`) →
 *     schema-validated event → project event HANDLER hook receives it as
 *     `ctx.input` (fake manager supplies the run seam).
 *   - FIRE-AND-FORGET: a THROWING emitter def never propagates — the
 *     instrumented path is unaffected (`emitInternalSignal` returns
 *     synchronously; no unhandled rejection escapes the drain).
 *   - LOOP PROTECTION: a `hook.fired`-derived event never re-triggers the
 *     originating slug (self-trigger suppression via `skipHookSlug`), and a
 *     signal at/beyond `HOOK_DEPTH_CAP` routes nothing (depth cap).
 *   - FAN-OUT: a signal without `projectId` reaches every project's defs.
 *
 * The loop-protection/fan-out tests inject the `scan`/`invokeEmit` seams (no
 * worker spawn — the routing logic is what's under test); the e2e + throwing
 * tests run the REAL worker pipeline.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  emitInternalSignal,
  installInternalSignalSink,
  flushInternalSignals,
  resetInternalSignals,
} from './internal-signals.js';
import { clearEmitterDefCache, type EmitterScanResult } from './emitter-manifests.js';
import type { EventDispatchManager } from './event-dispatch.js';
import { HOOK_DEPTH_CAP } from '../app/hooks/loop-guard.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

// In-proc project-hook handlers share this process's globalThis — the fixture
// handlers push into this sink so tests can observe exactly which hook ran.
interface SinkEntry {
  tag: string;
  input?: unknown;
}
declare global {
  // eslint-disable-next-line no-var
  var __s8sink: SinkEntry[] | undefined;
}

beforeEach(() => {
  resetInternalSignals();
  clearEmitterDefCache();
  globalThis.__s8sink = [];
});
afterEach(() => {
  resetInternalSignals();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

async function newRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(root);
  return root;
}

/** Write a PROJECT-scope emitter def `<root>/<project>/events/<name>.ts`. */
async function writeEvent(root: string, project: string, name: string, source: string): Promise<void> {
  const dir = join(root, project, 'events');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.ts`), source, 'utf8');
}

/** Write a PROJECT event hook `<root>/<project>/hooks/<name>.ts`. */
async function writeHook(root: string, project: string, name: string, source: string): Promise<void> {
  const dir = join(root, project, 'hooks');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.ts`), source, 'utf8');
}

interface RunCall extends Record<string, unknown> {
  kind: 'runHeadless' | 'threaded';
}

/** Fake manager recording headless runs; null db (the fixture hooks don't use it). */
function makeManager(runs: RunCall[]): EventDispatchManager {
  return {
    runHeadless: async (args: Record<string, unknown>) => {
      runs.push({ kind: 'runHeadless', ...args });
      return { ok: true, result: 'ran', sessionId: 's1' };
    },
    runHeadlessThreaded: async (args: { sessionId: string } & Record<string, unknown>) => {
      runs.push({ kind: 'threaded', ...args });
      return { ok: true, result: 'threaded', sessionId: args.sessionId };
    },
    getProjectDb: async () => null,
    runTasklistHeadless: async () => ({}),
  } as unknown as EventDispatchManager;
}

/** A canned scan result: ONE project-scope internal def bound to `signal`,
 *  declaring `eventName` with an open payload. Used with the `invokeEmit` seam
 *  so loop-protection tests exercise routing without worker spawns. */
function cannedScan(signal: string, eventName: string): (root: string, projectId: string) => Promise<EmitterScanResult> {
  return async () => ({
    scopes: {
      project: {
        defs: [
          {
            name: 'sig',
            scope: 'project',
            file: '/nonexistent-under-seam.ts',
            def: {
              type: 'internal',
              on: { signal },
              emits: { [eventName]: { payload: { slug: 'any' } } },
            },
          },
        ],
        declaredEvents: { [eventName]: { payload: { slug: 'any' } } },
        envRefs: [],
      },
    },
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('internal-signals (S8)', () => {
  it('routes a signal end-to-end: internal def → worker emit → event hook ctx.input', async () => {
    const root = await newRoot('s8-e2e-');
    await writeEvent(
      root,
      'p1',
      'lmthing-ish',
      `export default {
        type: 'internal',
        on: { signal: 'session.completed' },
        emits: { 'lmthing_ish': { payload: { projectId: 'string', ok: 'boolean' } } },
        emit(signal: { name: string; data: Record<string, unknown> }) {
          return [{ event: 'lmthing_ish', payload: { projectId: String(signal.data['projectId']), ok: signal.data['ok'] === true } }];
        },
      };`,
    );
    await writeHook(
      root,
      'p1',
      'on-ish',
      `export default {
        type: 'event',
        on: { event: 'project/lmthing_ish' },
        handler: (ctx: { input?: unknown }) => { (globalThis as any).__s8sink.push({ tag: 'on-ish', input: ctx.input }); },
      };`,
    );

    const runs: RunCall[] = [];
    installInternalSignalSink({ root, manager: makeManager(runs), listProjectIds: async () => ['p1'] });

    emitInternalSignal('session.completed', { projectId: 'p1', ok: true, agent: 'thing', sessionId: 'sX' });
    await flushInternalSignals();

    // ctx.input IS the emitted payload (uniform with the db-write path); the handler
    // already knows its event name from `on:{event}`.
    expect(globalThis.__s8sink).toEqual([
      { tag: 'on-ish', input: { projectId: 'p1', ok: true } },
    ]);
  }, 60_000);

  it('a throwing emitter def never propagates into the instrumented path', async () => {
    const root = await newRoot('s8-throw-');
    await writeEvent(
      root,
      'p1',
      'bad',
      `export default {
        type: 'internal',
        on: { signal: 'session.completed' },
        emits: { 'never_ev': { payload: {} } },
        emit() { throw new Error('boom'); },
      };`,
    );

    const runs: RunCall[] = [];
    installInternalSignalSink({ root, manager: makeManager(runs), listProjectIds: async () => ['p1'] });

    const rejections: unknown[] = [];
    const onRejection = (r: unknown): void => {
      rejections.push(r);
    };
    process.on('unhandledRejection', onRejection);
    try {
      // The instrumented path: a synchronous, non-throwing void call.
      expect(emitInternalSignal('session.completed', { projectId: 'p1', ok: false })).toBeUndefined();
      await flushInternalSignals();
      // Let any stray rejection surface before asserting.
      await new Promise<void>((r) => setImmediate(r));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(rejections).toEqual([]);
    expect(globalThis.__s8sink).toEqual([]);
    expect(runs).toEqual([]);
  }, 60_000);

  it('never throws when no sink is installed (early boot)', () => {
    expect(() => emitInternalSignal('session.started', { projectId: 'p1' })).not.toThrow();
  });

  it('suppresses the originating hook slug on hook.fired-derived events', async () => {
    const root = await newRoot('s8-loop-');
    const handlerSrc = (tag: string): string =>
      `export default {
        type: 'event',
        on: { event: 'project/hook_fired_ev' },
        handler: () => { (globalThis as any).__s8sink.push({ tag: '${tag}' }); },
      };`;
    await writeHook(root, 'p1', 'loopy', handlerSrc('loopy'));
    await writeHook(root, 'p1', 'other', handlerSrc('other'));

    const runs: RunCall[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['p1'],
      scan: cannedScan('hook.fired', 'hook_fired_ev'),
      invokeEmit: async (_file, signal) => [{ event: 'hook_fired_ev', payload: { slug: signal.data['slug'] } }],
    });

    // Depth CAP-1 so the surviving hook's own hook.fired (depth CAP) is dropped —
    // isolates the suppression assertion from further cascading.
    emitInternalSignal(
      'hook.fired',
      { projectId: 'p1', slug: 'loopy', hookType: 'event' },
      { originatingHookSlug: 'loopy', hookDepth: HOOK_DEPTH_CAP - 1 },
    );
    await flushInternalSignals();

    // 'loopy' (the origin) is suppressed; 'other' still fires.
    expect(globalThis.__s8sink).toEqual([{ tag: 'other' }]);
  });

  it('drops a signal at/beyond the shared depth cap', async () => {
    const root = await newRoot('s8-cap-');
    await writeHook(
      root,
      'p1',
      'any',
      `export default {
        type: 'event',
        on: { event: 'project/hook_fired_ev' },
        handler: () => { (globalThis as any).__s8sink.push({ tag: 'any' }); },
      };`,
    );

    const runs: RunCall[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['p1'],
      scan: cannedScan('hook.fired', 'hook_fired_ev'),
      invokeEmit: async () => [{ event: 'hook_fired_ev', payload: { slug: 'x' } }],
    });

    emitInternalSignal(
      'hook.fired',
      { projectId: 'p1', slug: 'someone', hookType: 'cron' },
      { originatingHookSlug: 'someone', hookDepth: HOOK_DEPTH_CAP },
    );
    await flushInternalSignals();

    expect(globalThis.__s8sink).toEqual([]);
  });

  it('a hook.fired cascade terminates at the depth cap (A→B ping-pong)', async () => {
    const root = await newRoot('s8-cascade-');
    const handlerSrc = (tag: string): string =>
      `export default {
        type: 'event',
        on: { event: 'project/hook_fired_ev' },
        handler: () => { (globalThis as any).__s8sink.push({ tag: '${tag}' }); },
      };`;
    await writeHook(root, 'p1', 'a', handlerSrc('a'));
    await writeHook(root, 'p1', 'b', handlerSrc('b'));

    const runs: RunCall[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['p1'],
      scan: cannedScan('hook.fired', 'hook_fired_ev'),
      invokeEmit: async (_file, signal) => [{ event: 'hook_fired_ev', payload: { slug: signal.data['slug'] } }],
    });

    // Depth 1 (as a real first hook fire stamps it): each fired hook re-signals
    // hook.fired at depth+1 via runHook, so the cascade MUST self-terminate at
    // HOOK_DEPTH_CAP rather than ping-pong between a and b forever.
    emitInternalSignal(
      'hook.fired',
      { projectId: 'p1', slug: 'a', hookType: 'event' },
      { originatingHookSlug: 'a', hookDepth: 1 },
    );
    await flushInternalSignals();

    // d1: 'a' suppressed → 'b' fires. b's own hook.fired rides at d2: 'b'
    // suppressed → 'a' fires. a's hook.fired rides at d3 = cap → dropped.
    expect(globalThis.__s8sink).toEqual([{ tag: 'b' }, { tag: 'a' }]);
  });

  it('fans a projectId-less signal out to every project', async () => {
    const root = await newRoot('s8-fanout-');
    const triggerHook = `export default {
      type: 'event',
      on: { event: 'project/installed_ev' },
      trigger: 'ops/notifier#notify',
    };`;
    await writeHook(root, 'pa', 'notify', triggerHook);
    await writeHook(root, 'pb', 'notify', triggerHook);

    const runs: RunCall[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['pa', 'pb'],
      scan: cannedScan('space.installed', 'installed_ev'),
      invokeEmit: async () => [{ event: 'installed_ev', payload: { slug: 's' } }],
    });

    emitInternalSignal('space.installed', {}); // no projectId ⇒ all projects
    await flushInternalSignals();

    const projectIds = runs.map((r) => r['projectId']).sort();
    expect(projectIds).toEqual(['pa', 'pb']);
  });

  // REGRESSION (scenario 04): `project.created` names the BRAND-NEW project in
  // `data.projectId`. Routing on that id delivers the signal to the one project
  // that cannot possibly subscribe (it was scaffolded a millisecond ago and has
  // no defs/hooks), so no `integration-lmthing` mirror ever saw a project being
  // created. `meta.fanOutAll` routes it to every project instead — while the def
  // still receives the new project's id as payload data.
  it('fans a fanOutAll signal (project.created) out to every project, not just its subject', async () => {
    const root = await newRoot('s8-created-');
    const triggerHook = `export default {
      type: 'event',
      on: { event: 'project/created_ev' },
      trigger: 'ops/notifier#notify',
    };`;
    await writeHook(root, 'pa', 'notify', triggerHook);
    await writeHook(root, 'pb', 'notify', triggerHook);

    const runs: RunCall[] = [];
    const seen: unknown[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['pa', 'pb'],
      scan: cannedScan('project.created', 'created_ev'),
      invokeEmit: async (_file, signal) => {
        seen.push(signal.data); // what the def's pure emit received (the SUBJECT project id)
        return [{ event: 'created_ev', payload: { slug: String(signal.data['projectId']) } }];
      },
    });

    // The subject project ('pnew') is NOT in the audience list — without
    // fanOutAll this routes to 'pnew' alone and fires nothing.
    emitInternalSignal('project.created', { projectId: 'pnew' }, { fanOutAll: true });
    await flushInternalSignals();

    expect(runs.map((r) => r['projectId']).sort()).toEqual(['pa', 'pb']);
    expect(seen).toEqual([{ projectId: 'pnew' }, { projectId: 'pnew' }]); // payload keeps the subject
  });

  it('still scopes a normal projectId-carrying signal to that one project', async () => {
    const root = await newRoot('s8-scoped-');
    const triggerHook = `export default {
      type: 'event',
      on: { event: 'project/installed_ev' },
      trigger: 'ops/notifier#notify',
    };`;
    await writeHook(root, 'pa', 'notify', triggerHook);
    await writeHook(root, 'pb', 'notify', triggerHook);

    const runs: RunCall[] = [];
    installInternalSignalSink({
      root,
      manager: makeManager(runs),
      listProjectIds: async () => ['pa', 'pb'],
      scan: cannedScan('space.installed', 'installed_ev'),
      invokeEmit: async () => [{ event: 'installed_ev', payload: { slug: 's' } }],
    });

    emitInternalSignal('space.installed', { projectId: 'pb' });
    await flushInternalSignals();

    expect(runs.map((r) => r['projectId'])).toEqual(['pb']);
  });
});
