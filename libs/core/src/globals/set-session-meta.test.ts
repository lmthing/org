import { describe, it, expect } from 'vitest';
import { createSetSessionMetaGlobal } from './set-session-meta.js';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Unit coverage for setSessionMeta()'s yield wiring. The global is a thin
 * pass-through: it pushes a single 'setSessionMeta' yield carrying the input
 * object verbatim (host-side handleYield does the slugify/trim + trace emit).
 */
function makeSetSessionMeta(): {
  setSessionMeta: (m: { title?: string; slug?: string }) => Promise<{ ok: boolean }>;
  yields: YieldRequest[];
} {
  const yields: YieldRequest[] = [];
  const setSessionMeta = createSetSessionMetaGlobal((req) => yields.push(req));
  return { setSessionMeta, yields };
}

describe('setSessionMeta() global', () => {
  it('pushes a single setSessionMeta yield with the input object as args[0]', () => {
    const { setSessionMeta, yields } = makeSetSessionMeta();
    void setSessionMeta({ title: 'Pasta night', slug: 'Pasta Night!' });
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('setSessionMeta');
    expect(yields[0]!.args[0]).toEqual({ title: 'Pasta night', slug: 'Pasta Night!' });
  });

  it('resolves with the value the host injects back', async () => {
    const { setSessionMeta, yields } = makeSetSessionMeta();
    const p = setSessionMeta({ title: 'X' });
    yields[0]!.deferred.resolve({ ok: true });
    await expect(p).resolves.toEqual({ ok: true });
  });
});
