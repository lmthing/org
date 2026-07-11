import { describe, it, expect } from 'vitest';
import { createIntegrationStatusGlobal, type IntegrationStatus } from './integration-status.js';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Unit coverage for integrationStatus()'s yield wiring. The global is a thin
 * pass-through: it pushes a single 'integrationStatus' yield carrying the spaceId
 * verbatim (the host-side integrationStatusResolver computes presence-only status
 * — names of missing required env vars, never their values).
 */
function makeIntegrationStatus(): {
  integrationStatus: (spaceId: string) => Promise<IntegrationStatus>;
  yields: YieldRequest[];
} {
  const yields: YieldRequest[] = [];
  const integrationStatus = createIntegrationStatusGlobal((req) => yields.push(req));
  return { integrationStatus, yields };
}

describe('integrationStatus() global', () => {
  it('pushes a single integrationStatus yield with the spaceId as its arg', () => {
    const { integrationStatus, yields } = makeIntegrationStatus();
    void integrationStatus('integration-demo');
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('integrationStatus');
    expect(yields[0]!.args).toEqual(['integration-demo']);
    expect(yields[0]!.vmPromiseHandle).toBeUndefined();
  });

  it('resolves with the presence-only status the host injects back', async () => {
    const { integrationStatus, yields } = makeIntegrationStatus();
    const p = integrationStatus('integration-demo');
    const status: IntegrationStatus = { ready: false, missingRequired: ['DEMO_TOKEN'] };
    yields[0]!.deferred.resolve(status);
    await expect(p).resolves.toEqual(status);
  });

  it('rejects when the host rejects the yield', async () => {
    const { integrationStatus, yields } = makeIntegrationStatus();
    const p = integrationStatus('integration-demo');
    yields[0]!.deferred.reject(new Error('no project scope configured'));
    await expect(p).rejects.toThrow('no project scope configured');
  });
});
