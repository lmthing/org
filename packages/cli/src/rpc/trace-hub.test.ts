import { describe, it, expect } from 'vitest';
import { TraceHub, type TraceSink } from './trace-hub.js';
import type { TraceEvent } from '@lmthing/core';

function makeSink(): TraceSink & { messages: string[]; open: boolean; buffered: number } {
  const s = {
    messages: [] as string[],
    open: true,
    buffered: 0,
    send(m: string) { this.messages.push(m); },
    get bufferedAmount() { return this.buffered; },
    isOpen() { return this.open; },
  };
  return s;
}

const stmt = (code: string): TraceEvent => ({ ts: 1, type: 'statement', context: 'session', code });
const nodeStart = (id: string): TraceEvent => ({ ts: 1, type: 'node_start', nodeId: id, parentId: null, kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' });

describe('TraceHub', () => {
  it('assigns monotonic seq numbers', () => {
    const hub = new TraceHub();
    hub.push(stmt('a'));
    hub.push(stmt('b'));
    hub.push(stmt('c'));
    expect(hub.lastSeq).toBe(3);
    const snap = hub.snapshot();
    expect(snap.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('snapshotSince returns only events after the given seq', () => {
    const hub = new TraceHub();
    hub.push(stmt('a'));
    hub.push(stmt('b'));
    hub.push(stmt('c'));
    const since = hub.snapshotSince(1);
    expect(since.events.map((e) => e.seq)).toEqual([2, 3]);
    expect(since.lastSeq).toBe(3);
  });

  it('broadcasts to attached sinks', () => {
    const hub = new TraceHub();
    const a = makeSink();
    const b = makeSink();
    hub.attach(a);
    hub.attach(b);
    hub.push(stmt('x'));
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(1);
    expect(JSON.parse(a.messages[0]!).type).toBe('trace');
  });

  it('does not broadcast to closed sinks', () => {
    const hub = new TraceHub();
    const a = makeSink();
    a.open = false;
    hub.attach(a);
    hub.push(stmt('x'));
    expect(a.messages).toHaveLength(0);
  });

  it('detach stops broadcasting', () => {
    const hub = new TraceHub();
    const a = makeSink();
    hub.attach(a);
    hub.push(stmt('x'));
    hub.detach(a);
    hub.push(stmt('y'));
    expect(a.messages).toHaveLength(1);
  });

  it('sheds ephemeral events under backpressure but keeps structural ones', () => {
    const hub = new TraceHub({ backpressureBytes: 100 });
    const a = makeSink();
    a.buffered = 200; // over the threshold
    hub.attach(a);
    // ephemeral — should be shed
    hub.push({ ts: 1, type: 'fork_queue', active: 1, queued: 0, max: 4 });
    expect(a.messages).toHaveLength(0);
    // structural — must always be sent
    hub.push(nodeStart('f1'));
    expect(a.messages).toHaveLength(1);
    expect(JSON.parse(a.messages[0]!).event.type).toBe('node_start');
  });

  it('compaction drops oldest non-structural events but retains structural ones', () => {
    const hub = new TraceHub({ maxEvents: 4 });
    hub.push(nodeStart('root'));   // structural — kept
    hub.push(stmt('a'));           // droppable
    hub.push(stmt('b'));           // droppable
    hub.push(stmt('c'));           // droppable
    hub.push(stmt('d'));           // pushes over cap → drops oldest non-structural (stmt a)
    const snap = hub.snapshot();
    expect(snap.events.length).toBeLessThanOrEqual(4);
    // The structural node_start must still be present
    expect(snap.events.some((e) => e.event.type === 'node_start')).toBe(true);
    expect(snap.truncatedBefore).toBeGreaterThan(0);
  });
});
