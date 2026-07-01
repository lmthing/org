import { describe, it, expect } from 'vitest';
import { buildModel, type WireEvent } from '../store/model.js';
import type { TraceEvent } from '@lmthing/core';
import {
  narrationOf,
  latestSubtreeStatement,
  recentSubtreeStatements,
  subtreeStmtCount,
  workDepth,
  selectActiveWork,
} from './node-meta.js';

let seq = 0;
const ev = (event: TraceEvent): WireEvent => ({ seq: ++seq, event });
function reset(): void {
  seq = 0;
}

describe('node-meta helpers', () => {
  it('narrationOf extracts the leading // comment and falls back to code', () => {
    expect(narrationOf('// Searching the web for X\nconst r = await webSearch("X")')).toBe(
      'Searching the web for X',
    );
    // A run of leading comment lines collapses into one narration string.
    expect(narrationOf('// line one\n// line two\nfoo()')).toBe('line one line two');
    // No comment → fall back to the first non-empty code line.
    expect(narrationOf('await currentTask.resolve(42)')).toBe('await currentTask.resolve(42)');
    expect(narrationOf('')).toBe('');
  });

  it('latestSubtreeStatement finds statements on the node itself', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'd1', parentId: null, kind: 'delegate', label: 'delegate:p/a/x', context: 'delegate:p/a/x', status: 'running' }),
      ev({ ts: 2, type: 'statement', context: 'd', nodeId: 'd1', code: '// first\na()' }),
      ev({ ts: 3, type: 'statement', context: 'd', nodeId: 'd1', code: '// second\nb()' }),
    ]);
    const latest = latestSubtreeStatement(m, 'd1');
    expect(latest?.code).toContain('second');
  });

  it('latestSubtreeStatement walks into a child run node (real delegate attribution)', () => {
    reset();
    // A delegate's own statements are usually attributed to an inner `run` child,
    // not the delegate node — the subtree walk must still find them.
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'd1', parentId: null, kind: 'delegate', label: 'delegate:p/a/x', context: 'delegate:p/a/x', status: 'running' }),
      ev({ ts: 2, type: 'node_start', nodeId: 'runChild', parentId: 'd1', kind: 'run', label: 'run', context: 'run', status: 'running' }),
      ev({ ts: 3, type: 'statement', context: 'run', nodeId: 'runChild', code: '// inside the delegate run\nx = 1' }),
    ]);
    expect(m.nodes['d1']!.statements).toHaveLength(0);
    const latest = latestSubtreeStatement(m, 'd1');
    expect(latest?.code).toContain('inside the delegate run');
    expect(subtreeStmtCount(m, 'd1')).toBe(1);
  });

  it('recentSubtreeStatements returns the last N by ts across the subtree', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'd1', parentId: null, kind: 'delegate', label: 'd', context: 'd', status: 'running' }),
      ev({ ts: 2, type: 'statement', context: 'd', nodeId: 'd1', code: '// a' }),
      ev({ ts: 3, type: 'statement', context: 'd', nodeId: 'd1', code: '// b' }),
      ev({ ts: 4, type: 'statement', context: 'd', nodeId: 'd1', code: '// c' }),
    ]);
    expect(recentSubtreeStatements(m, 'd1', 2).map((s) => s.code)).toEqual(['// b', '// c']);
  });

  it('workDepth counts only work-kind ancestors (excludes run/session)', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' }),
      ev({ ts: 2, type: 'node_start', nodeId: 'run1', parentId: 'sid', kind: 'run', label: 'session', context: 'session', status: 'running' }),
      ev({ ts: 3, type: 'node_start', nodeId: 'd1', parentId: 'run1', kind: 'delegate', label: 'delegate', context: 'delegate', status: 'running' }),
      ev({ ts: 4, type: 'node_start', nodeId: 'tl1', parentId: 'd1', kind: 'tasklist', label: 'tasklist', context: 'tasklist', status: 'running' }),
      ev({ ts: 5, type: 'node_start', nodeId: 'f1', parentId: 'tl1', kind: 'fork', label: 'fork', context: 'fork', status: 'running' }),
    ]);
    expect(workDepth(m, 'f1')).toBe(2); // tasklist + delegate
    expect(workDepth(m, 'tl1')).toBe(1); // delegate
    expect(workDepth(m, 'd1')).toBe(0); // only run above
  });

  it('selectActiveWork returns only non-terminal work nodes, sorted oldest-first', () => {
    reset();
    const m = buildModel([
      ev({ ts: 10, type: 'node_start', nodeId: 'd1', parentId: null, kind: 'delegate', label: 'd1', context: 'd1', status: 'running' }),
      ev({ ts: 20, type: 'node_start', nodeId: 'f1', parentId: 'd1', kind: 'fork', label: 'f1', context: 'f1', status: 'queued' }),
      ev({ ts: 30, type: 'node_start', nodeId: 'f2', parentId: 'd1', kind: 'fork', label: 'f2', context: 'f2', status: 'running' }),
      ev({ ts: 40, type: 'node_end', nodeId: 'f2', status: 'done', durationMs: 5 }),
      ev({ ts: 50, type: 'node_start', nodeId: 'run1', parentId: null, kind: 'run', label: 'run1', context: 'run1', status: 'running' }),
    ]);
    // f2 is done (excluded); run1 is a run node (excluded); d1 + f1 remain, oldest-first.
    expect(selectActiveWork(m).map((n) => n.id)).toEqual(['d1', 'f1']);
  });

  it('selectActiveWork is empty once work finishes — and nothing is persisted to the transcript', () => {
    reset();
    const m = buildModel([
      ev({ ts: 1, type: 'node_start', nodeId: 'd1', parentId: null, kind: 'delegate', label: 'd1', context: 'd1', status: 'running' }),
      ev({ ts: 2, type: 'node_end', nodeId: 'd1', status: 'done', durationMs: 9 }),
    ]);
    expect(selectActiveWork(m)).toEqual([]);
    // The ephemeral box reads the node tree only — it must leave no block behind.
    expect(m.blocks).toHaveLength(0);
  });
});
