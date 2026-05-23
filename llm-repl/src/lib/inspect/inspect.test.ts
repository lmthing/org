import { describe, it, expect } from 'vitest';
import {
  parseInspectArgNames,
  parseFilterExpression,
  evalFilter,
  applyQuery,
} from './index.js';
import { BudgetTracker } from './budget.js';
import { marshalHeap, unmarshalHeap, HEAP_MAX_BYTES } from '../../session/heap.js';
import { buildReconstruction } from '../../context/reconstruction.js';
import type { ReconstructionInput } from '../../context/reconstruction.js';

// ── parseInspectArgNames ──

describe('parseInspectArgNames', () => {
  it('returns [] for inspect()', () => {
    expect(parseInspectArgNames('inspect()')).toEqual([]);
  });

  it('returns ["users"] for inspect(users)', () => {
    expect(parseInspectArgNames('inspect(users)')).toEqual(['users']);
  });

  it('returns ["users", "config"] for inspect(users, config)', () => {
    expect(parseInspectArgNames('inspect(users, config)')).toEqual(['users', 'config']);
  });

  it('extracts first element from tuple: inspect([users, { slice: [0, 5] }])', () => {
    expect(parseInspectArgNames('inspect([users, { slice: [0, 5] }])')).toEqual(['users']);
  });

  it('returns ["result.data"] for inspect(result.data)', () => {
    expect(parseInspectArgNames('inspect(result.data)')).toEqual(['result.data']);
  });

  it('handles mixed: inspect(a, [b, { filter: "el.x > 0" }])', () => {
    expect(parseInspectArgNames('inspect(a, [b, { filter: "el.x > 0" }])')).toEqual(['a', 'b']);
  });
});

// ── parseFilterExpression + evalFilter ──

describe('parseFilterExpression + evalFilter', () => {
  it('el.age > 30 with { age: 35 } → true', () => {
    const node = parseFilterExpression('el.age > 30');
    expect(evalFilter(node, { age: 35 })).toBe(true);
  });

  it('el.age > 30 with { age: 25 } → false', () => {
    const node = parseFilterExpression('el.age > 30');
    expect(evalFilter(node, { age: 25 })).toBe(false);
  });

  it('el.active == true && el.score >= 10 with matching values → true', () => {
    const node = parseFilterExpression('el.active == true && el.score >= 10');
    expect(evalFilter(node, { active: true, score: 15 })).toBe(true);
  });

  it('el.active == true && el.score >= 10 with non-matching values → false', () => {
    const node = parseFilterExpression('el.active == true && el.score >= 10');
    expect(evalFilter(node, { active: true, score: 5 })).toBe(false);
  });

  it('throws on function call: el.name.includes("x")', () => {
    expect(() => parseFilterExpression('el.name.includes("x")')).toThrow();
  });
});

// ── applyQuery ──

describe('applyQuery', () => {
  it('path: "users[0].name" extracts value', () => {
    const data = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
    expect(applyQuery(data, { path: 'users[0].name' })).toBe('Alice');
  });

  it('slice: [0, 3] on array → first 3 elements', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(applyQuery(arr, { slice: [0, 3] })).toEqual([1, 2, 3]);
  });

  it('filter: "el.age > 30" on array → filtered subset', () => {
    const arr = [{ age: 25 }, { age: 35 }, { age: 40 }];
    expect(applyQuery(arr, { filter: 'el.age > 30' })).toEqual([{ age: 35 }, { age: 40 }]);
  });

  it('sample: 5 on 20-element array → 5 elements', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const result = applyQuery(arr, { sample: 5 }) as unknown[];
    expect(result).toHaveLength(5);
  });

  it('count: true on array → number', () => {
    expect(applyQuery([1, 2, 3], { count: true })).toBe(3);
  });

  it('keys: true on object → array of keys', () => {
    const result = applyQuery({ a: 1, b: 2 }, { keys: true });
    expect(result).toEqual(['a', 'b']);
  });

  it('search: "alice" on array → matching elements', () => {
    const arr = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Alice2' }];
    const result = applyQuery(arr, { search: 'alice' }) as unknown[];
    expect(result).toHaveLength(2);
  });
});

// ── BudgetTracker ──

describe('BudgetTracker', () => {
  it('snapshot() returns correct Budget shape', () => {
    const bt = new BudgetTracker({ contextWindowTokens: 10000 });
    const snap = bt.snapshot();
    expect(snap).toHaveProperty('tokensRemaining');
    expect(snap).toHaveProperty('tokensUsed');
    expect(snap).toHaveProperty('inspectCount');
    expect(snap).toHaveProperty('nearingLimit');
    expect(snap).toHaveProperty('context');
    expect(snap).toHaveProperty('execution');
  });

  it('recordTokens updates tokensUsed and tokensRemaining', () => {
    const bt = new BudgetTracker({ contextWindowTokens: 10000 });
    const before = bt.tokensRemaining;
    bt.recordTokens(100);
    expect(bt.tokensUsed).toBe(100);
    expect(bt.tokensRemaining).toBe(before - 100);
  });

  it('recordInspect increments inspectCount', () => {
    const bt = new BudgetTracker({ contextWindowTokens: 10000 });
    bt.recordInspect();
    bt.recordInspect();
    expect(bt.inspectCount).toBe(2);
  });
});

