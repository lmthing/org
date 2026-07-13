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

  it('routes apiCall through the apiCallResolver with (name, input)', async () => {
    const calls: unknown[] = [];
    const r = await routeCommonYield(
      req('apiCall', ['markRead', { id: 'a1' }]),
      baseCtx({
        apiCallResolver: async (name, input) => {
          calls.push([name, input]);
          return { ok: true };
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: { ok: true } });
    expect(calls).toEqual([['markRead', { id: 'a1' }]]);
  });

  it('apiCall without a resolver throws (no project api runtime) — surfaced retryably', async () => {
    await expect(routeCommonYield(req('apiCall', ['markRead', {}]), baseCtx())).rejects.toThrow(
      /apiCall is not available/,
    );
  });

  // The `api:call: { allow: [...] }` grant is the security claim ("there is no calling
  // anything"). It was parsed and validated at space load — and then never checked at the
  // call site, so ANY holder could enter ANY endpoint. These pin the gate shut.
  it('apiCall REFUSES an endpoint outside the agent\'s allowlist (and names what IS allowed)', async () => {
    let entered = false;
    await expect(
      routeCommonYield(
        req('apiCall', ['deleteEverything', {}]),
        baseCtx({
          apiCallAllow: ['markRead', 'tripSummary'],
          apiCallResolver: async () => {
            entered = true;
            return { ok: true };
          },
        }),
      ),
    ).rejects.toThrow(/not permitted.*markRead, tripSummary/s);
    expect(entered, 'the resolver must never run for a refused endpoint').toBe(false);
  });

  it('apiCall ALLOWS an endpoint on the allowlist', async () => {
    const r = await routeCommonYield(
      req('apiCall', ['tripSummary', {}]),
      baseCtx({
        apiCallAllow: ['markRead', 'tripSummary'],
        apiCallResolver: async () => ({ total: 42 }),
      }),
    );
    expect(r).toEqual({ handled: true, value: { total: 42 } });
  });

  it('apiCall with the ["*"] wildcard allows any endpoint the project declares', async () => {
    const r = await routeCommonYield(
      req('apiCall', ['somethingAuthoredAtRuntime', {}]),
      baseCtx({ apiCallAllow: ['*'], apiCallResolver: async () => ({ ok: true }) }),
    );
    expect(r).toEqual({ handled: true, value: { ok: true } });
  });

  it('routes callConnection through the connectionResolver with (provider, request)', async () => {
    const calls: unknown[] = [];
    const request = { method: 'GET', path: '/gmail/v1/users/me/messages' };
    const r = await routeCommonYield(
      req('callConnection', ['google', request]),
      baseCtx({
        connectionResolver: async (provider, reqArg) => {
          calls.push([provider, reqArg]);
          return { ok: true, status: 200, data: { messages: [] } };
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: { ok: true, status: 200, data: { messages: [] } } });
    expect(calls).toEqual([['google', request]]);
  });

  it('callConnection without a resolver throws (no connections gateway) — surfaced retryably', async () => {
    await expect(
      routeCommonYield(req('callConnection', ['google', { method: 'GET', path: '/x' }]), baseCtx()),
    ).rejects.toThrow(/callConnection is not available/);
  });

  it('routes readDocument through the documentResolver with (attachmentId, opts)', async () => {
    const calls: unknown[] = [];
    const result = { ok: true, attachmentId: 'a1', mediaType: 'text/plain', kind: 'text' as const, text: 'hello' };
    const r = await routeCommonYield(
      req('readDocument', ['a1', { maxChars: 50 }]),
      baseCtx({
        documentResolver: async (id, opts) => {
          calls.push([id, opts]);
          return result;
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: result });
    expect(calls).toEqual([['a1', { maxChars: 50 }]]);
  });

  it('readDocument without a resolver throws (no document resolver) — surfaced retryably', async () => {
    await expect(
      routeCommonYield(req('readDocument', ['a1', undefined]), baseCtx()),
    ).rejects.toThrow(/readDocument is not available/);
  });
});
