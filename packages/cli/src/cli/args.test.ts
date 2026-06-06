import { describe, it, expect } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs — budget flags', () => {
  const base = ['--space', 'fixtures/cooking'];

  it('parses all four budget caps as numbers', () => {
    const a = parseArgs([
      ...base,
      '--max-episodes', '3',
      '--max-tool-calls', '5',
      '--max-fork-depth', '2',
      '--max-wallclock-ms', '5000',
      'make pasta',
    ]);
    expect(a.maxEpisodes).toBe(3);
    expect(a.maxToolCalls).toBe(5);
    expect(a.maxForkDepth).toBe(2);
    expect(a.maxWallClockMs).toBe(5000);
    expect(a.message).toBe('make pasta');
  });

  it('leaves budget caps undefined when not given', () => {
    const a = parseArgs([...base, 'hi']);
    expect(a.maxEpisodes).toBeUndefined();
    expect(a.maxToolCalls).toBeUndefined();
    expect(a.maxForkDepth).toBeUndefined();
    expect(a.maxWallClockMs).toBeUndefined();
  });

  it('accepts 0 as a valid cap (e.g. --max-fork-depth 0 blocks all forks)', () => {
    const a = parseArgs([...base, '--max-fork-depth', '0', 'x']);
    expect(a.maxForkDepth).toBe(0);
  });

  it('throws on a non-numeric value', () => {
    expect(() => parseArgs([...base, '--max-episodes', 'abc', 'x'])).toThrow(/non-negative number/);
  });

  it('throws on a negative value', () => {
    expect(() => parseArgs([...base, '--max-tool-calls', '-1', 'x'])).toThrow(/non-negative number/);
  });

  it('throws when the flag value is missing', () => {
    expect(() => parseArgs([...base, '--max-episodes'])).toThrow(/requires a value/);
  });

  it('does not regress existing flags', () => {
    const a = parseArgs(['--space', 's', '--agent', 'chef', '--max-episodes', '2', '--trace', '/tmp/t.jsonl', 'go']);
    expect(a.space).toBe('s');
    expect(a.agent).toBe('chef');
    expect(a.traceFile).toBe('/tmp/t.jsonl');
    expect(a.maxEpisodes).toBe(2);
    expect(a.message).toBe('go');
  });
});
