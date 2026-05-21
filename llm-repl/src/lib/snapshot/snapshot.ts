/**
 * SnapshotEngine — Phase 10 (L9)
 *
 * Manages heap.bin base snapshots:
 *  - checkSize(): determines whether the current scope exceeds maxHeapMB
 *  - loadBase(): reads and deserializes a prior session's heap.bin into scope
 *  - isRollbackValid(): scans trace events for snapshot_skipped to block invalid rollbacks
 */
import { readFile } from 'node:fs/promises';
import { marshalHeap, unmarshalHeap, HEAP_MAX_BYTES } from '../../session/heap.js';
import type { SessionAssembly } from '../../session/assembly.js';
import type { TraceWriter, TraceEvent } from '../sandbox/trace.js';

export interface SnapshotConfig {
  /** Path to a pre-existing heap.bin to seed from */
  baseSnapshot?: string;
  /** Default 64 MB */
  maxHeapMB?: number;
}

export interface SnapshotResult {
  heapBytes: number;
  skipped: boolean;
  /** git ref this snapshot covers */
  ref: string;
}

export class SnapshotEngine {
  private readonly _assembly: SessionAssembly;
  private readonly _trace: TraceWriter;
  private readonly _config: SnapshotConfig;
  private readonly _maxBytes: number;

  constructor(opts: {
    assembly: SessionAssembly;
    trace: TraceWriter;
    config: SnapshotConfig;
  }) {
    this._assembly = opts.assembly;
    this._trace = opts.trace;
    this._config = opts.config;
    this._maxBytes = (opts.config.maxHeapMB ?? 64) * 1024 * 1024;
  }

  /**
   * Take a scope snapshot: marshal heap.bin from the current scope.
   * Skips (emits snapshot_skipped) if heap > maxHeapMB.
   * Returns a SnapshotResult describing what happened.
   */
  checkSize(scope: Record<string, unknown>): SnapshotResult {
    const { buf, skipped } = marshalHeap(scope);

    // When marshalHeap returns skipped=true the buf is empty (0 bytes),
    // but we need the real byte count to report. We treat the HEAP_MAX_BYTES
    // limit as the canonical overflow indicator when skipped=true.
    const heapBytes = skipped ? HEAP_MAX_BYTES + 1 : buf.byteLength;

    // Also check against a potentially lower configured maxHeapMB
    const overLimit = skipped || heapBytes > this._maxBytes;

    const ref = `heap-check-${Date.now()}`;

    if (overLimit) {
      this._trace.write({ type: 'snapshot_skipped', ref, reason: 'heap_over_limit', heapBytes });
      return { heapBytes, skipped: true, ref };
    }

    return { heapBytes, skipped: false, ref };
  }

  /**
   * Load a base snapshot into a fresh QuickJS context scope.
   * Reads baseSnapshot file (if configured) and returns the deserialized scope.
   * Used at session start to seed state from a prior session's heap.bin.
   */
  async loadBase(): Promise<Record<string, unknown> | null> {
    if (!this._config.baseSnapshot) {
      return null;
    }

    let buf: Buffer;
    try {
      buf = await readFile(this._config.baseSnapshot);
    } catch {
      this._trace.write({ type: 'snapshot_load_failed', path: this._config.baseSnapshot });
      return null;
    }

    const scope = unmarshalHeap(buf);
    this._trace.write({ type: 'snapshot_loaded', path: this._config.baseSnapshot, keys: Object.keys(scope).length });
    return scope;
  }

  /**
   * Check if rollback to a given ref is valid (heap.bin existed at that ref).
   * Returns false if that commit skipped heap.bin (snapshot_skipped event present for ref).
   */
  isRollbackValid(ref: string, traceEvents: TraceEvent[]): boolean {
    for (const event of traceEvents) {
      if (event.type === 'snapshot_skipped' && event['ref'] === ref) {
        return false;
      }
    }
    return true;
  }
}
