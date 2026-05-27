import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnapshotEngine } from './snapshot.js';
import * as heap from '../../session/heap.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TraceEvent } from '../sandbox/trace.js';

function makeAssembly() {
  return {
    commit: vi.fn().mockResolvedValue({ ref: 'inspect-1', sha: 'abc', heapSkipped: false }),
    init: vi.fn().mockResolvedValue(undefined),
    readHeapBin: vi.fn().mockResolvedValue(null),
    sessionDir: '/tmp/fake-session',
  };
}

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  };
}

describe('SnapshotEngine', () => {
  describe('checkSize(scope)', () => {
    it('returns skipped=false for a small scope', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const result = engine.checkSize({ x: 1, y: 'hello', z: [1, 2, 3] });

      expect(result.skipped).toBe(false);
      expect(result.heapBytes).toBeGreaterThan(0);
      expect(typeof result.ref).toBe('string');
    });

    it('returns skipped=true when marshalHeap indicates overflow', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      // Mock marshalHeap to return skipped=true (simulating > 64MB heap)
      const marshalSpy = vi.spyOn(heap, 'marshalHeap').mockReturnValue({
        buf: Buffer.alloc(0),
        skipped: true,
      });

      try {
        const result = engine.checkSize({ bigData: 'x'.repeat(1000) });

        expect(result.skipped).toBe(true);
        expect(result.heapBytes).toBeGreaterThan(heap.HEAP_MAX_BYTES);
      } finally {
        marshalSpy.mockRestore();
      }
    });

    it('emits snapshot_skipped trace event when over limit', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const marshalSpy = vi.spyOn(heap, 'marshalHeap').mockReturnValue({
        buf: Buffer.alloc(0),
        skipped: true,
      });

      try {
        engine.checkSize({ big: 'data' });
        const calls = trace.write.mock.calls;
        const skippedCall = calls.find(
          (c) => (c[0] as Record<string, unknown>).type === 'snapshot_skipped',
        );
        expect(skippedCall).toBeDefined();
      } finally {
        marshalSpy.mockRestore();
      }
    });
  });

  describe('loadBase()', () => {
    it('returns null when no baseSnapshot configured', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const result = await engine.loadBase();
      expect(result).toBeNull();
    });

    it('returns null when baseSnapshot file does not exist', async () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: { baseSnapshot: '/nonexistent/path/heap.bin' },
      });

      const result = await engine.loadBase();
      expect(result).toBeNull();
    });

    it('reads and deserializes scope when baseSnapshot is set', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'snapshot-test-'));
      try {
        // Create a valid heap.bin
        const { buf } = heap.marshalHeap({ count: 42, name: 'test' });
        const heapPath = join(tmpDir, 'heap.bin');
        await writeFile(heapPath, buf);

        const assembly = makeAssembly();
        const trace = makeTrace();
        const engine = new SnapshotEngine({
          assembly: assembly as never,
          trace: trace as never,
          config: { baseSnapshot: heapPath },
        });

        const result = await engine.loadBase();
        expect(result).not.toBeNull();
        expect(result!['count']).toBe(42);
        expect(result!['name']).toBe('test');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('emits snapshot_loaded trace event on success', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'snapshot-trace-'));
      try {
        const { buf } = heap.marshalHeap({ value: 99 });
        const heapPath = join(tmpDir, 'heap.bin');
        await writeFile(heapPath, buf);

        const assembly = makeAssembly();
        const trace = makeTrace();
        const engine = new SnapshotEngine({
          assembly: assembly as never,
          trace: trace as never,
          config: { baseSnapshot: heapPath },
        });

        await engine.loadBase();

        const loadedCall = trace.write.mock.calls.find(
          (c) => (c[0] as Record<string, unknown>).type === 'snapshot_loaded',
        );
        expect(loadedCall).toBeDefined();
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('isRollbackValid(ref, traceEvents)', () => {
    it('returns true when no snapshot_skipped events', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const events: TraceEvent[] = [
        { ts: 1, type: 'execute', sha: 'abc' },
        { ts: 2, type: 'checkpoint', label: 'my-cp' },
      ];

      expect(engine.isRollbackValid('inspect-3', events)).toBe(true);
    });

    it('returns false when snapshot_skipped event is present for that ref', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const events: TraceEvent[] = [
        { ts: 1, type: 'execute', sha: 'abc' },
        { ts: 2, type: 'snapshot_skipped', ref: 'inspect-5', reason: 'heap_over_limit', heapBytes: 100000000 },
        { ts: 3, type: 'execute', sha: 'def' },
      ];

      expect(engine.isRollbackValid('inspect-5', events)).toBe(false);
    });

    it('returns true when snapshot_skipped is for a different ref', () => {
      const assembly = makeAssembly();
      const trace = makeTrace();
      const engine = new SnapshotEngine({
        assembly: assembly as never,
        trace: trace as never,
        config: {},
      });

      const events: TraceEvent[] = [
        { ts: 1, type: 'snapshot_skipped', ref: 'inspect-3', reason: 'heap_over_limit', heapBytes: 100000000 },
      ];

      expect(engine.isRollbackValid('inspect-7', events)).toBe(true);
    });
  });
});
