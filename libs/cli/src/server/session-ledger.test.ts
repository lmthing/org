/**
 * SessionLedger ({@link ./session-ledger.ts}) — the pod-global record of every
 * session (chat + hook/code-node) and the delegates each made.
 *
 * Covers:
 *   - a session's own token/cost totals sum ALL llm_response turns;
 *   - a delegate node captures its inputs (`query`) + per-delegate tokens;
 *   - tokens attribute to the NEAREST enclosing delegate (a nested delegate is
 *     not double-counted into its parent), including tokens emitted under a fork
 *     child of the delegate (roll-up via the parent chain);
 *   - finalize() settles status/endedAt;
 *   - JSONL persistence reloads collapsed by sessionId.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TraceEvent } from '@lmthing/core';

import { SessionLedger } from './session-ledger.js';

// A minimal price table: model "m" costs $1/1K in, $2/1K out.
const PRICES = { m: { inputPer1K: 1, outputPer1K: 2 } };

/** A stand-in tracer that just fans events to subscribers (like the real one). */
function fakeTracer() {
  const subs: Array<(e: TraceEvent) => void> = [];
  return {
    subscribe(fn: (e: TraceEvent) => void) {
      subs.push(fn);
      return () => {};
    },
    emit(e: TraceEvent) {
      for (const fn of subs) fn(e);
    },
  };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledger-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

describe('SessionLedger', () => {
  it('records a chat session with a delegate carrying inputs + per-delegate tokens', () => {
    const ledger = new SessionLedger(join(dir, 'l.jsonl'), PRICES);
    const t = fakeTracer();
    ledger.trackTracer(t, { source: 'chat', sessionId: 's1', projectId: 'p1' });

    // A top-level (session's own) turn.
    t.emit({ ts: 1, type: 'llm_response', context: 'session', nodeId: 's1', attempt: 1, text: '', model: 'm', inputTokens: 100, outputTokens: 10 });
    // The session opens a delegate.
    t.emit({ ts: 2, type: 'node_start', nodeId: 'd1', parentId: 's1', kind: 'delegate', label: 'delegate:pkg/agent', context: 'delegate', status: 'running', detail: { pkg: 'pkg', agent: 'agent', action: 'go', depth: 0, query: 'do the thing' } });
    // A turn INSIDE the delegate (nodeId is the delegate node itself).
    t.emit({ ts: 3, type: 'llm_response', context: 'delegate', nodeId: 'd1', attempt: 1, text: '', model: 'm', inputTokens: 200, outputTokens: 20 });
    // A fork spawned inside the delegate, and a turn under the fork.
    t.emit({ ts: 4, type: 'node_start', nodeId: 'f1', parentId: 'd1', kind: 'fork', label: 'fork:1', context: 'fork', status: 'running' });
    t.emit({ ts: 5, type: 'llm_response', context: 'fork', nodeId: 'f1', attempt: 1, text: '', model: 'm', inputTokens: 50, outputTokens: 5 });
    t.emit({ ts: 6, type: 'node_end', nodeId: 'd1', status: 'done', durationMs: 1234 });

    const [rec] = ledger.list();
    expect(rec.sessionId).toBe('s1');
    expect(rec.source).toBe('chat');
    expect(rec.projectId).toBe('p1');
    // Session totals = ALL turns: (100+200+50) in, (10+20+5) out.
    expect(rec.totalInputTokens).toBe(350);
    expect(rec.totalOutputTokens).toBe(35);
    // Cost = 350/1000*1 + 35/1000*2 = 0.35 + 0.07.
    expect(rec.totalCostUsd).toBeCloseTo(0.42, 6);

    expect(rec.delegates).toHaveLength(1);
    const d = rec.delegates[0]!;
    expect(d.target).toBe('pkg/agent#go');
    expect(d.query).toBe('do the thing');
    expect(d.depth).toBe(0);
    expect(d.durationMs).toBe(1234);
    expect(d.status).toBe('done');
    // Per-delegate = the delegate's own turn (200/20) + its fork child turn (50/5).
    expect(d.inputTokens).toBe(250);
    expect(d.outputTokens).toBe(25);
    expect(d.costUsd).toBeCloseTo(0.25 + 0.05, 6);
  });

  it('attributes tokens to the nearest delegate — no double-count into the parent', () => {
    const ledger = new SessionLedger(null, PRICES);
    const t = fakeTracer();
    ledger.trackTracer(t, { source: 'chat', sessionId: 's2' });

    // Outer delegate → inner delegate nested inside it.
    t.emit({ ts: 1, type: 'node_start', nodeId: 'outer', parentId: 's2', kind: 'delegate', label: 'd', context: 'd', status: 'running', detail: { pkg: 'a', agent: 'outer', depth: 0 } });
    t.emit({ ts: 2, type: 'llm_response', context: 'd', nodeId: 'outer', attempt: 1, text: '', model: 'm', inputTokens: 100, outputTokens: 0 });
    t.emit({ ts: 3, type: 'node_start', nodeId: 'inner', parentId: 'outer', kind: 'delegate', label: 'd', context: 'd', status: 'running', detail: { pkg: 'a', agent: 'inner', depth: 1 } });
    t.emit({ ts: 4, type: 'llm_response', context: 'd', nodeId: 'inner', attempt: 1, text: '', model: 'm', inputTokens: 30, outputTokens: 0 });
    t.emit({ ts: 5, type: 'node_end', nodeId: 'inner', status: 'done', durationMs: 5 });
    t.emit({ ts: 6, type: 'node_end', nodeId: 'outer', status: 'done', durationMs: 9 });

    const [rec] = ledger.list();
    const outer = rec.delegates.find((d) => d.target.endsWith('outer'))!;
    const inner = rec.delegates.find((d) => d.target.endsWith('inner'))!;
    expect(outer.inputTokens).toBe(100); // NOT 130
    expect(outer.depth).toBe(0);
    expect(inner.inputTokens).toBe(30);
    expect(inner.depth).toBe(1);
    // Session total still counts everything once.
    expect(rec.totalInputTokens).toBe(130);
  });

  it('finalize() settles status + endedAt and orphaned delegates', () => {
    const ledger = new SessionLedger(null, PRICES);
    const t = fakeTracer();
    ledger.trackTracer(t, { source: 'hook:daily', sessionId: 's3', projectId: 'p1' });
    t.emit({ ts: 1, type: 'node_start', nodeId: 'd', parentId: 's3', kind: 'delegate', label: 'd', context: 'd', status: 'running', detail: { pkg: 'a', agent: 'b', depth: 0 } });
    ledger.finalize('s3', 'done');
    const [rec] = ledger.list();
    expect(rec.status).toBe('done');
    expect(rec.endedAt).toBeGreaterThan(0);
    expect(rec.delegates[0]!.status).toBe('done'); // orphaned running → settled
    expect(rec.source).toBe('hook:daily');
  });

  it('persists to JSONL and reloads collapsed by sessionId', () => {
    const file = join(dir, 'l.jsonl');
    const l1 = new SessionLedger(file, PRICES);
    const t = fakeTracer();
    l1.trackTracer(t, { source: 'chat', sessionId: 's4' });
    t.emit({ ts: 1, type: 'llm_response', context: 'session', nodeId: 's4', attempt: 1, text: '', model: 'm', inputTokens: 10, outputTokens: 1 });
    l1.finalize('s4', 'done'); // flush

    // A fresh ledger over the same file sees exactly one collapsed record.
    const l2 = new SessionLedger(file, PRICES);
    const list = l2.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.sessionId).toBe('s4');
    expect(list[0]!.totalInputTokens).toBe(10);
  });
});
