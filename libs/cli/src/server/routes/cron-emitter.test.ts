/**
 * Cron-EMITTER tests ({@link ./hooks.ts} S6 additions) — the producer twin of
 * cron hooks. A `{type:'cron'}` emitter def in a project/space `events/` dir polls
 * on its schedule; on fire it runs `emit(ctx)` worker-isolated with a gated ctx
 * (`state` KV + own-provider/declared-locked `callConnection`), validates the
 * output, and dispatches to subscribing event hooks.
 *
 * These run the REAL worker (invokeDefaultFnInWorker) against real `events/*.ts`
 * fixtures — only `dispatch`, `connectionResolver`, and `installedProviders` are
 * injected — so the gate, the state store, and the schedule regen are exercised
 * end-to-end:
 *   - `buildCrontabLines` includes an `@emitter:` line for a cron def;
 *   - a due cron def fires and its validated events dispatch;
 *   - a PROJECT def's `callConnection` is gated by declared ∩ installed providers;
 *   - a SPACE def's `callConnection` is locked to the space's OWN provider(s)
 *     (a declared-but-not-owned/foreign provider throws);
 *   - `ctx.state` persists across two ticks;
 *   - an oversized `ctx.state.set` is rejected.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCrontabLines,
  runDueCronEmitters,
  type CronEmitterDeps,
} from './hooks.js';
import { clearEmitterDefCache } from '../emitter-manifests.js';
import type { EventDispatchManager } from '../event-dispatch.js';

let root: string;
const PROJECT = 'proj';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cron-emitter-'));
  clearEmitterDefCache();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  clearEmitterDefCache();
});

/** Write a `.ts` file under `<root>/<PROJECT>/<rel>` (creating parent dirs). */
function write(rel: string, source: string): void {
  const path = join(root, PROJECT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, source, 'utf8');
}

/** A stand-in manager — dispatch is always injected as a spy, so it's unused. */
const dummyManager = {} as unknown as EventDispatchManager;

/** A cron emitter that increments a persisted counter and probes `callConnection`. */
const PROJECT_POLLER = `export default {
  type: 'cron', every: '30m', connections: ['tavily'],
  emits: { 'tick.happened': { payload: { n: 'number', called: 'boolean' } } },
  async emit(ctx) {
    const prev = (await ctx.state.get('n')) ?? 0;
    const n = prev + 1;
    await ctx.state.set('n', n);
    let called = false;
    try { await ctx.callConnection('tavily', { path: '/x' }); called = true; } catch { called = false; }
    return [{ event: 'tick.happened', payload: { n, called } }];
  },
}`;

/** A collected dispatch call + a deps bag wiring the spies. */
function makeDeps(over: Partial<CronEmitterDeps> = {}): {
  deps: CronEmitterDeps;
  dispatched: Array<{ sourceScope: string; emitted: unknown[] }>;
} {
  const dispatched: Array<{ sourceScope: string; emitted: unknown[] }> = [];
  const deps: CronEmitterDeps = {
    dispatch: async (args) => {
      dispatched.push({ sourceScope: args.sourceScope, emitted: args.emitted });
    },
    connectionResolver: () => (provider) => Promise.resolve({ ok: true, provider } as never),
    installedProviders: () => new Set(['tavily']),
    ...over,
  };
  return { deps, dispatched };
}

describe('buildCrontabLines — includes cron emitter defs', () => {
  it('renders an `@emitter:<scope>:<name>` curl line for a cron def', async () => {
    write('events/poller.ts', PROJECT_POLLER);
    const lines = await buildCrontabLines(root, [PROJECT], 8787);
    const emitterLine = lines.find((l) => l.includes('@emitter:project:poller'));
    expect(emitterLine).toBeDefined();
    // 30m schedule + the run endpoint for the pseudo-slug.
    expect(emitterLine).toMatch(/^\*\/30 \* \* \* \* /);
    expect(emitterLine).toContain(`/api/projects/${PROJECT}/hooks/@emitter:project:poller/run`);
  });
});

