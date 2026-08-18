/**
 * Live in-process embedding smoke test for the dsh harness.
 *
 * Self-skips unless LMTHING_DSH_HOME points at a BUILT deepseek-harness checkout
 * (mirrors dsh's own key-gated e2e tests), so normal CI does not depend on dsh.
 * When enabled it boots a real dsh Context in-process, loads a real lmthing space
 * (persona + a function registered as a dsh tool), drives one turn with a keyless
 * mock LLM adapter, and asserts the dsh→lmthing trace bridge produced the visible
 * answer + turn end on the SessionLike's tracer.
 *
 * Proves three integration points at once: the embed boots, an lmthing space's
 * persona + `functions:` register onto the dsh agent (Stage 3), and dsh events
 * render through the exact surface the pod already consumes.
 *
 * Run here with:  LMTHING_DSH_HOME=/home/user/dsh pnpm test .../session.live.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TraceEvent } from '@lmthing/core';
import { DshSession, mockAnswerSetup } from './session.js';
import { dshRuntimeAvailable } from './modules.js';

const enabled = dshRuntimeAvailable();

describe.skipIf(!enabled)('dsh harness — live in-process turn', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-live-'));
    const agent = join(root, 'agents', 'thing');
    mkdirSync(agent, { recursive: true });
    writeFileSync(join(agent, 'charter.md'), 'You are THING.');
    writeFileSync(join(agent, 'instruct.md'), ['---', 'title: Thing', 'functions:', '  - double', '---', 'Double numbers.'].join('\n'));
    const fns = join(root, 'functions');
    mkdirSync(fns, { recursive: true });
    writeFileSync(join(fns, 'double.ts'), 'export default (a: { x: number }) => a.x * 2;\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('boots dsh, loads a space (persona + function-tool), and renders an answer', async () => {
    const session = new DshSession({
      sessionId: 'live-1',
      spaceDir: root,
      agentSlug: 'thing',
      codeMode: false, // native tool mode — the mock adapter just answers with text
      llm: mockAnswerSetup('Hello from dsh'),
    });

    const events: TraceEvent[] = [];
    session.getTracer().subscribe((e) => events.push(e));

    // If the space's persona or its `double` function-tool failed to register,
    // agent creation would throw here — so a clean turn proves that wiring too.
    await session.start('hi');
    session.dispose();

    const display = events.find((e) => e.type === 'display') as Extract<TraceEvent, { type: 'display' }> | undefined;
    expect(display?.descriptor).toBe('Hello from dsh');
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);
  }, 30_000);
});
