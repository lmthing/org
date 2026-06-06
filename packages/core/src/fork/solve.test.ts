import { describe, it, expect } from 'vitest';
import { solve, type SolveTask, type VerifyResult } from './solve.js';

/**
 * A scripted fork stub: returns the i-th value from `outputs` on each call,
 * repeating the last once exhausted. Records every task it received so tests
 * can assert attempt count and feedback injection.
 */
function scriptedFork<T>(outputs: T[]): { fn: (task: SolveTask) => Promise<T>; calls: SolveTask[] } {
  const calls: SolveTask[] = [];
  const fn = async (task: SolveTask): Promise<T> => {
    calls.push(task);
    const idx = Math.min(calls.length - 1, outputs.length - 1);
    return outputs[idx]!;
  };
  return { fn, calls };
}

const accept = (): VerifyResult => ({ ok: true });
const reject = (feedback?: string): VerifyResult => ({ ok: false, feedback });

describe('solve — verifier-gated escalation', () => {
  it('runs exactly one attempt and does not escalate when no verify is given', async () => {
    const { fn, calls } = scriptedFork(['only']);
    const res = await solve<string>(fn, { task: { instruction: 'do it' } });
    expect(res).toEqual({ value: 'only', rung: 0, attempts: 1, verified: false });
    expect(calls).toHaveLength(1);
  });

  it('returns rung 0 with no extra forks when verify passes on the first try', async () => {
    const { fn, calls } = scriptedFork(['good', 'should-not-be-used']);
    const res = await solve<string>(fn, { task: { instruction: 'x' }, verify: accept });
    expect(res).toMatchObject({ value: 'good', rung: 0, attempts: 1, verified: true });
    expect(calls).toHaveLength(1);
  });

  it('climbs to the retry rung and succeeds (rung 1)', async () => {
    const { fn, calls } = scriptedFork(['bad', 'fixed']);
    let n = 0;
    const verify = () => (n++ === 0 ? reject('try harder') : accept());
    const res = await solve<string>(fn, { task: { instruction: 'x' }, verify });
    expect(res).toMatchObject({ value: 'fixed', rung: 1, attempts: 2, verified: true });
    expect(calls).toHaveLength(2);
  });

  it('injects verifier feedback into the retry instruction', async () => {
    const { fn, calls } = scriptedFork(['bad', 'fixed']);
    let n = 0;
    const verify = () => (n++ === 0 ? reject('missing the edge case') : accept());
    await solve<string>(fn, { task: { instruction: 'base task' }, verify });
    expect(calls[0]!.instruction).toBe('base task');
    expect(calls[1]!.instruction).toContain('base task');
    expect(calls[1]!.instruction).toContain('missing the edge case');
    expect(calls[1]!.instruction).toContain('did NOT pass verification');
  });

  it('escalates to race when retry still fails, returning the first passing candidate', async () => {
    // initial(bad) → retry(bad) → race3: [bad, ok, bad] → winner is the 2nd
    const { fn, calls } = scriptedFork(['bad0', 'bad1', 'r0', 'r1-good', 'r2']);
    const verify = (v: string): VerifyResult => (v === 'r1-good' ? accept() : reject('nope'));
    const res = await solve<string>(fn, { task: { instruction: 'x' }, verify });
    expect(res.verified).toBe(true);
    expect(res.value).toBe('r1-good');
    expect(res.rung).toBe(2); // race is the 2nd ladder rung
    // 1 initial + 1 retry + 3 race = 5 attempts
    expect(res.attempts).toBe(5);
    expect(calls).toHaveLength(5);
  });

  it('returns the last value unverified when the whole ladder fails', async () => {
    const { fn, calls } = scriptedFork(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const res = await solve<string>(fn, { task: { instruction: 'x' }, verify: () => reject('never') });
    expect(res.verified).toBe(false);
    // default maxAttempts 6: 1 initial + 1 retry + min(3, 6-2)=3 race = 5; race needs room
    expect(res.attempts).toBeLessThanOrEqual(6);
    expect(calls.length).toBe(res.attempts);
  });

  it('respects maxAttempts as a hard local ceiling', async () => {
    const { fn } = scriptedFork(Array.from({ length: 20 }, (_, i) => `v${i}`));
    const res = await solve<string>(fn, {
      task: { instruction: 'x' },
      verify: () => reject('no'),
      maxAttempts: 2,
    });
    // 1 initial + 1 retry = 2, then race has no room (2 >= 2) → stop
    expect(res.attempts).toBe(2);
    expect(res.verified).toBe(false);
  });

  it('honors a custom ladder (race-only) and parses race width', async () => {
    // ladder ['race2']: initial(bad) → race2 [good, bad] → winner first
    const { fn, calls } = scriptedFork(['bad', 'good', 'bad2']);
    const verify = (v: string): VerifyResult => (v === 'good' ? accept() : reject());
    const res = await solve<string>(fn, {
      task: { instruction: 'x' },
      verify,
      ladder: ['race2'],
    });
    expect(res.verified).toBe(true);
    expect(res.value).toBe('good');
    expect(res.rung).toBe(1);
    expect(res.attempts).toBe(3); // 1 initial + 2 race
    expect(calls).toHaveLength(3);
  });

  it('supports async verify functions', async () => {
    const { fn } = scriptedFork(['bad', 'good']);
    let n = 0;
    const verify = async (): Promise<VerifyResult> => {
      await Promise.resolve();
      return n++ === 0 ? reject('async fail') : accept();
    };
    const res = await solve<string>(fn, { task: { instruction: 'x' }, verify });
    expect(res).toMatchObject({ value: 'good', rung: 1, verified: true });
  });

  it('caps race width at the remaining attempt budget', async () => {
    // ladder ['race3'] but maxAttempts 2 → only 1 race fork has room after the initial
    const { fn, calls } = scriptedFork(['bad', 'bad2', 'bad3', 'bad4']);
    const res = await solve<string>(fn, {
      task: { instruction: 'x' },
      verify: () => reject('no'),
      ladder: ['race3'],
      maxAttempts: 2,
    });
    expect(res.attempts).toBe(2); // 1 initial + min(3, 2-1)=1 race
    expect(calls).toHaveLength(2);
  });
});
