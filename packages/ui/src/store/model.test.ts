import { describe, it, expect } from 'vitest';
import { buildModel, type WireEvent } from './model.js';
import type { TraceEvent } from '@repl/core';

let seq = 0;
const ev = (event: TraceEvent): WireEvent => ({ seq: ++seq, event });

function reset(): void { seq = 0; }

describe('store model reducer', () => {
  it('builds the session → fork hierarchy from node events', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' }),
      ev({ ts: 2, type: 'node_start', nodeId: 'run1', parentId: 'sid', kind: 'run', label: 'session', context: 'session', status: 'running' }),
      ev({ ts: 3, type: 'node_start', nodeId: 'fork1', parentId: 'run1', kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' }),
      ev({ ts: 4, type: 'node_end', nodeId: 'fork1', status: 'done', durationMs: 100, result: { ok: true } }),
    ]);
    expect(m.rootId).toBe('sid');
    expect(m.nodes['sid']!.childIds).toContain('run1');
    expect(m.nodes['run1']!.childIds).toContain('fork1');
    expect(m.nodes['fork1']!.status).toBe('done');
    expect(m.nodes['fork1']!.result).toEqual({ ok: true });
  });

  it('does NOT create a phantom node for a node-less fork_queue event', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' }),
      ev({ ts: 2, type: 'fork_queue', active: 1, queued: 0, max: 4 }),
    ]);
    // Only the session node exists — no legacy_session phantom.
    expect(Object.keys(m.nodes)).toEqual(['sid']);
    expect(m.nodes['sid']!.queue).toEqual({ active: 1, queued: 0, max: 4 });
    // And nothing is stuck "running" besides the (alive) session root.
    const running = Object.values(m.nodes).filter((n) => n.status === 'running');
    expect(running.map((n) => n.id)).toEqual(['sid']);
  });

  it('buckets statements, llm calls, and yields onto the right node', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'n1', parentId: null, kind: 'run', label: 'session', context: 'session', status: 'running' }),
      ev({ ts: 2, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'hi' }] }),
      ev({ ts: 3, type: 'statement', context: 'session', nodeId: 'n1', code: 'const f = await fork({})' }),
      ev({ ts: 4, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 1, text: 'done' }),
      ev({ ts: 5, type: 'yield', context: 'session', nodeId: 'n1', kind: 'fork', args: {}, yieldId: 'y1' }),
      ev({ ts: 6, type: 'yield_resolved', context: 'session', nodeId: 'n1', kind: 'fork', value: { x: 1 }, yieldId: 'y1' }),
    ]);
    const n = m.nodes['n1']!;
    expect(n.llmCalls).toHaveLength(1);
    expect(n.llmCalls[0]!.responses[0]!.text).toBe('done');
    expect(n.statements).toHaveLength(1);
    expect(n.yields[0]!.resolved).toBe(true);
    expect(n.yields[0]!.value).toEqual({ x: 1 });
  });

  it('display events become conversation blocks attributed to their node', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'fork1', parentId: null, kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' }),
      ev({ ts: 2, type: 'display', context: 'fork:x', nodeId: 'fork1', descriptor: 'hello world' }),
    ]);
    expect(m.blocks).toHaveLength(1);
    expect(m.blocks[0]!.type).toBe('display');
    expect(m.blocks[0]!.nodeId).toBe('fork1');
  });

  it('legacy traces (no nodeId) still build a flat tree from context labels', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a' }),
      ev({ ts: 2, type: 'statement', context: 'session', code: 'const a = 1' }),
      ev({ ts: 3, type: 'statement', context: 'fork:plan', code: 'const b = 2' }),
    ]);
    const session = Object.values(m.nodes).find((n) => n.label === 'session');
    const fork = Object.values(m.nodes).find((n) => n.label === 'fork:plan');
    expect(session).toBeDefined();
    expect(fork).toBeDefined();
    expect(fork!.parentId).toBe(session!.id);
  });

  it('replay reconstruction: buildModel over a prefix equals the live state at that point', () => {
    reset();
    const events = [
      ev({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' }),
      ev({ ts: 2, type: 'node_start', nodeId: 'fork1', parentId: 'sid', kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' }),
      ev({ ts: 3, type: 'node_end', nodeId: 'fork1', status: 'done', durationMs: 50 }),
    ];
    // Seek to cursor=2 (before fork ends) → fork should be running.
    const atTwo = buildModel(events.slice(0, 2));
    expect(atTwo.nodes['fork1']!.status).toBe('running');
    // Full → fork done.
    const full = buildModel(events);
    expect(full.nodes['fork1']!.status).toBe('done');
  });
});
