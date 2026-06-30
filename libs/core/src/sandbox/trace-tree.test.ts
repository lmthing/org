import { describe, it, expect } from 'vitest';
import { buildTraceTree, applyEvent } from './trace-tree.js';
import { Tracer } from './trace.js';
import type { TraceEvent } from './trace.js';

// ─── buildTraceTree — new format events ─────────────────────────────────────

describe('buildTraceTree — new format (nodeId present)', () => {
  it('builds a single session node from session_start', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' },
    ];
    const tree = buildTraceTree(events);
    expect(tree.rootId).toBe('sid');
    expect(tree.nodes['sid']?.kind).toBe('session');
    expect(tree.nodes['sid']?.status).toBe('running');
  });

  it('nests fork under session via node_start', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' },
      { ts: 2, type: 'node_start', nodeId: 'fork_1', parentId: 'sid', kind: 'fork', label: 'fork:plan', context: 'fork:plan', status: 'running' },
    ];
    const tree = buildTraceTree(events);
    expect(tree.nodes['sid']!.childIds).toContain('fork_1');
    expect(tree.nodes['fork_1']!.parentId).toBe('sid');
    expect(tree.nodes['fork_1']!.kind).toBe('fork');
  });

  it('tasklist nests tasks under it', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'tl_1', parentId: null, kind: 'tasklist', label: 'synthesize', context: 'tasklist', status: 'running' },
      { ts: 2, type: 'node_start', nodeId: 'task_1', parentId: 'tl_1', kind: 'task', label: 'fork:1-research', context: 'fork:1-research', status: 'running', detail: { dependsOn: [], goal: false } },
      { ts: 3, type: 'node_start', nodeId: 'task_2', parentId: 'tl_1', kind: 'task', label: 'fork:2-write', context: 'fork:2-write', status: 'running', detail: { dependsOn: ['1-research'], goal: true } },
    ];
    const tree = buildTraceTree(events);
    expect(tree.nodes['tl_1']!.childIds).toHaveLength(2);
    expect(tree.nodes['task_2']!.detail?.dependsOn).toEqual(['1-research']);
  });

  it('node_end marks status and sets durationMs', () => {
    const events: TraceEvent[] = [
      { ts: 100, type: 'node_start', nodeId: 'f1', parentId: null, kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' },
      { ts: 250, type: 'node_end', nodeId: 'f1', status: 'done', durationMs: 150 },
    ];
    const tree = buildTraceTree(events);
    expect(tree.nodes['f1']!.status).toBe('done');
    expect(tree.nodes['f1']!.durationMs).toBe(150);
  });

  it('skipped task gets status skipped from node_end', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'task_skip', parentId: 'tl_1', kind: 'task', label: 'fork:optional', context: 'fork:optional', status: 'running', detail: { optional: true } },
      { ts: 2, type: 'node_end', nodeId: 'task_skip', status: 'skipped', durationMs: 0 },
    ];
    const tree = buildTraceTree(events);
    expect(tree.nodes['task_skip']!.status).toBe('skipped');
  });

  it('yields are paired by yieldId', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'n1', parentId: null, kind: 'run', label: 'session', context: 'session', status: 'running' },
      { ts: 2, type: 'yield', context: 'session', nodeId: 'n1', kind: 'fork', args: {}, yieldId: 'y1' },
      { ts: 3, type: 'yield', context: 'session', nodeId: 'n1', kind: 'fork', args: {}, yieldId: 'y2' },
      { ts: 4, type: 'yield_resolved', context: 'session', nodeId: 'n1', kind: 'fork', value: 'r1', yieldId: 'y1' },
    ];
    const tree = buildTraceTree(events);
    const yields = tree.nodes['n1']!.yields;
    expect(yields).toHaveLength(2);
    expect(yields.find((y) => y.yieldId === 'y1')?.resolved).toBe(true);
    expect(yields.find((y) => y.yieldId === 'y2')?.resolved).toBe(false);
  });

  it('llm_request and llm_response are bucketed per node', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'n1', parentId: null, kind: 'run', label: 'session', context: 'session', status: 'running' },
      { ts: 2, type: 'llm_request', context: 'session', nodeId: 'n1', system: 'sys', messages: [{ role: 'user', content: 'hi' }] },
      { ts: 3, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 1, text: 'display("done")' },
    ];
    const tree = buildTraceTree(events);
    const node = tree.nodes['n1']!;
    expect(node.llmCalls).toHaveLength(1);
    expect(node.llmCalls[0]!.responses).toHaveLength(1);
    expect(node.llmCalls[0]!.responses[0]!.text).toBe('display("done")');
  });

  it('statement errors are attached to the statement entry', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'n1', parentId: null, kind: 'run', label: 'session', context: 'session', status: 'running' },
      { ts: 2, type: 'statement', context: 'session', nodeId: 'n1', code: 'const x = badFn()' },
      { ts: 3, type: 'typecheck_error', context: 'session', nodeId: 'n1', statement: 'const x = badFn()', message: "Cannot find name 'badFn'", attempt: 1 },
    ];
    const tree = buildTraceTree(events);
    const stmts = tree.nodes['n1']!.statements;
    expect(stmts).toHaveLength(1);
    expect(stmts[0]!.errors).toHaveLength(1);
    expect(stmts[0]!.errors[0]!.phase).toBe('typecheck');
  });

  it('out-of-order node_end before node_start is handled gracefully', () => {
    const events: TraceEvent[] = [
      { ts: 2, type: 'node_end', nodeId: 'early', status: 'done', durationMs: 100 },
      { ts: 1, type: 'node_start', nodeId: 'early', parentId: null, kind: 'fork', label: 'fork:x', context: 'fork:x', status: 'running' },
    ];
    const tree = buildTraceTree(events);
    expect(tree.nodes['early']!.status).toBe('done');
  });

  it('rawEvents accumulates all events and eventIdxs reference them', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'node_start', nodeId: 'n1', parentId: null, kind: 'run', label: 'session', context: 'session', status: 'running' },
      { ts: 2, type: 'statement', context: 'session', nodeId: 'n1', code: 'display("hi")' },
      { ts: 3, type: 'node_end', nodeId: 'n1', status: 'done', durationMs: 10 },
    ];
    const tree = buildTraceTree(events);
    expect(tree.rawEvents).toHaveLength(3);
    expect(tree.nodes['n1']!.eventIdxs).toHaveLength(3);
    expect(tree.nodes['n1']!.eventIdxs[1]).toBe(1); // statement is index 1
  });
});

