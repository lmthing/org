import { describe, it, expect, afterEach } from 'vitest';
import { createHostCdpGlobals } from './host-cdp.js';
import { CONSENT_MARKED_YIELD_KINDS } from './consent.js';
import { parseCapabilities } from '../spaces/capabilities.js';
import { sessionCapabilities, forkCapabilities, intersectAppCaps } from '../exec/capability.js';
import { routeCommonYield } from '../eval/yield-router.js';
import type { YieldRequest } from '../eval/yield.js';

const CTX = { agentId: 'devtools' };

afterEach(() => {
  delete process.env['LMTHING_TEAM_MODE'];
});

function req(kind: YieldRequest['kind'], args: unknown[]): YieldRequest {
  return { kind, args, deferred: { resolve: () => {}, reject: () => {} }, vmPromiseHandle: undefined };
}

describe('the cdp globals', () => {
  it('yield rather than calling out directly', () => {
    const seen: YieldRequest[] = [];
    const g = createHostCdpGlobals((r) => seen.push(r));
    void g.cdp('Page.navigate', { url: 'https://example.test' });
    void g.cdpSubscribe('Network');
    void g.cdpEvents();
    expect(seen.map((r) => r.kind)).toEqual(['hostCdp', 'hostCdp', 'hostCdp']);
    expect(seen[0]!.args).toEqual(['command', 'Page.navigate', { url: 'https://example.test' }]);
    expect(seen[1]!.args).toEqual(['subscribe', 'Network']);
    expect(seen[2]!.args).toEqual(['events']);
  });
});

describe('browser:cdp gating', () => {
  it('is consent-marked, which is what puts a person in the loop per call', () => {
    // A capability is a build-time decision. This is script execution inside a browser signed into
    // somebody's accounts, so it also needs a human at the moment it happens.
    expect(CONSENT_MARKED_YIELD_KINDS.has('hostCdp')).toBe(true);
  });

  it('FAILS CLOSED where there is no prompter — every headless, fork, delegate and hook context', async () => {
    // The property that matters most. A context with no way to ask must refuse, not proceed: the
    // alternative is arbitrary code running in the person's session with nobody consulted.
    let resolverRan = false;
    await expect(
      routeCommonYield(req('hostCdp', ['command', 'Runtime.evaluate', { expression: '1' }]), {
        runDelegate: async () => undefined,
        hostCdpResolver: async () => {
          resolverRan = true;
          return { ok: true };
        },
      } as never),
    ).rejects.toThrow();
    expect(resolverRan).toBe(false);
  });

  it('runs the resolver once consent is given', async () => {
    const out = await routeCommonYield(req('hostCdp', ['command', 'Page.navigate', { url: 'x' }]), {
      runDelegate: async () => undefined,
      requestConsent: async () => true,
      hostCdpResolver: async (op: string, args: unknown[]) => ({ ok: true, result: { op, args } }),
    } as never);
    expect(out).toMatchObject({ handled: true });
  });

  it('a denied consent does not reach the browser', async () => {
    let resolverRan = false;
    await expect(
      routeCommonYield(req('hostCdp', ['command', 'Runtime.evaluate', {}]), {
        runDelegate: async () => undefined,
        requestConsent: async () => false,
        hostCdpResolver: async () => {
          resolverRan = true;
          return { ok: true };
        },
      } as never),
    ).rejects.toThrow();
    expect(resolverRan).toBe(false);
  });

  it('is dropped on a team pod', () => {
    process.env['LMTHING_TEAM_MODE'] = '1';
    expect(parseCapabilities(['browser:cdp'], CTX)['browser:cdp']).toBeUndefined();
  });

  it('is NOT kept for a read-only fork, unlike fs:local:read', () => {
    // There is no read-only subset of a protocol whose first verb is "run this code". An
    // explore/plan fork reading local files is reasonable; the same fork evaluating script in
    // somebody's logged-in browser is not.
    const app = parseCapabilities(['browser:cdp', 'fs:local:read'], CTX);
    const readOnly = intersectAppCaps(app, false);
    expect(readOnly['fs:local:read']).toBe(true);
    expect(readOnly['browser:cdp']).toBeUndefined();
    expect(forkCapabilities('explore', true, app).browserCdp).toBe(false);
  });

  it('drives injection and the DTS from one profile', () => {
    expect(sessionCapabilities(true, parseCapabilities(['browser:cdp'], CTX)).browserCdp).toBe(true);
    expect(sessionCapabilities(true, parseCapabilities([], CTX)).browserCdp).toBe(false);
  });
});
