import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tracer, NULL_TRACER } from './trace.js';
import type { TraceEvent } from './trace.js';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── NULL_TRACER ────────────────────────────────────────────────────────────

describe('NULL_TRACER', () => {
  it('is a no-op — write does not throw', () => {
    expect(() => NULL_TRACER.write({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' })).not.toThrow();
  });
  it('subscribe/unsubscribe works on NULL_TRACER', () => {
    const events: TraceEvent[] = [];
    const unsub = NULL_TRACER.subscribe((e) => events.push(e));
    NULL_TRACER.write({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' });
    expect(events).toHaveLength(1);
    unsub();
    NULL_TRACER.write({ ts: 2, type: 'turn_end', context: 'session', reason: 'done' });
    expect(events).toHaveLength(1); // stopped after unsub
  });
});

// ─── Tracer file sink ───────────────────────────────────────────────────────

describe('Tracer file sink', () => {
  let tracePath: string;

  beforeEach(() => {
    tracePath = join(tmpdir(), `trace-test-${Date.now()}.jsonl`);
  });

  it('writes events as NDJSON lines', () => {
    const t = new Tracer(tracePath);
    t.write({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a' });
    t.write({ ts: 2, type: 'turn_end', context: 'session', reason: 'done' });
    const lines = readFileSync(tracePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).type).toBe('session_start');
    expect(JSON.parse(lines[1]!).type).toBe('turn_end');
    unlinkSync(tracePath);
  });

  it('does NOT write llm_progress to file', () => {
    const t = new Tracer(tracePath);
    t.write({ ts: 1, type: 'llm_progress', context: 'session', chars: 10, statements: 1 });
    expect(existsSync(tracePath)).toBe(false);
  });

  it('writes llm_progress to subscribers even though skipped from file', () => {
    const t = new Tracer(null);
    const collected: TraceEvent[] = [];
    t.subscribe((e) => collected.push(e));
    t.write({ ts: 1, type: 'llm_progress', context: 'session', chars: 50, statements: 2 });
    expect(collected).toHaveLength(1);
    expect(collected[0]!.type).toBe('llm_progress');
  });
});

// ─── subscribe / unsubscribe ────────────────────────────────────────────────

describe('Tracer.subscribe', () => {
  it('fans out to multiple subscribers', () => {
    const t = new Tracer(null);
    const a: TraceEvent[] = [];
    const b: TraceEvent[] = [];
    t.subscribe((e) => a.push(e));
    t.subscribe((e) => b.push(e));
    t.write({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('unsubscribe removes the listener', () => {
    const t = new Tracer(null);
    const events: TraceEvent[] = [];
    const unsub = t.subscribe((e) => events.push(e));
    t.write({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' });
    unsub();
    t.write({ ts: 2, type: 'turn_end', context: 'session', reason: 'done' });
    expect(events).toHaveLength(1);
  });

  it('a throwing subscriber does not prevent other subscribers or writes', () => {
    const t = new Tracer(null);
    const good: TraceEvent[] = [];
    t.subscribe(() => { throw new Error('bad subscriber'); });
    t.subscribe((e) => good.push(e));
    expect(() => t.write({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' })).not.toThrow();
    expect(good).toHaveLength(1);
  });
});

// ─── child / end scope helpers ──────────────────────────────────────────────

describe('Tracer.child / end', () => {
  it('child emits node_start and returns a scope with a unique nodeId', () => {
    const t = new Tracer(null);
    const events: TraceEvent[] = [];
    t.subscribe((e) => events.push(e));

    const root = t.root('session-123');
    const child = t.child(root, 'fork', 'fork:plan');

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('node_start');
    if (ev.type === 'node_start') {
      expect(ev.kind).toBe('fork');
      expect(ev.label).toBe('fork:plan');
      expect(ev.parentId).toBe('session-123');
      expect(ev.nodeId).toBe(child.nodeId);
    }
  });

  it('two parallel child() calls produce distinct nodeIds', () => {
    const t = new Tracer(null);
    const root = t.root('s');
    const c1 = t.child(root, 'fork', 'fork:plan');
    const c2 = t.child(root, 'fork', 'fork:plan');
    expect(c1.nodeId).not.toBe(c2.nodeId);
  });

  it('end emits node_end with durationMs ≥ 0', async () => {
    const t = new Tracer(null);
    const events: TraceEvent[] = [];
    t.subscribe((e) => events.push(e));

    const root = t.root('s');
    const child = t.child(root, 'fork', 'fork:analyze');
    t.end(child, 'done');

    const endEv = events.find((e) => e.type === 'node_end');
    expect(endEv).toBeDefined();
    if (endEv?.type === 'node_end') {
      expect(endEv.nodeId).toBe(child.nodeId);
      expect(endEv.status).toBe('done');
      expect(endEv.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('end with error attaches the error string', () => {
    const t = new Tracer(null);
    const events: TraceEvent[] = [];
    t.subscribe((e) => events.push(e));

    const root = t.root('s');
    const child = t.child(root, 'delegate', 'delegate:pkg/a/b');
    t.end(child, 'error', { error: 'timed out' });

    const endEv = events.find((e) => e.type === 'node_end');
    if (endEv?.type === 'node_end') {
      expect(endEv.status).toBe('error');
      expect(endEv.error).toBe('timed out');
    }
  });

  it('activate emits node_update running', () => {
    const t = new Tracer(null);
    const events: TraceEvent[] = [];
    t.subscribe((e) => events.push(e));

    const root = t.root('s');
    const child = t.child(root, 'fork', 'fork:x', undefined, 'queued');
    t.activate(child);

    const updateEv = events.find((e) => e.type === 'node_update');
    expect(updateEv?.type).toBe('node_update');
    if (updateEv?.type === 'node_update') {
      expect(updateEv.status).toBe('running');
    }
  });
});
