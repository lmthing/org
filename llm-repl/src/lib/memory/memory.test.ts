import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryEngine, applyCompactStrategy } from './memory.js';
import type { TraceWriter } from '../sandbox/trace.js';
import type { BudgetTracker } from '../inspect/budget.js';

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  } as unknown as TraceWriter;
}

function makeBudget(inspectCount = 0) {
  return {
    inspectCount,
  } as unknown as BudgetTracker;
}

function makeEngine(inspectCount = 0, onAutoCompact?: (names: string[]) => void) {
  const trace = makeTrace();
  const budget = makeBudget(inspectCount);
  const engine = new MemoryEngine({ trace, budgetTracker: budget, onAutoCompact });
  return { engine, trace, budget };
}

describe('MemoryEngine', () => {
  describe('pin()', () => {
    it('stores PinRecord and emits trace event', () => {
      const { engine, trace } = makeEngine(3);
      engine.pin('users', { maxTokens: 500 });
      const record = engine.getPinMeta('users');
      expect(record).toBeDefined();
      expect(record!.name).toBe('users');
      expect(record!.maxTokens).toBe(500);
      expect(record!.cycleAdded).toBe(3);
      expect(record!.gitRef).toBe(3);
      const writeCall = (trace.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'pin',
      );
      expect(writeCall).toBeDefined();
      expect((writeCall![0] as Record<string, unknown>).name).toBe('users');
      expect((writeCall![0] as Record<string, unknown>).maxTokens).toBe(500);
    });
  });

  describe('unpin()', () => {
    it('removes record and emits trace event', () => {
      const { engine, trace } = makeEngine();
      engine.pin('result');
      engine.unpin('result');
      expect(engine.getPinMeta('result')).toBeUndefined();
      const writeCall = (trace.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'unpin',
      );
      expect(writeCall).toBeDefined();
      expect((writeCall![0] as Record<string, unknown>).name).toBe('result');
    });
  });

  describe('compact() strategies', () => {
    it('schema strategy produces schema description', () => {
      const { engine } = makeEngine();
      const users = [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
      ];
      engine.compact('users', users, { strategy: 'schema' });
      const rec = engine.getCompaction('users');
      expect(rec).toBeDefined();
      const parsed = JSON.parse(rec!.compressed) as Record<string, unknown>;
      expect(parsed['_type']).toBe('Object[]');
      expect(parsed['_len']).toBe(2);
      const schema = parsed['_schema'] as Record<string, string>;
      expect(schema['id']).toBe('number');
      expect(schema['name']).toBe('string');
      expect(schema['age']).toBe('number');
    });

    it('sample strategy produces sample with first3/last2', () => {
      const { engine } = makeEngine();
      const arr = [1, 2, 3, 4, 5, 6, 7, 8];
      engine.compact('data', arr, { strategy: 'sample' });
      const rec = engine.getCompaction('data');
      expect(rec).toBeDefined();
      const parsed = JSON.parse(rec!.compressed) as unknown[];
      expect(parsed[0]).toBe(1);
      expect(parsed[1]).toBe(2);
      expect(parsed[2]).toBe(3);
      expect(parsed[3]).toBe('... +3 more ...');
      expect(parsed[4]).toBe(7);
      expect(parsed[5]).toBe(8);
    });

    it('summary strategy produces summary string', () => {
      const { engine } = makeEngine();
      const users = [
        { id: 1, name: 'Alice', city: 'NYC' },
        { id: 2, name: 'Bob', city: 'LA' },
      ];
      engine.compact('users', users, { strategy: 'summary' });
      const rec = engine.getCompaction('users');
      expect(rec).toBeDefined();
      expect(rec!.compressed).toMatch(/Array of 2/);
      expect(rec!.compressed).toMatch(/id/);
      expect(rec!.compressed).toMatch(/name/);
      expect(rec!.compressed).toMatch(/city/);
    });

    it('hash strategy produces sha1 hash string', () => {
      const { engine } = makeEngine();
      const value = { foo: 'bar', baz: 42 };
      engine.compact('obj', value, { strategy: 'hash' });
      const rec = engine.getCompaction('obj');
      expect(rec).toBeDefined();
      expect(rec!.compressed).toMatch(/^\/\* sha1:[0-9a-f]{8} \*\/$/);
    });
  });

  describe('expand()', () => {
    it('removes compaction record and emits expand trace event', () => {
      const { engine, trace } = makeEngine();
      engine.compact('result', [1, 2, 3], { strategy: 'schema' });
      expect(engine.getCompaction('result')).toBeDefined();
      engine.expand('result');
      expect(engine.getCompaction('result')).toBeUndefined();
      const writeCall = (trace.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'expand',
      );
      expect(writeCall).toBeDefined();
      expect((writeCall![0] as Record<string, unknown>).name).toBe('result');
    });
  });

  describe('autoCompact()', () => {
    it('early tier: skips vars with cycle_distance < 10', () => {
      const { engine } = makeEngine(5);
      const scope = { users: [1, 2, 3], result: 'hello' };
      const lastAccessedCycle = new Map([['users', 0], ['result', 4]]);
      const compacted = engine.autoCompact(scope, {
        inspectCount: 5,
        lastAccessedCycle,
        tier: 'early',
      });
      expect(compacted).toHaveLength(0);
    });

    it('late tier: compacts all non-pinned vars with cycle_distance >= 3', () => {
      const { engine } = makeEngine(10);
      engine.pin('pinned');
      const scope: Record<string, unknown> = {
        pinned: 'keep me',
        old1: [1, 2, 3],
        old2: { a: 1 },
        recent: 'fresh',
      };
      const lastAccessedCycle = new Map([
        ['pinned', 9],
        ['old1', 5],
        ['old2', 6],
        ['recent', 9],
      ]);
      const compacted = engine.autoCompact(scope, {
        inspectCount: 10,
        lastAccessedCycle,
        tier: 'late',
      });
      expect(compacted).toContain('old1');
      expect(compacted).toContain('old2');
      expect(compacted).not.toContain('pinned');
      expect(compacted).not.toContain('recent');
    });
  });

  describe('dotted path pin', () => {
    it('pin("__knowledge.grading.level") stored correctly', () => {
      const { engine } = makeEngine(1);
      engine.pin('__knowledge.grading.level', { maxTokens: 200 });
      const record = engine.getPinMeta('__knowledge.grading.level');
      expect(record).toBeDefined();
      expect(record!.name).toBe('__knowledge.grading.level');
      expect(record!.maxTokens).toBe(200);
    });
  });

  describe('compaction persistence', () => {
    it('second compact replaces first', () => {
      const { engine } = makeEngine();
      const value = [1, 2, 3, 4, 5, 6, 7];
      engine.compact('data', value, { strategy: 'sample' });
      const first = engine.getCompaction('data');
      expect(first!.strategy).toBe('sample');

      engine.compact('data', value, { strategy: 'hash' });
      const second = engine.getCompaction('data');
      expect(second!.strategy).toBe('hash');
      expect(second!.compressed).toMatch(/sha1/);
    });
  });

  describe('trace events', () => {
    it('all event types are emitted correctly', () => {
      const { engine, trace } = makeEngine(2);
      const scope = { arr: [1, 2, 3] };

      engine.pin('arr', { maxTokens: 100 });
      engine.unpin('arr');
      engine.compact('arr', scope.arr, { strategy: 'schema' });
      engine.expand('arr');
      engine.autoCompact(scope, {
        inspectCount: 2,
        lastAccessedCycle: new Map(),
        tier: 'early',
      });

      const writeMock = trace.write as ReturnType<typeof vi.fn>;
      const types = writeMock.mock.calls.map((c) => (c[0] as Record<string, unknown>).type);
      expect(types).toContain('pin');
      expect(types).toContain('unpin');
      expect(types).toContain('compact');
      expect(types).toContain('expand');
      expect(types).toContain('auto_compact');
    });
  });
});

describe('applyCompactStrategy', () => {
  it('schema for array produces _type/_len/_schema', () => {
    const result = applyCompactStrategy([{ id: 1, name: 'x' }], 'schema');
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['_len']).toBe(1);
    expect(parsed['_schema']).toBeDefined();
  });

  it('hash produces consistent output', () => {
    const value = { key: 'value' };
    const r1 = applyCompactStrategy(value, 'hash');
    const r2 = applyCompactStrategy(value, 'hash');
    expect(r1).toBe(r2);
    expect(r1).toMatch(/sha1:/);
  });
});