// ── buildReconstruction ──

describe('buildReconstruction', () => {
  function makeInput(overrides: Partial<ReconstructionInput> = {}): ReconstructionInput {
    return {
      inspectNumber: 3,
      sessionTs: 'const x = 1;\nconst y = 2;\n',
      scope: { x: 1, y: 'hello' },
      meta: {
        budgetTokensUsed: 100,
        budgetTokensRemaining: 7900,
        inspectCount: 3,
        annotationGraceUsed: false,
        pins: {},
        compactions: {},
        errors: [],
        tasks: [],
      },
      pins: new Set(),
      compactions: new Map(),
      promiseStates: new Map(),
      lastAccessedCycle: new Map(),
      errors: [],
      expandedArgs: [],
      git: { head: 'inspect-3', checkpoints: [], branch: 'main' },
      budgetTokensRemaining: 7900,
      budgetTokensUsed: 100,
      budgetInputTokensUsed: 70,
      budgetOutputTokensUsed: 30,
      budgetCostUsd: 0,
      budgetContext: { used: 500, max: 8000, scopeTokens: 50, sourceTokens: 100, wastedOnAbort: 0 },
      budgetExecution: { statementsTotal: 5, statementsSinceInspect: 2, heapMB: 2, heapMaxMB: 64 },
      forksActive: 0,
      forksCompleted: 0,
      nearingLimit: false,
      tokenBudget: 4096,
      ...overrides,
    };
  }

  it('contains inspect header', () => {
    const out = buildReconstruction(makeInput());
    expect(out).toContain('// ═══ inspect #3 ═══');
  });

  it('contains __scope block', () => {
    const out = buildReconstruction(makeInput());
    expect(out).toContain('const __scope = {');
  });

  it('contains __budget block', () => {
    const out = buildReconstruction(makeInput());
    expect(out).toContain('const __budget: Budget = {');
  });

  it('hard-pinned budget is always present', () => {
    const out = buildReconstruction(makeInput({ tokenBudget: 10 }));
    expect(out).toContain('const __budget');
  });

  it('respects decay tiers — early has longer source tail', () => {
    const lines100 = Array.from({ length: 120 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const earlyOut = buildReconstruction(makeInput({ inspectNumber: 2, sessionTs: lines100, tokenBudget: 100000 }));
    const lateOut = buildReconstruction(makeInput({ inspectNumber: 20, sessionTs: lines100, tokenBudget: 100000 }));
    // Late should have fewer source lines shown
    const earlySourceLines = earlyOut.split('\n').filter(l => l.startsWith('const v')).length;
    const lateSourceLines = lateOut.split('\n').filter(l => l.startsWith('const v')).length;
    expect(earlySourceLines).toBeGreaterThan(lateSourceLines);
  });
});

// ── marshalHeap + unmarshalHeap ──

describe('marshalHeap + unmarshalHeap', () => {
  it('primitives roundtrip correctly', () => {
    const scope = { a: 1, b: 'hello', c: true, d: null };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(false);
    const restored = unmarshalHeap(buf);
    expect(restored.a).toBe(1);
    expect(restored.b).toBe('hello');
    expect(restored.c).toBe(true);
    expect(restored.d).toBe(null);
  });

  it('arrays roundtrip', () => {
    const scope = { arr: [1, 2, 3] };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(false);
    const restored = unmarshalHeap(buf);
    expect(restored.arr).toEqual([1, 2, 3]);
  });

  it('Sets roundtrip', () => {
    const scope = { s: new Set([1, 2, 3]) };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(false);
    const restored = unmarshalHeap(buf);
    expect(restored.s).toBeInstanceOf(Set);
    expect(restored.s as Set<unknown>).toContain(1);
  });

  it('Maps roundtrip', () => {
    const scope = { m: new Map([['key', 'val']]) };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(false);
    const restored = unmarshalHeap(buf);
    expect(restored.m).toBeInstanceOf(Map);
    expect((restored.m as Map<string, string>).get('key')).toBe('val');
  });

  it('class instances become orphan placeholders', () => {
    class Foo { x = 42; }
    const scope = { obj: new Foo() };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(false);
    const restored = unmarshalHeap(buf);
    const obj = restored.obj as Record<string, unknown>;
    expect(obj.__orphaned).toBe('Foo');
    expect(obj.x).toBe(42);
  });

  it('skipped: true when over 64MB', () => {
    // Create a string that will produce > 64MB when JSON-encoded
    const bigStr = 'x'.repeat(HEAP_MAX_BYTES + 1);
    const scope = { big: bigStr };
    const { buf, skipped } = marshalHeap(scope);
    expect(skipped).toBe(true);
    expect(buf.byteLength).toBe(0);
  });
});
