import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointEngine, RollbackBlockedError } from './checkpoint.js';
import type { SettleResult } from './checkpoint.js';

function makeAssembly() {
  return {
    checkpoint: vi.fn().mockResolvedValue(undefined),
    rollbackByLabel: vi.fn().mockResolvedValue(undefined),
    rollbackBySha: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTrace(events: Array<Record<string, unknown>> = []) {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue(events),
  };
}

function makeSettle(result: SettleResult = { pendingCount: 0, elapsedMs: 5, timeouts: [] }) {
  return vi.fn().mockResolvedValue(result);
}

describe('CheckpointEngine', () => {
  describe('checkpoint(label)', () => {
    it('creates cp-{label} tag via assembly.checkpoint', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      await engine.checkpoint('before-delete');

      expect(assembly.checkpoint).toHaveBeenCalledWith('before-delete');
    });

    it('calls onSettle before assembly.checkpoint', async () => {
      const calls: string[] = [];
      const assembly = makeAssembly();
      assembly.checkpoint = vi.fn().mockImplementation(async () => { calls.push('checkpoint'); });
      const trace = makeTrace();
      const onSettle = vi.fn().mockImplementation(async () => {
        calls.push('settle');
        return { pendingCount: 0, elapsedMs: 0, timeouts: [] };
      });

      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });
      await engine.checkpoint('my-label');

      expect(calls).toEqual(['settle', 'checkpoint']);
    });

    it('emits checkpoint_settle_wait trace event with correct fields', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const onSettle = makeSettle({ pendingCount: 3, elapsedMs: 42, timeouts: [{ name: 'p1' }] });
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      await engine.checkpoint('test-label');

      const settleCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'checkpoint_settle_wait',
      );
      expect(settleCall).toBeDefined();
      const event = settleCall![0] as Record<string, unknown>;
      expect(event['label']).toBe('test-label');
      expect(event['pendingCount']).toBe(3);
      expect(typeof event['elapsedMs']).toBe('number');
    });

    it('emits checkpoint trace event after settle', async () => {
      const traceEvents: Array<Record<string, unknown>> = [];
      const assembly = makeAssembly();
      const trace = {
        write: vi.fn().mockImplementation((e: Record<string, unknown>) => traceEvents.push(e)),
        readSuffix: vi.fn().mockReturnValue([]),
      };
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      await engine.checkpoint('after-test');

      const types = traceEvents.map((e) => e['type']);
      expect(types).toContain('checkpoint_settle_wait');
      expect(types).toContain('checkpoint');
      expect(types.indexOf('checkpoint_settle_wait')).toBeLessThan(types.indexOf('checkpoint'));

      const cpEvent = traceEvents.find((e) => e['type'] === 'checkpoint');
      expect(cpEvent!['label']).toBe('after-test');
    });
  });

  describe('rollback(target)', () => {
    it('calls rollbackByLabel when target is a string label', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      const result = await engine.rollback('before-transform');

      expect(assembly.rollbackByLabel).toHaveBeenCalledWith('before-transform');
      expect(result.ref).toBe('cp-before-transform');
    });

    it('walks back N execute events (skipping function_captured events)', async () => {
      const traceEvents = [
        { type: 'function_captured', name: 'fn1', sha: 'aaa' },
        { type: 'execute', sha: 'sha1' },
        { type: 'function_captured', name: 'fn2', sha: 'bbb' },
        { type: 'execute', sha: 'sha2' },
        { type: 'execute', sha: 'sha3' },
      ];
      const assembly = makeAssembly();
      const trace = makeTrace(traceEvents as never);
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      const result = await engine.rollback(2);

      expect(assembly.rollbackBySha).toHaveBeenCalledWith('sha2');
      expect(result.rewound).toBe(2);
      expect(result.ref).toBe('sha2');
    });

    it('rollback(0) returns rewound=0 without calling rollback', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      const result = await engine.rollback(0);

      expect(assembly.rollbackBySha).not.toHaveBeenCalled();
      expect(assembly.rollbackByLabel).not.toHaveBeenCalled();
      expect(result.rewound).toBe(0);
    });

    it('emits rollback trace event with target, rewound, ref', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace([{ type: 'execute', sha: 'abc123' }] as never);
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      await engine.rollback(1);

      const rollbackCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'rollback',
      );
      expect(rollbackCall).toBeDefined();
      const event = rollbackCall![0] as Record<string, unknown>;
      expect(event['target']).toBe(1);
      expect(event['rewound']).toBe(1);
      expect(event['ref']).toBe('abc123');
    });

    it('throws RollbackBlockedError when count exceeds available execute events', async () => {
      const traceEvents = [{ type: 'execute', sha: 'sha1' }];
      const assembly = makeAssembly();
      const trace = makeTrace(traceEvents as never);
      const onSettle = makeSettle();
      const engine = new CheckpointEngine({ assembly: assembly as never, trace: trace as never, onSettle });

      await expect(engine.rollback(5)).rejects.toThrow(RollbackBlockedError);
    });
  });
});
