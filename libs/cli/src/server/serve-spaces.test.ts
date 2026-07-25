/**
 * Space sync endpoint (POST /api/spaces) — keyless, in-process HTTP test.
 *
 * Proves the studio "live-run the edited space" path end-to-end at the pod's
 * HTTP surface:
 *   (a) POST /api/spaces writes the file map under spacesRoot/<name> and a
 *       session created with the returned spaceDir loads + runs that space;
 *   (b) re-syncing the same name REPLACES the dir (files deleted in the editor
 *       disappear on disk too);
 *   (c) path traversal in the name or a file path is rejected with 400.
 *
 * Uses the scripted mock provider so no API keys are needed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { Session, createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';
import { startSessionServer } from './serve.js';
import type { SessionServerHandle } from './serve.js';

const tmpDirs: string[] = [];
const servers: SessionServerHandle[] = [];

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** Mock: emit display(<tag>) on the first turn of a run, then stop. */
const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
  if (opts.messages.some((m) => m.role === 'assistant')) return '';
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
  const content = typeof lastUser?.content === 'string' ? lastUser.content : '';
  return `display(${JSON.stringify(content.includes('PING') ? 'PONG' : 'X')});`;
});

function makeManager(spacesRoot: string): { manager: SessionManager } {
  const manager = new SessionManager({
    streamFn: mockStreamFn,
    snapshotsDir: join(spacesRoot, '.snaps'),
    buildSession: (args: BuildSessionArgs) =>
      new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [], // keyless, fast
        },
        { streamFn: mockStreamFn },
      ),
  });
  return { manager };
}

async function startServer(): Promise<{ base: string; spacesRoot: string }> {
  const spacesRoot = await mkdtemp(join(tmpdir(), 'lmthing-spaces-'));
  tmpDirs.push(spacesRoot);
  const { manager } = makeManager(spacesRoot);
  const handle = await startSessionServer({
    port: 0,
    manager,
    appTsxPath: 'unused', // no defaultSpaceDir → app bundling is skipped
    spacesRoot,
  });
  servers.push(handle);
  return { base: `http://localhost:${handle.port}`, spacesRoot };
}

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function until(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

const AGENT_FILE = 'agents/main/instruct.md';
const AGENT_BODY = 'You are a test agent. When asked, display a value.\n';

describe('POST /api/spaces — sync + run an edited space (keyless)', () => {
  it('(a) syncs a space to disk and runs a session against the returned spaceDir', async () => {
    const { base, spacesRoot } = await startServer();

    const syncRes = await postJson(base, '/api/spaces', {
      name: 'demo',
      files: { [AGENT_FILE]: AGENT_BODY, 'README.md': 'hello' },
    });
    expect(syncRes.status).toBe(201);
    const { spaceDir } = (await syncRes.json()) as { spaceDir: string };
    expect(spaceDir).toBe(join(spacesRoot, 'demo'));

    // Files actually landed on disk.
    expect(await readFile(join(spaceDir, AGENT_FILE), 'utf8')).toBe(AGENT_BODY);

    // A session created with that spaceDir loads + runs the synced agent.
    const createRes = await postJson(base, '/api/sessions', { spaceDir, agentSlug: 'main' });
    expect(createRes.status).toBe(201);
    const { sessionId } = (await createRes.json()) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    const events: Array<{ type: string; descriptor?: unknown }> = [];
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/ws?sessionId=${sessionId}`);
    ws.on('message', (d: Buffer) => {
      try { events.push(JSON.parse(d.toString())); } catch { /* ignore */ }
    });
    await new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });

    await postJson(base, `/api/sessions/${sessionId}/message`, { content: 'PING please' });

    await until(() =>
      events.some((e) => e.type === 'display' && e.descriptor === 'PONG'),
    );
    ws.close();
  });

  it('(b) re-syncing the same name replaces the dir (deleted files vanish)', async () => {
    const { base, spacesRoot } = await startServer();

    await postJson(base, '/api/spaces', {
      name: 'repl',
      files: { [AGENT_FILE]: AGENT_BODY, 'functions/old.ts': 'export const old = 1;' },
    });
    const dir = join(spacesRoot, 'repl');
    await access(join(dir, 'functions/old.ts')); // present after first sync

    // Second sync omits functions/old.ts → it must be gone.
    const res = await postJson(base, '/api/spaces', {
      name: 'repl',
      files: { [AGENT_FILE]: AGENT_BODY },
    });
    expect(res.status).toBe(201);
    await expect(access(join(dir, 'functions/old.ts'))).rejects.toBeTruthy();
    expect(await readFile(join(dir, AGENT_FILE), 'utf8')).toBe(AGENT_BODY);
  });

  it('(c) rejects path traversal in the space name and file paths', async () => {
    const { base, spacesRoot } = await startServer();

    const badName = await postJson(base, '/api/spaces', { name: '../escape', files: {} });
    expect(badName.status).toBe(400);

    const slashName = await postJson(base, '/api/spaces', { name: 'a/b', files: {} });
    expect(slashName.status).toBe(400);

    const badPath = await postJson(base, '/api/spaces', {
      name: 'ok',
      files: { '../../escape.md': 'pwned' },
    });
    expect(badPath.status).toBe(400);

    // Nothing escaped the spaces root.
    await expect(access(join(spacesRoot, '..', 'escape.md'))).rejects.toBeTruthy();
  });
});
