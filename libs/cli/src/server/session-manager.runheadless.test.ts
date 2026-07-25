/**
 * SessionManager.runHeadless — keyless, in-process. Uses the scripted mock
 * provider (createMockStreamFn) so no API keys are needed. Proves:
 *   (a) a headless run whose agent emits display('done') returns
 *       { ok:true, sessionId } with result 'done', and disposes the VM;
 *   (b) a run that throws surfaces { ok:false, error, sessionId };
 *   (c) the headless session NEVER appears in listSessions() and never counts
 *       against capacity.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** A tmp lmthingRoot with a minimal one-agent 'user' project (spaces-only, no
 *  database/ → bootProjectApp returns null; agent lives at the project root so
 *  spaceDir defaults to it). */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-runheadless-'));
  tmpDirs.push(root);
  const file = join(root, 'user', 'agents', 'thing', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return root;
}

/** Mock: emit display('done') on the first turn, then stop. */
const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
  const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
  if (hasAssistant) return ''; // already emitted → done
  return `display("done");`;
});

describe('SessionManager.runHeadless (keyless, mock provider)', () => {
  it('(a) returns { ok:true, result } and disposes the VM', async () => {
    const root = await makeRoot();
    let disposed = false;
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) => {
        const s = new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [], // keyless: no system spaces
            budget: args.budget,
          },
          { streamFn: mockStreamFn },
        );
        const origDispose = s.dispose.bind(s);
        s.dispose = () => {
          disposed = true;
          origDispose();
        };
        return s;
      },
    });

    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBeTruthy();
    expect(res.error).toBeUndefined();
    expect(res.result).toBe('done');
    // The ephemeral VM was torn down.
    expect(disposed).toBe(true);
    // Never registered in the interactive pool.
    expect(manager.listSessions().length).toBe(0);
    expect(manager.getSession(res.sessionId)).toBeUndefined();
  });

  it('(b) surfaces { ok:false, error } when the run throws', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: () => {
        throw new Error('boom');
      },
    });

    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
    expect(res.sessionId).toBeTruthy();
    expect(res.result).toBeUndefined();
    // Failure still leaves the pool empty.
    expect(manager.listSessions().length).toBe(0);
  });

  it('(c) headless runs do not count against maxSessions capacity', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      maxSessions: 1,
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
          },
          { streamFn: mockStreamFn },
        ),
    });

    // Run several headless turns at a cap of 1 — none should register or evict.
    for (let i = 0; i < 3; i++) {
      const res = await manager.runHeadless({ agentSlug: 'thing', message: `msg ${i}` });
      expect(res.ok).toBe(true);
      expect(manager.listSessions().length).toBe(0);
    }
  });
});
