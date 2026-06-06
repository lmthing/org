import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForkEngine, BudgetExceededError } from './fork.js';
import { BudgetTracker } from '../inspect/budget.js';

// ── Minimal mocks ──

function makeAssembly() {
  return {
    sessionDir: '/tmp/test-session',
    init: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ ref: 'inspect-1', sha: 'abc', heapSkipped: false }),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    rollbackByLabel: vi.fn().mockResolvedValue(undefined),
    rollbackBySha: vi.fn().mockResolvedValue(undefined),
    readSessionTs: vi.fn().mockResolvedValue(''),
    readHeapBin: vi.fn().mockResolvedValue(null),
    readMeta: vi.fn().mockResolvedValue(null),
    getLog: vi.fn().mockResolvedValue([]),
  };
}

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  };
}

function makeBudget(remaining = 10000) {
  return new BudgetTracker({ contextWindowTokens: Math.ceil(remaining / 0.8) });
}

function makeEngine(budgetRemaining = 10000) {
  const assembly = makeAssembly();
  const budget = makeBudget(budgetRemaining);
  const trace = makeTrace();
  const seedChildScope = vi.fn().mockReturnValue({});
  const onBudgetWarning = vi.fn();

  const engine = new ForkEngine({
    assembly: assembly as never,
    budgetTracker: budget,
    trace: trace as never,
    seedChildScope,
    onBudgetWarning,
  });

  return { engine, assembly, budget, trace, seedChildScope, onBudgetWarning };
}

// ── Tests ──

