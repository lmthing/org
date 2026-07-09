import { describe, it, expect } from 'vitest';
import { createToolGlobal } from './tool.js';
import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { sessionCapabilities } from '../exec/capability.js';
import { parseCapabilities } from '../spaces/capabilities.js';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Unit coverage for tool()'s yield wiring — mirrors set-session-meta.test.ts /
 * yield-router.test.ts's apiCall coverage.
 */
function makeTool(): { tool: (name: string, input?: unknown) => Promise<unknown>; yields: YieldRequest[] } {
  const yields: YieldRequest[] = [];
  const tool = createToolGlobal((req) => yields.push(req));
  return { tool, yields };
}

describe('tool() global', () => {
  it('pushes a single tool yield with [name, input] as args', () => {
    const { tool, yields } = makeTool();
    void tool('webSearch', { q: 'lmthing' });
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('tool');
    expect(yields[0]!.args).toEqual(['webSearch', { q: 'lmthing' }]);
  });

  it('resolves with the value the host injects back', async () => {
    const { tool, yields } = makeTool();
    const p = tool('webSearch', {});
    yields[0]!.deferred.resolve({ content: [{ type: 'text', text: 'ok' }] });
    await expect(p).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('rejects when the host rejects', async () => {
    const { tool, yields } = makeTool();
    const p = tool('webSearch', {});
    yields[0]!.deferred.reject(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
  });
});

describe('tool() capability gating — injection + DTS', () => {
  const dtsFor = (allow: string[]): string =>
    buildAmbientDts({ capabilities: { ...sessionCapabilities(true, { 'tools:use': { allow } }) } });

  it('a granted tools:use emits the narrowed tool() DTS overload', () => {
    const dts = dtsFor(['webSearch', 'markRead']);
    expect(dts).toContain("declare function tool(name: 'webSearch' | 'markRead', input?: any): Promise<any>;");
  });

  it('an ungranted agent has no tool() in its DTS', () => {
    const dts = buildAmbientDts({ capabilities: { ...sessionCapabilities(true, {}) } });
    expect(dts).not.toContain('declare function tool(');
  });
});

describe('tool() yield-router dispatch', () => {
  const noopDeferred = { resolve: () => {}, reject: () => {} };
  function req(args: unknown[]): YieldRequest {
    return { kind: 'tool', args, deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
  }
  function baseCtx(over: Partial<YieldRouterContext> = {}): YieldRouterContext {
    return {
      runDelegate: async () => {
        throw new Error('runDelegate not expected');
      },
      ...over,
    };
  }

  it('dispatches to a fake toolResolver and resolves the value', async () => {
    const calls: unknown[] = [];
    const r = await routeCommonYield(
      req(['webSearch', { q: 'x' }]),
      baseCtx({
        toolResolver: async (name, input) => {
          calls.push([name, input]);
          return { content: [{ type: 'text', text: 'result' }] };
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: { content: [{ type: 'text', text: 'result' }] } });
    expect(calls).toEqual([['webSearch', { q: 'x' }]]);
  });

  it('throws a clear, retryable error when no toolResolver is configured', async () => {
    await expect(routeCommonYield(req(['webSearch', {}]), baseCtx())).rejects.toThrow(
      /tool\(\) is not available here: no tool registry configured/,
    );
  });
});

describe('parseCapabilities — tools:use', () => {
  const ctx = () => ({ agentId: 'curator' });

  it('parses tools:use { allow: [...] } into AppCapabilities', () => {
    const parsed = parseCapabilities([{ 'tools:use': { allow: ['webSearch'] } }], ctx());
    expect(parsed).toEqual({ 'tools:use': { allow: ['webSearch'] } });
  });

  it('throws on a bare tools:use (allow is required — no using anything)', () => {
    expect(() => parseCapabilities(['tools:use'], ctx())).toThrow(
      /"tools:use" requires a config with an "allow" list/,
    );
  });

  it('throws on tools:use with an empty allow list', () => {
    expect(() => parseCapabilities([{ 'tools:use': { allow: [] } }], ctx())).toThrow(
      /requires a non-empty "allow" list/,
    );
  });

  it('throws on tools:use with an unknown config key', () => {
    expect(() => parseCapabilities([{ 'tools:use': { tools: ['x'] } }], ctx())).toThrow(
      /disallowed config key\(s\): tools/,
    );
  });
});
