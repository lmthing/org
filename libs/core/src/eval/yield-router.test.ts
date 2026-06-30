import { describe, it, expect } from 'vitest';
import { routeCommonYield, type YieldRouterContext } from './yield-router.js';
import type { YieldRequest } from './yield.js';
import type { Space } from '../spaces/load.js';

const noopDeferred = { resolve: () => {}, reject: () => {} };
function req(kind: YieldRequest['kind'], args: unknown[]): YieldRequest {
  return { kind, args, deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
}

// Minimal context; individual tests override the parts they exercise.
function baseCtx(over: Partial<YieldRouterContext> = {}): YieldRouterContext {
  return {
    space: {} as Space,
    getForkEngine: () => {
      throw new Error('getForkEngine not expected');
    },
    runDelegate: async () => {
      throw new Error('runDelegate not expected');
    },
    ...over,
  };
}

describe('routeCommonYield', () => {
  it('returns { handled: false } for kinds it does not own (ask/inspect/etc.)', async () => {
    const r = await routeCommonYield(req('ask', ['id', {}]), baseCtx());
    expect(r.handled).toBe(false);
  });

  it('resolves sleep via the injected clock', async () => {
    let scheduledMs = -1;
    const clock = {
      setTimeout: (fn: () => void, ms: number) => {
        scheduledMs = ms;
        fn(); // fire synchronously for the test
      },
      clearTimeout: () => {},
    };
    const r = await routeCommonYield(req('sleep', ['2s', 2000]), baseCtx({ clock }));
    expect(r.handled).toBe(true);
    expect(scheduledMs).toBe(2000);
  });

  it('routes fork to the shared engine', async () => {
    let forked: unknown;
    const fakeEngine = {
      fork: async (task: unknown) => {
        forked = task;
        return { result: 'ok' };
      },
    };
    const r = await routeCommonYield(
      req('fork', [{ instruction: 'do it', output: {} }]),
      baseCtx({ getForkEngine: () => fakeEngine as never }),
    );
    expect(r).toEqual({ handled: true, value: { result: 'ok' } });
    expect(forked).toEqual({ instruction: 'do it', output: {} });
  });

  it('routes delegate through the runDelegate callback with the right args', async () => {
    const calls: unknown[] = [];
    const r = await routeCommonYield(
      req('delegate', ['pkg', 'agentA', 'analyze', { query: 'q' }]),
      baseCtx({
        runDelegate: async (pkg, agent, action, opts) => {
          calls.push([pkg, agent, action, opts]);
          return 'delegated-result';
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: 'delegated-result' });
    expect(calls).toEqual([['pkg', 'agentA', 'analyze', { query: 'q' }]]);
  });
});
