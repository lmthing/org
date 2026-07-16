import { describe, it, expect } from 'vitest';
import { createSetActivityGlobal } from './set-activity.js';

/**
 * Unit coverage for setActivity() — the fire-and-forget "currently doing" status.
 * Unlike setSessionMeta (which pushes a yield and ends the turn), this global just
 * calls the host `onActivity` hook synchronously and returns void. It must NEVER
 * throw on a stray non-string (that would abort the streaming statement).
 */
describe('setActivity() global', () => {
  it('calls onActivity synchronously with the text and returns void (no yield, no promise)', () => {
    const calls: string[] = [];
    const setActivity = createSetActivityGlobal((t) => calls.push(t));
    const ret = setActivity('Searching for recipes…');
    expect(ret).toBeUndefined();
    expect(calls).toEqual(['Searching for recipes…']);
  });

  it('passes an empty string through (the clear signal)', () => {
    const calls: string[] = [];
    const setActivity = createSetActivityGlobal((t) => calls.push(t));
    setActivity('');
    expect(calls).toEqual(['']);
  });

  it('coerces a non-string / nullish arg instead of throwing', () => {
    const calls: string[] = [];
    const setActivity = createSetActivityGlobal((t) => calls.push(t));
    // The model surface is `string`, but a bridged host call must not throw on junk.
    setActivity(42 as unknown as string);
    setActivity(null as unknown as string);
    setActivity(undefined as unknown as string);
    expect(calls).toEqual(['42', '', '']);
  });
});
