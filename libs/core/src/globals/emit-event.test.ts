/**
 * `emitEvent` (plan S10) — core-side contract: the host-derived (spoof-proof)
 * source scope, the yield shape, the router threading, and the `events:emit`
 * capability gating (bare cap + DTS fragment).
 */
import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';

import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import type { YieldRequest } from '../eval/yield.js';
import type { Space } from '../spaces/load.js';
import { buildAmbientDts } from '../exec/bootstrap.js';
import { sessionCapabilities } from '../exec/capability.js';
import { intersectAppCaps } from '../exec/capability.js';
import { parseCapabilities } from '../spaces/capabilities.js';
import { createEmitEventGlobal, deriveEventScope } from './emit-event.js';

const noopDeferred = { resolve: () => {}, reject: () => {} };
function req(kind: YieldRequest['kind'], args: unknown[]): YieldRequest {
  return { kind, args, deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
}

function baseCtx(over: Partial<YieldRouterContext> = {}): YieldRouterContext {
  return {
    space: {} as Space,
    runDelegate: async () => {
      throw new Error('runDelegate not expected');
    },
    ...over,
  };
}

describe('deriveEventScope — host-side, injection-time', () => {
  const root = `${sep}data${sep}proj`;

  it('a space dir under <projectRoot>/spaces/<id> emits as <id>', () => {
    expect(deriveEventScope(`${root}${sep}spaces${sep}integration-slack`, root)).toBe('integration-slack');
    expect(deriveEventScope(`${root}${sep}spaces${sep}x${sep}nested`, root)).toBe('x');
  });

  it('everything else emits as "project"', () => {
    expect(deriveEventScope(root, root)).toBe('project'); // the project agent itself
    expect(deriveEventScope(`${sep}system${sep}spaces${sep}user-thing`, root)).toBe('project');
    expect(deriveEventScope(`${root}${sep}spaces`, root)).toBe('project'); // the spaces dir itself
    expect(deriveEventScope(`${sep}anywhere`, undefined)).toBe('project'); // no project
  });
});

describe('emitEvent — yield shape + router threading', () => {
  it('bakes the host-derived scope into the yield args (sandbox passes only name+payload)', () => {
    const yields: YieldRequest[] = [];
    void createEmitEventGlobal((r) => yields.push(r), 'integration-slack')('message.posted', { text: 'hi' });
    expect(yields[0]!.kind).toBe('emitEvent');
    expect(yields[0]!.args).toEqual(['message.posted', { text: 'hi' }, 'integration-slack']);
  });

  it('routes through the resolver with (name, payload, sourceScope)', async () => {
    const calls: unknown[] = [];
    const r = await routeCommonYield(
      req('emitEvent', ['order.created', { id: '1' }, 'project']),
      baseCtx({
        emitEventResolver: async (name, payload, sourceScope) => {
          calls.push([name, payload, sourceScope]);
          return { ok: true, event: `${sourceScope}/${name}` };
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: { ok: true, event: 'project/order.created' } });
    expect(calls).toEqual([['order.created', { id: '1' }, 'project']]);
  });

  it('rejects with a clear error when no resolver is configured', async () => {
    await expect(routeCommonYield(req('emitEvent', ['x', {}, 'project']), baseCtx())).rejects.toThrow(
      /emitEvent is not available here/,
    );
  });
});

describe('capability gating — events:emit', () => {
  it('parses as a bare capability (config rejected)', () => {
    expect(parseCapabilities(['events:emit'], { agentId: 'a' })['events:emit']).toBe(true);
    expect(() => parseCapabilities([{ 'events:emit': {} }], { agentId: 'a' })).toThrow(/bare only/);
  });

  it('DTS declares emitEvent ONLY under the grant', () => {
    const granted = buildAmbientDts({ capabilities: sessionCapabilities(true, { 'events:emit': true }) });
    expect(granted).toContain('declare function emitEvent');
    const none = buildAmbientDts({ capabilities: sessionCapabilities(true, {}) });
    expect(none).not.toContain('emitEvent');
  });

  it('read-only fork roles drop events:emit/store:install but keep store:read', () => {
    const out = intersectAppCaps({ 'events:emit': true, 'store:install': true, 'store:read': true }, false);
    expect(out).toEqual({ 'store:read': true });
  });
});
