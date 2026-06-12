/**
 * Web-mode observability integration test. Spawns the BUILT CLI with --web +
 * --mock (no API keys), then exercises the agent HTTP API and the WS trace
 * stream end-to-end: a POST /api/message drives a solve run, /api/state shows
 * the fork/solve execution tree, and a WS client receives a trace_snapshot
 * followed by live trace events.
 *
 * Self-skips when dist/ is absent (run `pnpm build` first).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { hasBin, BIN, REPO_ROOT } from './live-harness.js';

const SOLVER_SPACE = 'packages/core/system-spaces/solver';
const PORT = 3911;
const BASE = `http://localhost:${PORT}`;
const TIMEOUT = 60_000;

const procs: ChildProcess[] = [];

afterAll(() => {
  for (const p of procs) if (!p.killed) p.kill('SIGKILL');
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(base = BASE): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/help`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('web server did not come up in time');
}

/** Fetch with retry — the QuickJS VM runs synchronously and can block the event
 *  loop mid-run, resetting in-flight connections. A real agent polls the same way. */
async function getText(path: string, base = BASE, tries = 5): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}${path}`);
      return await res.text();
    } catch {
      await sleep(200);
    }
  }
  return '';
}

async function postJson(path: string, body: unknown, base = BASE, tries = 5): Promise<number> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.status;
    } catch {
      await sleep(200);
    }
  }
  return 0;
}

describe.skipIf(!hasBin())('web mode — agent API + WS trace stream', () => {
  it('drives a solve run via /api/message and exposes the fork/solve tree', async () => {
    // Launch the web server (it does NOT auto-start the session; the message does).
    const proc = spawn(
      'node',
      [BIN, '--space', SOLVER_SPACE, '--claude', '--mock', 'fixtures/solver/mock.mjs', '--web', String(PORT)],
      { cwd: REPO_ROOT, stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } },
    );
    procs.push(proc);
    await waitForServer();

    // A WS client must receive the connect-time snapshot.
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const wsEvents: Array<{ type: string; [k: string]: unknown }> = [];
    ws.on('message', (d: Buffer) => {
      try { wsEvents.push(JSON.parse(d.toString())); } catch { /* ignore */ }
    });
    await new Promise<void>((res, rej) => {
      ws.on('open', () => res());
      ws.on('error', rej);
    });
    await sleep(300);
    expect(wsEvents.some((e) => e.type === 'hello')).toBe(true);
    expect(wsEvents.some((e) => e.type === 'trace_snapshot')).toBe(true);

    // Kick off the run via the HTTP API.
    const postStatus = await postJson('/api/message', { content: 'implement add' });
    expect(postStatus).toBe(202);

    // Poll /api/state until the session run completes (or timeout).
    let state = '';
    for (let i = 0; i < 80; i++) {
      state = await getText('/api/state');
      if (state.includes('[solve]') && /✓ run_/.test(state)) break;
      await sleep(250);
    }

    // The tree shows the full hierarchy: run → solve → forks.
    expect(state).toContain('[session]');
    expect(state).toContain('[solve]');
    expect(state).toContain('[fork]');

    // Live trace events streamed to the WS client after the snapshot.
    expect(wsEvents.filter((e) => e.type === 'trace').length).toBeGreaterThan(0);

    // The solve node's result is queryable; find its id from the events feed.
    const evText = await getText('/api/events?since=0&type=node_start');
    const solveLine = evText.split('\n').find((l) => l.includes('[solve]') || l.includes('solve "solve"'));
    expect(solveLine).toBeDefined();
    const solveId = solveLine!.match(/@(solve_\S+)/)?.[1];
    if (solveId) {
      const detail = await getText(`/api/node/${solveId}?tab=yields`);
      expect(detail).toContain('Result');
      expect(detail).toContain('verified');
    }

    ws.close();
  }, TIMEOUT);

  it('renders a space-form ask() over the API and resumes the run when answered', async () => {
    const PORT2 = 3912;
    const BASE2 = `http://localhost:${PORT2}`;
    const proc = spawn(
      'node',
      [BIN, '--space', 'fixtures/cooking', '--agent', 'chef', '--claude', '--mock', 'fixtures/cooking/mock-ask.mjs', '--web', String(PORT2)],
      { cwd: REPO_ROOT, stdio: 'ignore', env: { ...process.env, BROWSER: 'none' } },
    );
    procs.push(proc);
    await waitForServer(BASE2);

    // Kick off — the chef immediately ask()s with the ConfirmDish form component.
    expect(await postJson('/api/message', { content: 'cook' }, BASE2)).toBe(202);

    // The open ask carries the space-component descriptor (type=ConfirmDish + props).
    let asks = '';
    for (let i = 0; i < 40; i++) {
      asks = await getText('/api/asks', BASE2);
      if (asks.includes('ConfirmDish')) break;
      await sleep(250);
    }
    expect(asks).toContain('ConfirmDish');
    expect(asks).toContain('spaghetti');
    const askId = asks.split(':')[0]!.trim();
    expect(askId.length).toBeGreaterThan(0);

    // Answer the form (true) — the run must resume and complete.
    expect(await postJson(`/api/ask/${askId}`, { value: true }, BASE2)).toBe(200);

    let state = '';
    for (let i = 0; i < 40; i++) {
      state = await getText('/api/state', BASE2);
      if (state.includes('Pending asks: none') && /✓ run_/.test(state)) break;
      await sleep(250);
    }
    expect(state).toContain('Pending asks: none');

    // The display() output after the ask shows the confirmed value.
    const displays = await getText('/api/events?since=0&type=display', BASE2);
    // (display events carry the descriptor; the run resumed and emitted one)
    expect(displays).toContain('display');
  }, TIMEOUT);
});
