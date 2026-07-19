import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compact, compactStep, summarizeTurn, traceLines, redactSecrets } from './evidence.mjs';

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
  it('returns small args unchanged (structurally — compact now returns a redacted copy)', () => {
    const small = { a: 1 };
    expect(compact(small)).toEqual(small);
  });
});

// Run-28 regression (06-tanzania): a resumed session absorbed the step-4 message, streamed zero
// statements, and the runner recorded a "played" step with an empty turn, no error, and exit 0 —
// a silently-dead turn indistinguishable from success. `deadTurnError` is the harness-level
// anti-silent: every-turn-empty ⇒ an error string; any sign of life ⇒ null.
describe('deadTurnError — a zero-work turn is an error, not a completed step', () => {
  const deadTurn = { sent: 'hi', lastText: '', delegates: [], yields: [], errors: [] };

  it('flags a step whose only turn did nothing', async () => {
    const { deadTurnError } = await import('./evidence.mjs');
    const rec = { step: 4, turns: [deadTurn], asks: [], notes: [] };
    expect(deadTurnError(rec)).toMatch(/DEAD TURN/);
  });

  it('stays silent when the turn shows any sign of life (text, yields, delegates, errors, or an ask)', async () => {
    const { deadTurnError } = await import('./evidence.mjs');
    for (const live of [
      { ...deadTurn, lastText: 'an answer' },
      { ...deadTurn, yields: [{ kind: 'inspect' }] },
      { ...deadTurn, delegates: ['/some/space/agent/answer'] },
      { ...deadTurn, errors: [{ type: 'typecheck_error' }] },
    ]) {
      expect(deadTurnError({ step: 1, turns: [live], asks: [], notes: [] })).toBeNull();
    }
    expect(deadTurnError({ step: 1, turns: [deadTurn], asks: [{ id: 'a1' }], notes: [] })).toBeNull();
  });

  it('never overrides an existing error and ignores turnless steps (open_app, restart_pod)', async () => {
    const { deadTurnError } = await import('./evidence.mjs');
    expect(deadTurnError({ step: 1, turns: [deadTurn], asks: [], error: 'STEP THREW: x' })).toBeNull();
    expect(deadTurnError({ step: 1, turns: [], asks: [] })).toBeNull();
  });
});

describe('redactSecrets — evidence secrets hygiene', () => {
  it('masks credential-named fields and Bearer/sk-/tvly- tokens, leaves normal data intact', () => {
    const input = {
      headers: { authorization: 'Bearer tvly-abc123secretlong', 'x-api-key': 'sk-longsecretvalue123' },
      body: 'q=weather&token=tvly-anotherkey9999',
      query: 'is there anything cheaper',
      count: 42,
    };
    const out = redactSecrets(input);
    const s = JSON.stringify(out);
    expect(s).not.toContain('abc123secretlong');
    expect(s).not.toContain('longsecretvalue123');
    expect(s).not.toContain('anotherkey9999');
    expect(out.query).toBe('is there anything cheaper'); // non-secret untouched
    expect(out.count).toBe(42);
  });
  it('redacts an exact secret value the runner env exposes', () => {
    process.env.LM_TEST_FAKE_API_KEY = 'supersecret-value-1234567890';
    try {
      const out = redactSecrets({ url: 'https://api.example.com?k=supersecret-value-1234567890' });
      expect(JSON.stringify(out)).not.toContain('supersecret-value-1234567890');
    } finally {
      delete process.env.LM_TEST_FAKE_API_KEY;
    }
  });
  it('is a structural no-op on secret-free data (byte round-trip)', () => {
    const clean = { a: 1, b: ['x', 'y'], c: { d: 'hello world' } };
    expect(JSON.stringify(redactSecrets(clean))).toBe(JSON.stringify(clean));
  });
});
