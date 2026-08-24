import { describe, it, expect } from 'vitest';
import { intersectAppCaps } from './capability.js';
import { CAPABILITY_DTS_FRAGMENTS } from '../typecheck/library-dts.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * `self:author` is a WRITE capability: it earns the self-authoring DTS only when granted, and it is
 * dropped for read-only fork roles like every other authoring grant.
 */
describe('self:author gating', () => {
  it('emits the self-authoring writers in its DTS fragment', () => {
    const dts = CAPABILITY_DTS_FRAGMENTS['self:author'];
    expect(dts).toBeTruthy();
    expect(dts).toContain('appendSelfInstruct');
    expect(dts).toContain('writeSelfKnowledge');
    expect(dts).toContain('readSelf');
  });

  it('is dropped for a read-only fork role, kept for a writing role', () => {
    const app: AppCapabilities = { 'self:author': true, 'db:read': {} };
    expect(intersectAppCaps(app, false)['self:author']).toBeUndefined(); // read-only fork
    expect(intersectAppCaps(app, false)['db:read']).toBeDefined(); // reads survive
    expect(intersectAppCaps(app, true)['self:author']).toBe(true); // writing session/delegate
  });
});
