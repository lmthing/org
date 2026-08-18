import { describe, it, expect } from 'vitest';
import { Tracer, type TraceEvent } from '@lmthing/core';
import { createDshTraceBridge, blocksText, parseArgs, type DshSessionEvent } from './event-bridge.js';

/** Collect everything a bridge writes to a tracer. */
function record(): { tracer: Tracer; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const tracer = new Tracer(null);
  tracer.subscribe((e) => events.push(e));
  return { tracer, events };
}

const scope = { context: 'session', nodeId: 'sess-1' };

describe('extraction helpers', () => {
  it('blocksText concatenates only text blocks', () => {
    expect(blocksText([{ type: 'text', text: 'a' }, { type: 'tool-call', name: 'x' }, { type: 'text', text: 'b' }])).toBe('ab');
    expect(blocksText(undefined)).toBe('');
  });

  it('parseArgs handles JSON strings, objects, and garbage', () => {
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseArgs({ a: 1 })).toEqual({ a: 1 });
    expect(parseArgs('not json')).toEqual({ raw: 'not json' });
    expect(parseArgs(undefined)).toEqual({});
  });
});

describe('createDshTraceBridge', () => {
  it('renders an assistant text answer as display + llm_response', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Hello there' }] } } });
    expect(events.map((e) => e.type)).toEqual(['display', 'llm_response']);
    const display = events[0] as Extract<TraceEvent, { type: 'display' }>;
    expect(display.descriptor).toBe('Hello there');
    expect(display.context).toBe('session');
    expect(display.nodeId).toBe('sess-1');
    const resp = events[1] as Extract<TraceEvent, { type: 'llm_response' }>;
    expect(resp.text).toBe('Hello there');
  });

  it('emits nothing for an assistant message with no text (pure tool-call step)', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'run_code' }] } } });
    expect(events).toEqual([]);
  });

  it('renders a run_code call as a statement carrying the program', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'tool/call', data: { callId: 'c1', name: 'run_code', arguments: JSON.stringify({ code: 'await tools.bash({command:"ls"})', description: 'list' }) } });
    expect(events).toHaveLength(1);
    const stmt = events[0] as Extract<TraceEvent, { type: 'statement' }>;
    expect(stmt.type).toBe('statement');
    expect(stmt.code).toBe('await tools.bash({command:"ls"})');
  });

  it('renders a native tool call+result as yield/yield_resolved keyed by callId', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'tool/call', data: { callId: 'c9', name: 'web_search', arguments: '{"q":"cats"}' } });
    bridge({ type: 'tool/result', data: { callId: 'c9', message: { content: [{ type: 'text', text: 'results...' }] } } });
    const y = events[0] as Extract<TraceEvent, { type: 'yield' }>;
    const r = events[1] as Extract<TraceEvent, { type: 'yield_resolved' }>;
    expect(y.type).toBe('yield');
    expect(y.kind).toBe('web_search');
    expect(y.args).toEqual({ q: 'cats' });
    expect(y.yieldId).toBe('c9');
    expect(r.type).toBe('yield_resolved');
    expect(r.kind).toBe('web_search');
    expect(r.value).toBe('results...');
    expect(r.yieldId).toBe('c9');
  });

  it('does not surface a run_code tool/result (its answer arrives via assistant/message)', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'tool/call', data: { callId: 'rc', name: 'run_code', arguments: '{"code":"1"}' } });
    events.length = 0;
    bridge({ type: 'tool/result', data: { callId: 'rc', message: { content: [{ type: 'text', text: 'ignored' }] } } });
    expect(events).toEqual([]);
  });

  it('renders Code-Mode sub-dispatches as yield/yield_resolved keyed by subCallId', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'tool/code-dispatch-start', data: { subCallId: 's1', name: 'bash', arguments: { command: 'ls' } } });
    bridge({ type: 'tool/code-dispatch', data: { subCallId: 's1', name: 'bash', arguments: { command: 'ls' }, content: [{ type: 'text', text: 'demo.txt' }] } });
    expect(events.map((e) => e.type)).toEqual(['yield', 'yield_resolved']);
    const y = events[0] as Extract<TraceEvent, { type: 'yield' }>;
    expect(y.kind).toBe('bash');
    expect(y.yieldId).toBe('s1');
    const r = events[1] as Extract<TraceEvent, { type: 'yield_resolved' }>;
    expect(r.value).toBe('demo.txt');
    expect(r.yieldId).toBe('s1');
  });

  it('accumulates streaming deltas into llm_progress', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'ab' } } });
    bridge({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'cde' } } });
    const p = events.map((e) => e as Extract<TraceEvent, { type: 'llm_progress' }>);
    expect(p.map((e) => e.chars)).toEqual([2, 5]);
  });

  it('maps turn/end to turn_end with the reason kind', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    bridge({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
    const e = events[0] as Extract<TraceEvent, { type: 'turn_end' }>;
    expect(e.type).toBe('turn_end');
    expect(e.reason).toBe('completed');
  });

  it('ignores events it does not surface (step/start, user/message, …)', () => {
    const { tracer, events } = record();
    const bridge = createDshTraceBridge(tracer, scope);
    for (const type of ['turn/start', 'step/start', 'step/end', 'user/message', 'todo/write']) {
      bridge({ type } as DshSessionEvent);
    }
    expect(events).toEqual([]);
  });
});