describe('runDueCronEmitters — a due cron def fires', () => {
  it('runs emit() and dispatches the validated events', async () => {
    write('events/poller.ts', PROJECT_POLLER);
    const { deps, dispatched } = makeDeps();
    await runDueCronEmitters(dummyManager, root, [PROJECT], Date.now(), deps);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].sourceScope).toBe('project');
    expect(dispatched[0].emitted).toEqual([{ event: 'tick.happened', payload: { n: 1, called: true } }]);
  });

  it('a project def is gated by declared ∩ INSTALLED providers (uninstalled → blocked)', async () => {
    write('events/poller.ts', PROJECT_POLLER);
    const { deps, dispatched } = makeDeps({ installedProviders: () => new Set() }); // tavily NOT installed
    await runDueCronEmitters(dummyManager, root, [PROJECT], Date.now(), deps);

    expect(dispatched[0].emitted).toEqual([{ event: 'tick.happened', payload: { n: 1, called: false } }]);
  });

  it('persists ctx.state across two ticks', async () => {
    write('events/poller.ts', PROJECT_POLLER);
    const { deps, dispatched } = makeDeps();

    const t0 = Date.now();
    await runDueCronEmitters(dummyManager, root, [PROJECT], t0, deps);
    // Advance past the 30m window so the second run is due again.
    await runDueCronEmitters(dummyManager, root, [PROJECT], t0 + 31 * 60_000, deps);

    expect(dispatched).toHaveLength(2);
    expect((dispatched[0].emitted[0] as { payload: { n: number } }).payload.n).toBe(1);
    expect((dispatched[1].emitted[0] as { payload: { n: number } }).payload.n).toBe(2);
  });

  it('rejects an oversized ctx.state.set', async () => {
    write(
      'events/bloat.ts',
      `export default {
        type: 'cron', every: '30m',
        emits: { 'stated': { payload: { rejected: 'boolean' } } },
        async emit(ctx) {
          let rejected = false;
          try { await ctx.state.set('big', 'x'.repeat(300 * 1024)); } catch { rejected = true; }
          return [{ event: 'stated', payload: { rejected } }];
        },
      }`,
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, dispatched } = makeDeps();
    await runDueCronEmitters(dummyManager, root, [PROJECT], Date.now(), deps);
    warn.mockRestore();

    expect(dispatched[0].emitted).toEqual([{ event: 'stated', payload: { rejected: true } }]);
  });
});

describe('runDueCronEmitters — SPACE def own-provider lock', () => {
  it('allows the space OWN provider and blocks a declared-but-foreign one', async () => {
    // Space owns `foo`; the def declares both `foo` (owned) and `bar` (foreign).
    write(
      'spaces/integration-foo/package.json',
      JSON.stringify({ name: 'integration-foo', lmthing: { connection: { provider: 'foo' } } }),
    );
    write(
      'spaces/integration-foo/events/poller.ts',
      `export default {
        type: 'cron', every: '1h', connections: ['foo', 'bar'],
        emits: { 'polled': { payload: { own: 'boolean', foreign: 'boolean' } } },
        async emit(ctx) {
          let own = false, foreign = false;
          try { await ctx.callConnection('foo', {}); own = true; } catch { own = false; }
          try { await ctx.callConnection('bar', {}); foreign = true; } catch { foreign = false; }
          return [{ event: 'polled', payload: { own, foreign } }];
        },
      }`,
    );
    // Resolver would answer ANY provider — so a `false` proves the gate blocked it,
    // not the resolver. `installedProviders` is irrelevant for a space scope.
    const { deps, dispatched } = makeDeps({ installedProviders: () => new Set(['foo', 'bar']) });
    await runDueCronEmitters(dummyManager, root, [PROJECT], Date.now(), deps);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].sourceScope).toBe('integration-foo');
    expect(dispatched[0].emitted).toEqual([{ event: 'polled', payload: { own: true, foreign: false } }]);
  });
});
