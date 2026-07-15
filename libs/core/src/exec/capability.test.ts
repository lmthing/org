import { describe, it, expect } from 'vitest';
import { narrowAppCaps, intersectAppCaps } from './capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

describe('narrowAppCaps — per-node capability narrowing (SELECT ∩ DECLARED, never widen)', () => {
  const agent: AppCapabilities = {
    'db:read': { tables: ['legs'] },
    'db:write': {},
    'knowledge:write': {},
  };

  it('returns the full set unchanged when allow is undefined (node inherits the agent)', () => {
    expect(narrowAppCaps(agent, undefined)).toBe(agent);
  });

  it('keeps only the selected subset, preserving each cap scope by reference', () => {
    const narrowed = narrowAppCaps(agent, ['db:read']);
    expect(narrowed).toEqual({ 'db:read': { tables: ['legs'] } });
    expect(narrowed['db:read']).toBe(agent['db:read']); // scope object preserved
  });

  it('drops a selected cap the agent never declared (cannot widen)', () => {
    const narrowed = narrowAppCaps(agent, ['db:read', 'pages:write']);
    expect(narrowed).toEqual({ 'db:read': { tables: ['legs'] } });
    expect(narrowed['pages:write']).toBeUndefined();
  });

  it('an empty allow list yields an empty set (a node that opted into nothing)', () => {
    expect(narrowAppCaps(agent, [])).toEqual({});
  });

  it('composes with the read-only role intersection (narrow first, then intersect)', () => {
    // A node that selected db:write but runs read-only loses it at intersectAppCaps.
    const nodeApp = narrowAppCaps(agent, ['db:write', 'db:read']);
    expect(intersectAppCaps(nodeApp, false)).toEqual({ 'db:read': { tables: ['legs'] } });
  });
});
