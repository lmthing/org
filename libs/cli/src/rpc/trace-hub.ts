import type { TraceEvent } from '@lmthing/core';

export interface SeqEvent {
  seq: number;
  event: TraceEvent;
}

/** Event types that are structural — always retained during compaction so a
 *  client joining mid-run can always reconstruct the full execution tree. */
const STRUCTURAL = new Set<TraceEvent['type']>([
  'session_start',
  'node_start',
  'node_update',
  'node_end',
  'turn_end',
  // Rare + load-bearing for diagnosis: an out-of-band VM disposal (see trace.ts). Must
  // never be shed under compaction — it is the evidence that pins a mid-turn disposer.
  'session_disposed',
]);

/** High-frequency / ephemeral types that may be shed under WS backpressure. */
const EPHEMERAL = new Set<TraceEvent['type']>(['llm_progress', 'fork_queue']);

export interface TraceSink {
  /** Send a JSON-serializable message to one client. Returns bufferedAmount, if known. */
  send(message: string): void;
  /** Current outbound buffer size in bytes (for backpressure). */
  bufferedAmount?: number;
  /** Whether the sink is open for writing. */
  isOpen(): boolean;
}

/**
 * Buffers seq-numbered trace events in memory and broadcasts them to attached
 * sinks (WS clients). Mid-run joiners get a snapshot; reconnecting clients can
 * request events since a seq. Compaction keeps memory bounded while always
 * retaining structural events so the tree stays reconstructable.
 */
export class TraceHub {
  private log: SeqEvent[] = [];
  private seqCounter = 0;
  private sinks: Set<TraceSink> = new Set();
  private truncatedBefore = 0;

  constructor(private opts: { maxEvents?: number; backpressureBytes?: number } = {}) {}

  private get maxEvents(): number { return this.opts.maxEvents ?? 20000; }
  private get backpressureBytes(): number { return this.opts.backpressureBytes ?? 1024 * 1024; }

  /** Ingest a trace event: assign a seq, append, compact, broadcast. */
  push(event: TraceEvent): void {
    const seq = ++this.seqCounter;
    const seqEvent: SeqEvent = { seq, event };
    this.log.push(seqEvent);
    this.compact();
    this.broadcast(seqEvent);
  }

  /** Highest seq assigned so far. */
  get lastSeq(): number { return this.seqCounter; }

  /** All buffered events (for the agent HTTP API + snapshots). */
  snapshot(): { events: SeqEvent[]; lastSeq: number; truncatedBefore: number } {
    return { events: this.log.slice(), lastSeq: this.seqCounter, truncatedBefore: this.truncatedBefore };
  }

  /** Events with seq > sinceSeq (incremental tail). */
  snapshotSince(sinceSeq: number): { events: SeqEvent[]; lastSeq: number; truncatedBefore: number } {
    return {
      events: this.log.filter((e) => e.seq > sinceSeq),
      lastSeq: this.seqCounter,
      truncatedBefore: this.truncatedBefore,
    };
  }

  attach(sink: TraceSink): void {
    this.sinks.add(sink);
  }

  detach(sink: TraceSink): void {
    this.sinks.delete(sink);
  }

  /** Compaction: when over the cap, drop oldest NON-structural events first. */
  private compact(): void {
    if (this.log.length <= this.maxEvents) return;
    const overflow = this.log.length - this.maxEvents;
    let dropped = 0;
    const kept: SeqEvent[] = [];
    for (const e of this.log) {
      if (dropped < overflow && !STRUCTURAL.has(e.event.type)) {
        dropped++;
        this.truncatedBefore = Math.max(this.truncatedBefore, e.seq);
        continue;
      }
      kept.push(e);
    }
    this.log = kept;
  }

  private broadcast(seqEvent: SeqEvent): void {
    const isEphemeral = EPHEMERAL.has(seqEvent.event.type);
    const msg = JSON.stringify({ type: 'trace', seq: seqEvent.seq, event: seqEvent.event });
    for (const sink of this.sinks) {
      if (!sink.isOpen()) continue;
      // Shed ephemeral events to clients that are backed up.
      if (isEphemeral && (sink.bufferedAmount ?? 0) > this.backpressureBytes) continue;
      try { sink.send(msg); } catch { /* best-effort */ }
    }
  }
}
