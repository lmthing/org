import { describe, it, expect } from 'vitest';
import { createSetSessionMetaGlobal, type SessionMetaInput } from './set-session-meta.js';

/**
 * setSessionMeta() is FIRE-AND-FORGET (like setActivity/display): it calls the host
 * `onSessionMeta` hook synchronously and returns `{ ok }` — it never pushes a yield,
 * so naming the conversation does NOT end the turn.
 */
describe('setSessionMeta() global', () => {
  it('calls onSessionMeta synchronously with the input and returns { ok } from the hook', () => {
    const calls: SessionMetaInput[] = [];
    const setSessionMeta = createSetSessionMetaGlobal((m) => { calls.push(m); return true; });
    const r = setSessionMeta({ title: 'Pasta night', slug: 'Pasta Night!' });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual([{ title: 'Pasta night', slug: 'Pasta Night!' }]);
  });

  it('reports { ok: false } when the host hook sets nothing', () => {
    const setSessionMeta = createSetSessionMetaGlobal(() => false);
    expect(setSessionMeta({})).toEqual({ ok: false });
  });

  it('coerces a nullish arg to {} instead of throwing (bridged host call must not throw)', () => {
    const calls: SessionMetaInput[] = [];
    const setSessionMeta = createSetSessionMetaGlobal((m) => { calls.push(m); return false; });
    setSessionMeta(undefined as unknown as SessionMetaInput);
    expect(calls).toEqual([{}]);
  });
});
