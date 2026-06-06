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

  describe('solve', () => {
    it('routes solve through the engine, escalating until the verify command passes', async () => {
      const instructions: string[] = [];
      const fakeEngine = {
        fork: async (task: { instruction: string }) => {
          instructions.push(task.instruction);
          return { attempt: instructions.length };
        },
      };
      let calls = 0;
      const execCommand = () => {
        calls++;
        return calls < 2 ? { ok: false, output: 'tsc: error TS1' } : { ok: true, output: '' };
      };
      const r = await routeCommonYield(
        req('solve', [{ instruction: 'implement add()', output: { done: 'boolean' }, verifyCommand: 'tsc' }]),
        baseCtx({ getForkEngine: () => fakeEngine as never, execCommand }),
      );
      expect(r.handled).toBe(true);
      const value = (r as { value: { verified: boolean; rung: number; attempts: number } }).value;
      expect(value.verified).toBe(true);
      expect(value.rung).toBe(1); // passed on the retry rung
      expect(value.attempts).toBe(2);
      // The retry instruction carries the checker feedback.
      expect(instructions[1]).toContain('tsc: error TS1');
    });

    it('runs a single attempt when no verify spec is given', async () => {
      let forks = 0;
      const fakeEngine = { fork: async () => { forks++; return { x: 1 }; } };
      const r = await routeCommonYield(
        req('solve', [{ instruction: 'just do it once' }]),
        baseCtx({ getForkEngine: () => fakeEngine as never }),
      );
      const value = (r as { value: { attempts: number; verified: boolean } }).value;
      expect(value.attempts).toBe(1);
      expect(value.verified).toBe(false);
      expect(forks).toBe(1);
    });

    it('reports an unavailable verifyCommand cleanly when no execCommand is wired (e.g. delegate scope)', async () => {
      const fakeEngine = { fork: async () => ({ x: 1 }) };
      const r = await routeCommonYield(
        req('solve', [{ instruction: 'x', verifyCommand: 'tsc', maxAttempts: 1 }]),
        baseCtx({ getForkEngine: () => fakeEngine as never }), // no execCommand
      );
      const value = (r as { value: { verified: boolean } }).value;
      expect(value.verified).toBe(false); // command can't run → never verifies, but no crash
    });
  });
});
