import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TasklistEngine } from './tasklist.js';
import type { TasklistDag, TasklistHandle } from './tasklist.js';
import type { TraceWriter } from '../sandbox/trace.js';

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  } as unknown as TraceWriter;
}

function alwaysTrue(_expr: string, _el: unknown): boolean {
  return true;
}

function alwaysFalse(_expr: string, _el: unknown): boolean {
  return false;
}

function makeEngine(evalFilter = alwaysTrue) {
  const trace = makeTrace();
  const engine = new TasklistEngine({ trace, evalFilter });
  return { engine, trace };
}

const simpleDag: TasklistDag = {
  setup: { id: 'setup', label: 'Setup' },
  work: { id: 'work', label: 'Do work', deps: ['setup'] },
  cleanup: { id: 'cleanup', label: 'Cleanup', deps: ['work'] },
};

describe('TasklistEngine', () => {
  describe('register()', () => {
    it('creates a TasklistHandle with correct initial statuses', () => {
      const { engine } = makeEngine();
      const handle = engine.register('my-list', {
        a: { id: 'a', label: 'Task A' },
        b: { id: 'b', label: 'Task B' },
      });

      expect(handle.id).toBe('my-list');
      expect(handle.status('a')).toBe('pending');
      expect(handle.status('b')).toBe('pending');
    });

    it('emits tasklist_register trace event', () => {
      const { engine, trace } = makeEngine();
      engine.register('reg-test', { x: { id: 'x', label: 'X' } });
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const regEvent = calls.find((c) => (c[0] as Record<string, unknown>).type === 'tasklist_register');
      expect(regEvent).toBeDefined();
      expect((regEvent![0] as Record<string, unknown>).tasklistId).toBe('reg-test');
    });
  });

  describe('start()', () => {
    it('succeeds when no deps', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t1', {
        a: { id: 'a', label: 'Task A' },
      });
      handle.start('a');
      expect(handle.status('a')).toBe('in_progress');
    });

    it('throws contract error when dep not done', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t2', simpleDag);

      expect(() => handle.start('work')).toThrow(/Cannot start 'work': deps not done: setup/);
    });

    it('with condition evaluating to falsy → auto-skip', () => {
      const { engine, trace } = makeEngine(alwaysFalse);
      const handle = engine.register('t3', {
        a: { id: 'a', label: 'Conditional', condition: 'false' },
      });
      handle.start('a');
      expect(handle.status('a')).toBe('skipped');
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const skipEvent = calls.find((c) => (c[0] as Record<string, unknown>).type === 'task_skip');
      expect(skipEvent).toBeDefined();
    });

    it('with condition evaluating to truthy → in_progress', () => {
      const { engine } = makeEngine(alwaysTrue);
      const handle = engine.register('t4', {
        a: { id: 'a', label: 'Conditional', condition: 'true' },
      });
      handle.start('a');
      expect(handle.status('a')).toBe('in_progress');
    });

    it('emits tasklist_update trace event on success', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.register('t5', { a: { id: 'a', label: 'A' } });
      handle.start('a');
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const updateEvent = calls.find(
        (c) =>
          (c[0] as Record<string, unknown>).type === 'tasklist_update' &&
          (c[0] as Record<string, unknown>).to === 'in_progress',
      );
      expect(updateEvent).toBeDefined();
      expect((updateEvent![0] as Record<string, unknown>).from).toBe('pending');
    });
  });

  describe('finish()', () => {
    it('transitions in_progress → done', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t6', { a: { id: 'a', label: 'A' } });
      handle.start('a');
      handle.finish('a');
      expect(handle.status('a')).toBe('done');
    });

    it('emits tasklist_update trace event', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.register('t7', { a: { id: 'a', label: 'A' } });
      handle.start('a');
      handle.finish('a');
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const doneEvent = calls.find(
        (c) =>
          (c[0] as Record<string, unknown>).type === 'tasklist_update' &&
          (c[0] as Record<string, unknown>).to === 'done',
      );
      expect(doneEvent).toBeDefined();
    });

    it('outputSchema validation: finish with wrong type → contract error', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t-schema', {
        a: {
          id: 'a',
          label: 'A',
          outputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      });
      handle.start('a');
      expect(() => handle.finish('a', { name: 42 })).toThrow(/outputSchema mismatch for task 'a'/);
    });

    it('outputSchema validation: finish with correct value → done', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t-schema2', {
        a: {
          id: 'a',
          label: 'A',
          outputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      });
      handle.start('a');
      handle.finish('a', { name: 'Alice' });
      expect(handle.status('a')).toBe('done');
    });
  });

  describe('fail()', () => {
    it('with optional:false → blocks dependents', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t8', {
        a: { id: 'a', label: 'A', optional: false },
        b: { id: 'b', label: 'B', deps: ['a'] },
      });
      handle.start('a');
      handle.fail('a');
      expect(handle.status('a')).toBe('failed');
      expect(() => handle.start('b')).toThrow(/deps not done/);
    });

    it('with optional:true → unblocks dependents', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t9', {
        a: { id: 'a', label: 'A', optional: true },
        b: { id: 'b', label: 'B', deps: ['a'] },
      });
      handle.start('a');
      handle.fail('a');
      expect(handle.status('a')).toBe('failed');
      handle.start('b');
      expect(handle.status('b')).toBe('in_progress');
    });

    it('emits tasklist_update trace event', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.register('t10', { a: { id: 'a', label: 'A' } });
      handle.start('a');
      handle.fail('a');
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const failEvent = calls.find(
        (c) =>
          (c[0] as Record<string, unknown>).type === 'tasklist_update' &&
          (c[0] as Record<string, unknown>).to === 'failed',
      );
      expect(failEvent).toBeDefined();
      expect((failEvent![0] as Record<string, unknown>).from).toBe('in_progress');
    });
  });

  describe('skip()', () => {
    it('transitions pending → skipped, unblocks dependents', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t11', {
        a: { id: 'a', label: 'A' },
        b: { id: 'b', label: 'B', deps: ['a'] },
      });
      handle.skip('a');
      expect(handle.status('a')).toBe('skipped');
      handle.start('b');
      expect(handle.status('b')).toBe('in_progress');
    });

    it('emits task_skip trace event', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.register('t12', { a: { id: 'a', label: 'A' } });
      handle.skip('a');
      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls;
      const skipEvent = calls.find((c) => (c[0] as Record<string, unknown>).type === 'task_skip');
      expect(skipEvent).toBeDefined();
      expect((skipEvent![0] as Record<string, unknown>).id).toBe('a');
    });
  });

  describe('nudge()', () => {
    it('returns formatted summary for pending/in_progress tasks', () => {
      const { engine } = makeEngine();
      const handle = engine.register('research-pipeline', {
        setup: { id: 'setup', label: 'setup' },
        'fetch-data': { id: 'fetch-data', label: 'fetch-data', deps: ['setup'] },
        'parse-results': { id: 'parse-results', label: 'parse-results', deps: ['fetch-data'] },
      });
      handle.start('setup');
      handle.finish('setup');
      handle.start('fetch-data');

      const nudge = handle.nudge();
      expect(nudge).not.toBeNull();
      expect(nudge).toContain('Tasklist: research-pipeline');
      expect(nudge).toContain('fetch-data');
      expect(nudge).toContain('in_progress');
      expect(nudge).toContain('[✓]');
    });

    it('returns null when all done/failed/skipped', () => {
      const { engine } = makeEngine();
      const handle = engine.register('t-complete', {
        a: { id: 'a', label: 'A' },
        b: { id: 'b', label: 'B', deps: ['a'] },
      });
      handle.start('a');
      handle.finish('a');
      handle.start('b');
      handle.finish('b');
      expect(handle.nudge()).toBeNull();
    });
  });

  describe('DAG chain', () => {
    it('A → B → C; complete A, B can start; complete B, C can start', () => {
      const { engine } = makeEngine();
      const handle = engine.register('chain', {
        A: { id: 'A', label: 'A' },
        B: { id: 'B', label: 'B', deps: ['A'] },
        C: { id: 'C', label: 'C', deps: ['B'] },
      });

      expect(() => handle.start('B')).toThrow(/deps not done/);
      expect(() => handle.start('C')).toThrow(/deps not done/);

      handle.start('A');
      handle.finish('A');
      handle.start('B');
      expect(handle.status('B')).toBe('in_progress');

      expect(() => handle.start('C')).toThrow(/deps not done/);
      handle.finish('B');
      handle.start('C');
      expect(handle.status('C')).toBe('in_progress');
    });
  });

  describe('trace events', () => {
    it('tasklist_register, tasklist_update, task_skip all emitted', () => {
      const { engine, trace } = makeEngine(alwaysFalse);
      const handle = engine.register('trace-test', {
        a: { id: 'a', label: 'A', condition: 'false' },
        b: { id: 'b', label: 'B', deps: ['a'] },
      });

      handle.start('a'); // should skip due to alwaysFalse

      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as Record<string, unknown>).type,
      );

      expect(calls).toContain('tasklist_register');
      expect(calls).toContain('task_skip');
    });

    it('emits tasklist_update on finish', () => {
      const { engine, trace } = makeEngine();
      const handle = engine.register('trace-finish', { a: { id: 'a', label: 'A' } });
      handle.start('a');
      handle.finish('a');

      const calls = (trace.write as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => (c[0] as Record<string, unknown>).type,
      );
      expect(calls.filter((t) => t === 'tasklist_update').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getAllNudges()', () => {
    it('combines nudges from multiple tasklists', () => {
      const { engine } = makeEngine();
      engine.register('list1', { a: { id: 'a', label: 'A' } });
      engine.register('list2', { b: { id: 'b', label: 'B' } });

      const nudges = engine.getAllNudges();
      expect(nudges).not.toBeNull();
      expect(nudges).toContain('list1');
      expect(nudges).toContain('list2');
    });

    it('returns null when all tasklists are complete', () => {
      const { engine } = makeEngine();
      const h = engine.register('done-list', { a: { id: 'a', label: 'A' } });
      h.start('a');
      h.finish('a');

      expect(engine.getAllNudges()).toBeNull();
    });
  });
});
