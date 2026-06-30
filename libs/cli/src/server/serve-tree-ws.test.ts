/**
 * Project multi-session server — WS trace delivery for the execution tree.
 *
 * Regression guard: after the session-persistence commit, the web execution
 * tree stopped showing delegate/fork child nodes even though the run produced
 * them. This drives the FULL project-server path (startSessionServer +
 * lmthingRoot + a real delegate) and asserts the WS client receives the
 * run + delegate `node_start` events — not just the session root.
 *
 * Keyless (mock provider).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Session, mockMatch } from '@lmthing/core';
import type { StreamOpts, StreamSession } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';
import { startSessionServer } from './serve.js';
import type { SessionServerHandle } from './serve.js';

// Anchor file 3 levels under libs/cli so serve.ts can resolve UI assets.
const APP_TSX_PATH = fileURLToPath(new URL('./serve.ts', import.meta.url));

const tmpDirs: string[] = [];
const servers: SessionServerHandle[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeAgent(dir: string, slug: string, body: string): Promise<void> {
  const f = join(dir, 'agents', slug, 'instruct.md');
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, body, 'utf8');
}

async function startProjectServer(root: string, streamFn: (opts: StreamOpts) => Promise<StreamSession>): Promise<string> {
  const manager = new SessionManager({
    streamFn,
    lmthingRoot: root,
    snapshotsDir: join(root, '.snaps'),
    buildSession: (args: BuildSessionArgs) =>
      new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [],
          preloadSpaceDirs: args.preloadSpaceDirs,
        },
        { streamFn },
      ),
  });
  const handle = await startSessionServer({
    port: 0,
    manager,
    appTsxPath: APP_TSX_PATH,
    lmthingRoot: root,
  });
  servers.push(handle);
  return `http://localhost:${handle.port}`;
}

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('project server WS — execution tree receives delegate child nodes', () => {
  it('client gets run + delegate node_start over the WS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-ws-tree-'));
    tmpDirs.push(root);
    await makeAgent(join(root, 'user'), 'thing', 'You are the main agent.\n');
    const workerDir = join(root, 'user', 'spaces', 'worker');
    await makeAgent(workerDir, 'worker',
      '---\ntitle: Worker\nactions:\n  - id: compute\n    label: Compute\n    description: Compute\n---\n\nYou are a worker.');

    let step = 0;
    const streamFn = mockMatch(
      [{ when: /Run action: compute/, respond: () => `currentTask.resolve({ result: 42 });` }],
      () => {
        step++;
        if (step === 1) return `const d = await delegate(${JSON.stringify(workerDir)}, "worker", "compute", { query: "go" }) as { result: number };`;
        if (step === 2) return `display("result=" + (d as any).result);`;
        return '';
      },
    );

    const base = await startProjectServer(root, streamFn);

    const createRes = await postJson(base, '/api/sessions', { projectId: 'user' });
    expect(createRes.status).toBe(201);
    const { sessionId } = (await createRes.json()) as { sessionId: string };

    const traceKinds: string[] = [];
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/ws?sessionId=${sessionId}`);
    await new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });
    ws.on('message', (d: Buffer) => {
      try {
        const msg = JSON.parse(d.toString()) as { type: string; event?: { type: string; kind?: string } };
        if (msg.type === 'trace' && msg.event?.type === 'node_start' && msg.event.kind) {
          traceKinds.push(msg.event.kind);
        }
      } catch { /* ignore */ }
    });

    // Wait for async session init, then drive the run.
    await new Promise((r) => setTimeout(r, 300));
    expect(await postJson(base, `/api/sessions/${sessionId}/message`, { content: 'go' })).toBeTruthy();

    // Wait until the delegate node arrives (or timeout).
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (traceKinds.includes('delegate')) return resolve();
        if (Date.now() - start > 8000) return reject(new Error(`timed out; got node_start kinds: ${JSON.stringify(traceKinds)}`));
        setTimeout(tick, 25);
      };
      tick();
    });

    expect(traceKinds).toContain('run');
    expect(traceKinds).toContain('delegate');
    ws.close();
  }, 30000);
});
