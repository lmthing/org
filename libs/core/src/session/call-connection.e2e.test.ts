import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from './session.js';
import { mockMatch } from '../testing/mock-provider.js';
import type { RenderHost } from './types.js';
import type { AppGlobalImpls } from '../exec/app-globals.js';
import type { ConnectionResolver } from '../db/types.js';

/**
 * End-to-end proof of the `callConnection` path through a REAL Session:
 * agent code (mock stream) → value-yielding `callConnection` global (gated by the
 * `connections:use` capability) → yield router → host `connectionResolver` (the
 * pod-side seam, here a stub) → resolved value bound back into the VM.
 *
 * This exercises the full core wiring added for integrations WITHOUT a project
 * context (connections are project-independent), the same way a plain THING chat
 * session reaches a connected service.
 */

const tmpDirs: string[] = [];

/** One-agent space that declares the connections:use capability for `google`. */
async function makeConnSpace(providers: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-conn-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  const list = providers.map((p) => p).join(', ');
  await writeFile(
    file,
    `---\ncapabilities:\n  - connections:use: { providers: [${list}] }\n---\nYou are a connections test agent.\n`,
    'utf8',
  );
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function run(args: {
  providers: string[];
  appGlobals?: AppGlobalImpls;
  turns: (turn: number) => string;
}): Promise<{ displays: unknown[]; error?: Error }> {
  const spaceDir = await makeConnSpace(args.providers);
  const displays: unknown[] = [];
  const host: RenderHost = { display: (d) => { displays.push(d); }, ask: async () => undefined, log: () => {} };
  let turn = 0;
  const streamFn = mockMatch([], () => args.turns(++turn));
  const session = new Session(
    {
      spaceDir,
      agentSlug: 'default',
      modelAlias: 'mock',
      renderHost: host,
      systemSpaceDirs: [],
      appGlobals: args.appGlobals,
    },
    { streamFn },
  );
  let error: Error | undefined;
  try {
    await session.start('go');
  } catch (e) {
    error = e as Error;
  }
  session.dispose();
  return { displays, error };
}

describe('callConnection end-to-end through a Session', () => {
  it('resolves via the host connectionResolver and binds the value back to the agent', async () => {
    const calls: Array<[string, unknown]> = [];
    const resolver: ConnectionResolver = async (provider, req) => {
      calls.push([provider, req]);
      return { ok: true, status: 200, data: { messages: [{ id: 'm1' }] } };
    };
    const { displays, error } = await run({
      providers: ['google'],
      appGlobals: { callConnection: resolver },
      turns: (t) =>
        t === 1
          ? `const r = await callConnection('google', { method: 'GET', path: '/gmail/v1/users/me/messages' });`
          : t === 2
            ? `display(r.data);`
            : '',
    });

    expect(error).toBeUndefined();
    // The resolver saw exactly the sandbox-supplied provider + request (no token).
    expect(calls).toEqual([['google', { method: 'GET', path: '/gmail/v1/users/me/messages' }]]);
    // The resolved response's data was bound back and displayed.
    expect(displays).toContainEqual({ messages: [{ id: 'm1' }] });
  });

  it('surfaces a retryable error when no connections gateway is configured (resolver absent)', async () => {
    // No appGlobals.callConnection → the yield router throws the clear error. The
    // turn loop surfaces it to the model (retryable); it must NOT bind undefined.
    const { displays } = await run({
      providers: ['google'],
      appGlobals: undefined,
      turns: (t) =>
        t === 1
          ? `const r = await callConnection('google', { method: 'GET', path: '/x' });\ndisplay('should-not-run');`
          : '',
    });
    expect(displays).not.toContain('should-not-run');
  });
});
