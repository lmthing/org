import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compact, compactStep, summarizeTurn, traceLines } from './evidence.mjs';

// The strongest guarantee: the judge parses these transforms' output, so they must be BYTE-identical
// to what the pre-refactor inline code produced. `06/step-01.full.json` is a real recorded `rec`
// (the raw dump the old runner wrote); `06/step-01.json` is the compact file it wrote from that same
// rec; `06/trace-step01.md` is the trace for that step. compactStep/traceLines must reproduce them.
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, '__fixtures__', p), 'utf8');
const rec06 = JSON.parse(read('06/step-01.full.json'));

describe('compactStep — judge-sized observables (byte golden)', () => {
  it('reproduces the recorded step-01.json exactly', () => {
    expect(JSON.stringify(compactStep(rec06), null, 2)).toBe(read('06/step-01.json'));
  });
  it('collapses appTable ROWS to counts (not the rows)', () => {
    const rec = { step: 1, verbs: [], expect: [], turns: [], asks: [], state: { appTables: { trips: [{}, {}], legs: [{}, {}, {}] } } };
    expect(compactStep(rec).state.appTables).toEqual({ trips: 2, legs: 3 });
  });
});

describe('traceLines — human trace (byte golden)', () => {
  it('reproduces the recorded step-01 trace exactly', () => {
    expect(traceLines(rec06).join('\n')).toBe(read('06/trace-step01.md'));
  });
});

describe('summarizeTurn / compact', () => {
  it('marks an empty turn', () => {
    expect(summarizeTurn(null, 'hi')).toEqual({ sent: 'hi', empty: true });
  });
  it('preserves field order and dedups yield kinds', () => {
    const turn = {
      lastText: 'x',
      delegates: ['a/b'],
      yields: [{ kind: 'ask', args: { q: 1 } }, { kind: 'ask', args: { q: 2 } }, { kind: 'display', args: {} }],
      errors: [],
      nodes: [],
      tokens: { in: 1, out: 2 },
      durationMs: 5,
    };
    const s = summarizeTurn(turn, 'msg');
    expect(Object.keys(s)).toEqual(['sent', 'lastText', 'delegates', 'yieldKinds', 'yields', 'errors', 'nodes', 'tokens', 'durationMs', 'interrupted']);
    expect(s.yieldKinds).toEqual(['ask', 'display']);
    expect(s.interrupted).toBe(false);
  });
  it('truncates a >400-char arg to a 401-char preview ending in …', () => {
    const out = compact({ s: 'z'.repeat(500) });
    expect(typeof out).toBe('string');
    expect(out.length).toBe(401);
    expect(out.endsWith('…')).toBe(true);
  });
  it('returns small args unchanged', () => {
    const small = { a: 1 };
    expect(compact(small)).toBe(small);
  });
});
