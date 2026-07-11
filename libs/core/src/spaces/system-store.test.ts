/**
 * Smoke test for the plan-S11 `system-store` system space — it loads, ships the
 * single `finder` agent, and that agent's `store:read` capability parses. The
 * finder owns store-catalog discovery (`storeSearch`/`storeInspect`) and returns
 * a fit-validated recommendation; THING installs.
 */

import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { loadSpace } from './load.js';
import { defaultSystemSpaceDirs, SYSTEM_SPACE_NAMES } from './system.js';

function systemStoreDir(): string {
  const dir = defaultSystemSpaceDirs().find((d) => d.endsWith(join('system-spaces', 'system-store')));
  if (!dir) throw new Error('system-store not in defaultSystemSpaceDirs()');
  return dir;
}

describe('system-store space', () => {
  it('is a registered system space', () => {
    expect(SYSTEM_SPACE_NAMES).toContain('system-store');
  });

  it('loads and exposes the finder agent with the store:read capability', async () => {
    const space = await loadSpace(systemStoreDir(), { requireAgents: false });
    const finder = space.agents['finder'];
    expect(finder).toBeDefined();
    // The finder discovers/inspects the catalog — store:read only, and NO store:install
    // (it recommends; THING installs behind the consent card).
    expect(finder!.capabilities?.['store:read']).toBe(true);
    expect(finder!.capabilities?.['store:install']).toBeUndefined();
    // It has a real instruct body (not an empty placeholder that would be shadowed).
    expect(finder!.instructBody?.trim().length).toBeGreaterThan(0);
  });
});