describe('ForkEngine', () => {
  describe('fork()', () => {
    it('returns a ForkHandle with forkId and inject() method', () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'Do something' });
      expect(typeof handle.forkId).toBe('string');
      expect(handle.forkId.startsWith('fork-')).toBe(true);
      expect(typeof handle.inject).toBe('function');
      // It should be a thenable (Promise)
      expect(typeof handle.then).toBe('function');
    });

    it('fork state starts as pending', () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'Task' });
      const states = engine.getForkStates();
      expect(states.get(handle.forkId)).toEqual({ status: 'pending' });
    });

    it('emits fork_spawn trace event', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.fork({ instruction: 'Step 1', tokenBudget: 500 });
      const spawnCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_spawn',
      );
      expect(spawnCall).toBeDefined();
      const event = spawnCall![0] as Record<string, unknown>;
      expect(event['forkId']).toBe(handle.forkId);
      expect(event['tokenCap']).toBe(500);
    });
  });

  describe('resolve()', () => {
    it('transitions fork state to resolved with value', () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'Compute sum' });
      const forkId = handle.forkId;

      // resolve() throws (to signal termination), but that is caught
      expect(() => engine.resolve(forkId, 42)).toThrow();

      const states = engine.getForkStates();
      const state = states.get(forkId) as { status: string; value: unknown };
      expect(state.status).toBe('resolved');
      expect(state.value).toBe(42);
    });

    it('ForkHandle promise resolves to ForkResult with correct fields', async () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'Return a string' });
      const forkId = handle.forkId;

      try { engine.resolve(forkId, 'hello'); } catch { /* expected */ }

      const result = await handle;
      expect(result.status).toBe('resolved');
      expect(result.value).toBe('hello');
      expect(result.forkId).toBe(forkId);
      expect(typeof result.tokensUsed).toBe('number');
    });

    it('emits fork_resolve trace event', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.fork({ instruction: 'test' });
      try { engine.resolve(handle.forkId, true); } catch { /* expected */ }
      const resolveCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_resolve',
      );
      expect(resolveCall).toBeDefined();
      expect((resolveCall![0] as Record<string, unknown>)['forkId']).toBe(handle.forkId);
    });
  });

  describe('recordForkTokens()', () => {
    it('debits parent BudgetTracker', () => {
      const { engine, budget } = makeEngine(10000);
      const before = budget.tokensRemaining;
      const handle = engine.fork({ instruction: 'task' });
      engine.recordForkTokens(handle.forkId, 200);
      expect(budget.tokensRemaining).toBe(before - 200);
    });

    it('emits fork_budget_warning when tokensRemaining <= warnAt', () => {
      const { engine, trace, onBudgetWarning } = makeEngine(10000);
      const handle = engine.fork({ instruction: 'task', tokenBudget: 1000, warnAt: 300 });
      // Use 701 tokens so 299 remain (< 300 = warnAt)
      engine.recordForkTokens(handle.forkId, 701);
      const warnCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_budget_warning',
      );
      expect(warnCall).toBeDefined();
      expect(onBudgetWarning).toHaveBeenCalledWith(handle.forkId, expect.any(Number));
    });

    it('does not emit duplicate budget warnings', () => {
      const { engine, trace } = makeEngine(10000);
      const handle = engine.fork({ instruction: 'task', tokenBudget: 1000, warnAt: 500 });
      engine.recordForkTokens(handle.forkId, 600);
      engine.recordForkTokens(handle.forkId, 100);
      const warnCalls = trace.write.mock.calls.filter(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_budget_warning',
      );
      expect(warnCalls.length).toBe(1);
    });

    it('rejects fork with BudgetExceeded when cap exhausted', async () => {
      const { engine } = makeEngine(10000);
      const handle = engine.fork({ instruction: 'task', tokenBudget: 100 });
      engine.recordForkTokens(handle.forkId, 101);

      const result = await handle;
      expect(result.status).toBe('rejected');
      expect(result.error).toContain('BudgetExceeded');
    });

    it('emits fork_reject trace event on budget exhaustion', () => {
      const { engine, trace } = makeEngine(10000);
      const handle = engine.fork({ instruction: 'task', tokenBudget: 50 });
      engine.recordForkTokens(handle.forkId, 51);
      const rejectCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_reject',
      );
      expect(rejectCall).toBeDefined();
      expect((rejectCall![0] as Record<string, unknown>)['reason']).toBe('BudgetExceeded');
    });
  });

  describe('injectForkAnswer()', () => {
    it('throws contract error when answer is not a string', () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'ask' });
      expect(() => engine.injectForkAnswer(handle.forkId, 42 as unknown as string)).toThrow();
      try {
        engine.injectForkAnswer(handle.forkId, 42 as unknown as string);
      } catch (err) {
        expect((err as Record<string, unknown>)['kind']).toBe('contract');
      }
    });

    it('is silently ignored when no pending ask', () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'no ask' });
      // Should not throw
      expect(() => engine.injectForkAnswer(handle.forkId, 'answer')).not.toThrow();
    });

    it('resolves pending ask with the provided string', async () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'needs answer' });
      const forkId = handle.forkId;

      const askPromise = engine.registerForkAsk(forkId, 'What is 2+2?');
      engine.injectForkAnswer(forkId, '4');

      const answer = await askPromise;
      expect(answer).toBe('4');
    });

    it('emits fork_ask_inject trace event', async () => {
      const { engine, trace } = makeEngine();
      const handle = engine.fork({ instruction: 'q' });
      engine.registerForkAsk(handle.forkId, 'Q?');
      engine.injectForkAnswer(handle.forkId, 'A');
      const injectCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'fork_ask_inject',
      );
      expect(injectCall).toBeDefined();
      expect((injectCall![0] as Record<string, unknown>)['answer']).toBe('A');
    });
  });

  describe('registerGlobals()', () => {
    it('registers fork() but not resolve() in main context (isFork=false)', () => {
      const { engine } = makeEngine();
      const ctx = {
        newFunction: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        setProp: vi.fn(),
        global: {},
      };
      engine.registerGlobals(ctx as never, false);
      const registeredNames = ctx.setProp.mock.calls.map((c) => c[1] as string);
      expect(registeredNames).toContain('fork');
      expect(registeredNames).not.toContain('resolve');
    });

    it('registers resolve() but not fork() in fork context (isFork=true)', () => {
      const { engine } = makeEngine();
      const ctx = {
        newFunction: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        setProp: vi.fn(),
        global: {},
      };
      engine.registerGlobals(ctx as never, true);
      const registeredNames = ctx.setProp.mock.calls.map((c) => c[1] as string);
      expect(registeredNames).toContain('resolve');
      expect(registeredNames).not.toContain('fork');
    });
  });

  describe('concurrent forks', () => {
    it('parent + 2 concurrent forks resolve independently', async () => {
      const { engine } = makeEngine(50000);

      const handle1 = engine.fork({ instruction: 'Task A', tokenBudget: 1000 });
      const handle2 = engine.fork({ instruction: 'Task B', tokenBudget: 1000 });

      try { engine.resolve(handle1.forkId, 'result-A'); } catch { /* expected */ }
      try { engine.resolve(handle2.forkId, { x: 99 }); } catch { /* expected */ }

      const [r1, r2] = await Promise.all([handle1, handle2]);

      expect(r1.status).toBe('resolved');
      expect(r1.value).toBe('result-A');
      expect(r1.forkId).toBe(handle1.forkId);

      expect(r2.status).toBe('resolved');
      expect(r2.value).toEqual({ x: 99 });
      expect(r2.forkId).toBe(handle2.forkId);
    });

    it('getForkStates returns all fork states', () => {
      const { engine } = makeEngine(50000);
      const h1 = engine.fork({ instruction: 'A' });
      const h2 = engine.fork({ instruction: 'B' });
      try { engine.resolve(h1.forkId, 1); } catch { /* expected */ }

      const states = engine.getForkStates();
      expect(states.size).toBe(2);
      expect(states.get(h1.forkId)?.status).toBe('resolved');
      expect(states.get(h2.forkId)?.status).toBe('pending');
    });
  });

  describe('getPendingAsks()', () => {
    it('returns forks with pending ask', async () => {
      const { engine } = makeEngine();
      const handle = engine.fork({ instruction: 'needs info' });
      engine.registerForkAsk(handle.forkId, 'Which option?');

      const asks = engine.getPendingAsks();
      expect(asks.length).toBe(1);
      expect(asks[0].forkId).toBe(handle.forkId);
      expect(asks[0].question).toBe('Which option?');
    });

    it('returns empty when no pending asks', () => {
      const { engine } = makeEngine();
      engine.fork({ instruction: 'no ask' });
      expect(engine.getPendingAsks()).toEqual([]);
    });
  });
});
