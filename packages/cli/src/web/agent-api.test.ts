import { describe, it, expect } from 'vitest';
import { buildTraceTree } from '@repl/core';
import type { TraceEvent } from '@repl/core';
import { renderState, renderNodeDetail, HELP_TEXT } from './agent-api.js';

/** A small but representative session: session → run → fork (with an LLM retry). */
function sampleEvents(): TraceEvent[] {
  return [
    { ts: 1, type: 'session_start', sessionId: 'sid', spaceDir: '/s', agentSlug: 'a', nodeId: 'sid' },
    { ts: 2, type: 'node_start', nodeId: 'run1', parentId: 'sid', kind: 'run', label: 'session', context: 'session', status: 'running' },
    { ts: 3, type: 'llm_request', context: 'session', nodeId: 'run1', system: 'sys', messages: [{ role: 'user', content: 'go' }] },
    { ts: 4, type: 'statement', context: 'session', nodeId: 'run1', code: 'const f = await fork({})' },
    { ts: 5, type: 'node_start', nodeId: 'fork1', parentId: 'run1', kind: 'fork', label: 'fork:analyze', context: 'fork:analyze', status: 'running', detail: { role: 'explore' } },
    { ts: 6, type: 'llm_request', context: 'fork:analyze', nodeId: 'fork1', system: 'fsys', messages: [{ role: 'user', content: 'analyze' }] },
    { ts: 7, type: 'typecheck_error', context: 'fork:analyze', nodeId: 'fork1', statement: 'bad()', message: "Cannot find name 'bad'", attempt: 1 },
    { ts: 8, type: 'llm_response', context: 'fork:analyze', nodeId: 'fork1', attempt: 1, text: 'currentTask.resolve({})' },
    { ts: 9, type: 'llm_response', context: 'fork:analyze', nodeId: 'fork1', attempt: 2, text: 'currentTask.resolve({ ok: true })' },
    { ts: 10, type: 'node_end', nodeId: 'fork1', status: 'done', durationMs: 1500, result: { ok: true } },
    { ts: 11, type: 'node_end', nodeId: 'run1', status: 'done', durationMs: 2000 },
  ];
}

describe('renderState', () => {
  it('renders an indented tree with status glyphs, durations, and node ids', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderState(tree, { lastSeq: 11, asks: [] });
    expect(out).toContain('lastSeq=11');
    expect(out).toContain('sid [session]');
    expect(out).toContain('fork1 [fork] fork:analyze');
    expect(out).toContain('✓'); // done glyph
    expect(out).toContain('1.5s'); // fork duration
    // fork is indented deeper than the session
    const sidLine = out.split('\n').find((l) => l.includes('sid [session]'))!;
    const forkLine = out.split('\n').find((l) => l.includes('fork1 [fork]'))!;
    expect(forkLine.indexOf('✓') >= 0 || forkLine.indexOf('⟳') >= 0).toBe(true);
    expect(forkLine.search(/\S/)).toBeGreaterThan(sidLine.search(/\S/));
  });

  it('shows a retry count when a node had multiple LLM responses', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderState(tree, { lastSeq: 11, asks: [] });
    expect(out).toContain('×1'); // one retry (2 responses → 1 extra)
  });

  it('lists pending asks', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderState(tree, { lastSeq: 11, asks: [{ id: 'ask_1', descriptor: { type: 'TextInput' } }] });
    expect(out).toContain('Pending asks');
    expect(out).toContain('ask_1');
  });
});

describe('renderNodeDetail', () => {
  it('llm tab shows requests and all retry responses', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderNodeDetail(tree, 'fork1', 'llm');
    expect(out).toContain('LLM calls');
    expect(out).toContain('attempt 1');
    expect(out).toContain('attempt 2');
    expect(out).toContain('currentTask.resolve({ ok: true })');
  });

  it('statements tab shows code and attached typecheck errors', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderNodeDetail(tree, 'fork1', 'statements');
    expect(out).toContain("Cannot find name 'bad'");
    expect(out).toContain('typecheck error');
  });

  it('reports node result', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderNodeDetail(tree, 'fork1', 'llm');
    expect(out).toContain('Result');
    expect(out).toContain('"ok":true');
  });

  it('handles unknown node ids gracefully', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderNodeDetail(tree, 'nope', 'llm');
    expect(out).toContain('not found');
  });

  it('unknown tab lists valid tabs', () => {
    const tree = buildTraceTree(sampleEvents());
    const out = renderNodeDetail(tree, 'fork1', 'bogus');
    expect(out).toContain('llm|statements|yields|variables|raw');
  });
});

describe('HELP_TEXT', () => {
  it('documents the core endpoints', () => {
    expect(HELP_TEXT).toContain('/api/state');
    expect(HELP_TEXT).toContain('/api/node/');
    expect(HELP_TEXT).toContain('/api/events');
    expect(HELP_TEXT).toContain('/api/message');
    expect(HELP_TEXT).toContain('/api/ui');
  });
});
