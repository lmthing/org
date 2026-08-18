/**
 * Live in-process embedding smoke test for the dsh harness.
 *
 * Self-skips unless LMTHING_DSH_HOME points at a BUILT deepseek-harness checkout
 * (mirrors dsh's own key-gated e2e tests), so normal CI does not depend on dsh.
 * When enabled it boots a real dsh Context in-process, drives one turn with a
 * keyless mock LLM adapter, and asserts the dsh→lmthing trace bridge produced the
 * visible answer + turn end on the SessionLike's tracer — i.e. a dsh turn renders
 * through the exact surface the pod already consumes.
 *
 * Run here with:  LMTHING_DSH_HOME=/home/user/dsh pnpm test .../session.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import type { TraceEvent } from '@lmthing/core';
import { DshSession, mockAnswerAdapter } from './session.js';
import { dshRuntimeAvailable } from './modules.js';

const enabled = dshRuntimeAvailable();

describe.skipIf(!enabled)('dsh harness — live in-process turn', () => {
  it('boots dsh and renders an answer through the trace bridge', async () => {
    const session = new DshSession({
      sessionId: 'live-1',
      persona: 'You are a test agent.',
      codeMode: false, // native tool mode — the mock adapter just answers with text
      createAdapter: mockAnswerAdapter('Hello from dsh'),
    });

    const events: TraceEvent[] = [];
    session.getTracer().subscribe((e) => events.push(e));

    await session.start('hi');
    session.dispose();

    const display = events.find((e) => e.type === 'display') as Extract<TraceEvent, { type: 'display' }> | undefined;
    expect(display?.descriptor).toBe('Hello from dsh');
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);
  }, 30_000);
});
