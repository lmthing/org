/**
 * SessionManager spaceRef chat plumbing (Phase 7A) — keyless mock provider.
 * Proves:
 *   (a) createSession({ spaceRef: 'curation/curator', projectId }) loads the
 *       curator agent, project-rooted (projectRoot/projectSpacesDir wired), and
 *       records spaceId on the entry;
 *   (b) the snapshot is persisted under
 *       <root>/<projectId>/spaces/curation/sessions/<id> — NOT <project>/sessions;
 *   (c) listSpaceSessions returns that session, and it does NOT leak into
 *       listProjectSessions;
 *   (d) a resume (fresh manager = simulated restart) rehydrates from the
 *       per-space dir;
 *   (e) a plain createSession({ projectId }) still persists under
 *       <root>/<projectId>/sessions/<id>.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const PROJECT = 'proj';

/** tmp lmthingRoot with a `proj` project holding a `curation` space whose lead
 *  agent is `curator` (spaces-only → no db, bootProjectApp returns null). */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-spaceref-'));
  tmpDirs.push(root);
  await writeFile(
    join(await ensureDir(root, PROJECT), 'project.json'),
    JSON.stringify({ id: PROJECT, name: 'Proj', createdAt: Date.now() }),
    'utf8',
  );
  const instruct = join(root, PROJECT, 'spaces', 'curation', 'agents', 'curator', 'instruct.md');
  await mkdir(dirname(instruct), { recursive: true });
  await writeFile(instruct, 'You are the curator.\n', 'utf8');
  return root;
}

async function ensureDir(...parts: string[]): Promise<string> {
  const d = join(...parts);
  await mkdir(d, { recursive: true });
  return d;
}

/** Mock: emit display('done') on the first turn, then stop (and on resume). */
const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
  const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
  return hasAssistant ? '' : `display("done");`;
});

/** buildSession that records args and builds a keyless mock Session. */
function recordingManager(root: string, captured: BuildSessionArgs[]): SessionManager {
  return new SessionManager({
    streamFn: mockStreamFn,
    lmthingRoot: root,
    buildSession: (args: BuildSessionArgs) => {
      captured.push(args);
      return new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [],
          preloadSpaceDirs: args.preloadSpaceDirs,
          projectSpacesDir: args.projectSpacesDir,
          projectId: args.projectId,
          projectRoot: args.projectRoot,
          appGlobals: args.appGlobals,
          budget: args.budget,
        },
        { streamFn: mockStreamFn },
      );
    },
  });
}

/** Poll until the async project init has filled in entry.session. */
async function waitReady(mgr: SessionManager, id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const e = mgr.getSession(id);
    if (e?.session) return;
    if (e?.status === 'error') throw new Error('session init errored');
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('session did not initialize in time');
}

/** Send one message and wait for the turn (idle) to settle + persist. */
async function sendAndSettle(mgr: SessionManager, id: string, msg: string): Promise<void> {
  mgr.sendMessage(id, msg);
  for (let i = 0; i < 300; i++) {
    const e = mgr.getSession(id);
    if (e && e.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  // Give the fire-and-forget persistSession a tick to flush.
  await new Promise((r) => setTimeout(r, 30));
}

describe('SessionManager spaceRef chat sessions', () => {
  it('loads the curator agent, project-rooted, and records spaceId', async () => {
    const root = await makeRoot();
    const captured: BuildSessionArgs[] = [];
    const mgr = recordingManager(root, captured);

    const { sessionId } = mgr.createSession({ spaceRef: 'curation/curator', projectId: PROJECT });
    await waitReady(mgr, sessionId);

    const entry = mgr.getSession(sessionId)!;
    expect(entry.agentSlug).toBe('curator');
    expect(entry.spaceId).toBe('curation');
    expect(entry.spaceDir).toBe(join(root, PROJECT, 'spaces', 'curation'));

    // Project context wired (the path by which db writes fire hooks).
    const args = captured[0]!;
    expect(args.agentSlug).toBe('curator');
    expect(args.projectId).toBe(PROJECT);
    expect(args.projectRoot).toBe(join(root, PROJECT));
    expect(args.projectSpacesDir).toBe(join(root, PROJECT, 'spaces'));
  });

  it('persists under the per-space sessions dir, not the project sessions dir', async () => {
    const root = await makeRoot();
    const captured: BuildSessionArgs[] = [];
    const mgr = recordingManager(root, captured);

    const { sessionId } = mgr.createSession({ spaceRef: 'curation/curator', projectId: PROJECT });
    await waitReady(mgr, sessionId);
    await sendAndSettle(mgr, sessionId, 'hello');

    const spaceSnap = join(root, PROJECT, 'spaces', 'curation', 'sessions', sessionId, 'snapshot.json');
    const projSnap = join(root, PROJECT, 'sessions', sessionId, 'snapshot.json');
    expect(existsSync(spaceSnap)).toBe(true);
    expect(existsSync(projSnap)).toBe(false);

    // listSpaceSessions returns it; listProjectSessions does not.
    const spaceSessions = await mgr.listSpaceSessions(PROJECT, 'curation');
    expect(spaceSessions.map((s) => s.sessionId)).toContain(sessionId);
    expect(spaceSessions[0]!.spaceId).toBe('curation');

    const projSessions = await mgr.listProjectSessions(PROJECT);
    expect(projSessions.map((s) => s.sessionId)).not.toContain(sessionId);
  });

  it('resumes a space session from the per-space dir on a fresh manager', async () => {
    const root = await makeRoot();
    const captured1: BuildSessionArgs[] = [];
    const mgr1 = recordingManager(root, captured1);
    const { sessionId } = mgr1.createSession({ spaceRef: 'curation/curator', projectId: PROJECT });
    await waitReady(mgr1, sessionId);
    await sendAndSettle(mgr1, sessionId, 'hello');
    await mgr1.disposeSession(sessionId);

    // Simulated restart: brand-new manager, same root.
    const captured2: BuildSessionArgs[] = [];
    const mgr2 = recordingManager(root, captured2);
    const resumed = mgr2.createSession({
      resumeSessionId: sessionId,
      projectId: PROJECT,
      spaceRef: 'curation/curator',
    });
    expect(resumed.sessionId).toBe(sessionId);
    await waitReady(mgr2, sessionId);

    const entry = mgr2.getSession(sessionId)!;
    expect(entry.spaceId).toBe('curation');
    expect(entry.snapshotDir).toBe(join(root, PROJECT, 'spaces', 'curation', 'sessions', sessionId));
    expect(entry.spaceDir).toBe(join(root, PROJECT, 'spaces', 'curation'));

    // Resume + one more turn rehydrates on a fresh VM without throwing.
    await sendAndSettle(mgr2, sessionId, 'again');
    expect(mgr2.getSession(sessionId)!.status).not.toBe('error');
  });

  it('a plain project session still persists under <project>/sessions/', async () => {
    const root = await makeRoot();
    // A root-level agent so a plain (no spaceRef) session can load.
    const thing = join(root, PROJECT, 'agents', 'thing', 'instruct.md');
    await mkdir(dirname(thing), { recursive: true });
    await writeFile(thing, 'You are thing.\n', 'utf8');

    const captured: BuildSessionArgs[] = [];
    const mgr = recordingManager(root, captured);
    const { sessionId } = mgr.createSession({ projectId: PROJECT });
    await waitReady(mgr, sessionId);

    expect(mgr.getSession(sessionId)!.spaceId).toBeUndefined();
    await sendAndSettle(mgr, sessionId, 'hi');

    expect(existsSync(join(root, PROJECT, 'sessions', sessionId, 'snapshot.json'))).toBe(true);
  });
});