// ─── buildTraceTree — legacy format (no nodeId) ──────────────────────────────

describe('buildTraceTree — legacy fallback (no nodeId)', () => {
  it('groups events under synthetic nodes derived from context label', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a' },
      { ts: 2, type: 'statement', context: 'session', code: 'display("a")' },
      { ts: 3, type: 'statement', context: 'fork:plan', code: 'display("b")' },
    ];
    const tree = buildTraceTree(events);
    expect(tree.rootId).toBeTruthy();
    const sessionNode = Object.values(tree.nodes).find((n) => n.label === 'session');
    const forkNode = Object.values(tree.nodes).find((n) => n.label === 'fork:plan');
    expect(sessionNode).toBeDefined();
    expect(forkNode).toBeDefined();
    expect(sessionNode!.statements).toHaveLength(1);
    expect(forkNode!.statements).toHaveLength(1);
    expect(forkNode!.kind).toBe('fork');
  });

  it('legacy fork nodes are parented under the session node', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a' },
      { ts: 2, type: 'statement', context: 'fork:analyze', code: 'const x = 1' },
    ];
    const tree = buildTraceTree(events);
    const forkNode = Object.values(tree.nodes).find((n) => n.label === 'fork:analyze');
    const sessionNode = Object.values(tree.nodes).find((n) => n.label === 'session');
    expect(forkNode?.parentId).toBe(sessionNode?.id);
  });

  it('same context label always resolves to the same synthetic nodeId', () => {
    const events: TraceEvent[] = [
      { ts: 1, type: 'statement', context: 'fork:plan', code: 'const a = 1' },
      { ts: 2, type: 'statement', context: 'fork:plan', code: 'const b = 2' },
    ];
    const tree = buildTraceTree(events);
    const forkNodes = Object.values(tree.nodes).filter((n) => n.label === 'fork:plan');
    expect(forkNodes).toHaveLength(1);
    expect(forkNodes[0]!.statements).toHaveLength(2);
  });
});

// ─── Tracer scope helpers produce correct tree events ───────────────────────

describe('Tracer → buildTraceTree integration', () => {
  it('child/end emits form a correct tree', () => {
    const t = new Tracer(null);
    const collected: TraceEvent[] = [];
    t.subscribe((e) => collected.push(e));

    const root = t.root('sid');
    t.write({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' });
    const fork = t.child(root, 'fork', 'fork:analyze', { role: 'explore' });
    t.end(fork, 'done', { result: { summary: 'ok' } });

    const tree = buildTraceTree(collected);
    expect(tree.nodes[fork.nodeId]!.status).toBe('done');
    expect(tree.nodes[fork.nodeId]!.result).toEqual({ summary: 'ok' });
    expect(tree.nodes['sid']!.childIds).toContain(fork.nodeId);
  });
});
