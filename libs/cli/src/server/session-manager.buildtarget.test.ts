/**
 * buildTargetProjectId — the DURABLE live app-build target (Option C), pinned end-to-end.
 *
 * THING creates a LIVE project and delegates the app build INTO it; the live build target is an
 * in-RAM holder (`{ projectId }`) closed over by the session's `createProject`/`selectProject`
 * globals and read by `resolveBuildTarget` at delegate time (SessionManager.defaultBuildSession).
 * Before Option C that holder was in-RAM ONLY — so a session re-establish (resume, or
 * eviction-then-reopen) rebuilt a fresh holder pointing at the session's OWN project, and the
 * delegated app build silently landed in the wrong/empty project. The fix persists the holder's
 * projectId in meta.json and re-seeds it on resume.
 *
 * These two tests pin the two halves of that fix, and each is REVERT-PROVEN load-bearing (stash the
 * matching source edit → the test goes RED, restore → GREEN):
 *
 *   persist half — persistSession writes buildTargets.get(id).projectId into
 *     meta.buildTargetProjectId, but ONLY when it moved off the session's own project.
 *     Revert the persist edit (drop the buildTargetProjectId computation/field) ⇒ meta field
 *     undefined ⇒ RED on the 'app-live' assertion.
 *   seed half — defaultBuildSession seeds the holder to `initialBuildTargetProjectId ?? projectId`
 *     and registers it in `buildTargets` under `sessionId`. Revert the `?? projectId` seed (or the
 *     registration) ⇒ RED on the 'app-live' / 'user' assertions.
 *
 * No API keys / no VM: we build the wiring the way `session-meta.test.ts` does — a bare Session (its
 * constructor mints a Tracer + empty history, no VM/disk) and cast-to-private access to the manager.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { SessionEntry, BuildSessionArgs } from './session-manager.js';
import { WebRenderHost } from '../rpc/server.js';
import { TraceHub } from '../rpc/trace-hub.js';
import type { PersistedSessionMeta } from './projects.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

function makeManager(root: string): SessionManager {
  return new SessionManager({
    lmthingRoot: root,
    snapshotsDir: join(root, '.snaps'),
    streamFn: () => Promise.reject(new Error('streamFn should not be called')),
  });
}

/** A real Session (constructor mints a Tracer + empty history, no VM/disk) so persistSession's
 *  saveSnapshot(getHistory) works — exactly the shape session-meta.test.ts uses. */
function makeBareSession(): Session {
  return new Session(
    { spaceDir: '/tmp/nope', agentSlug: 'thing', modelAlias: 'M',
      renderHost: { display: () => {}, ask: async () => undefined, log: () => {} } },
    { streamFn: () => Promise.reject(new Error('unused')) },
  );
}

/** The private surface these tests reach into (the manager keeps this internal). */
type ManagerPriv = {
  buildTargets: Map<string, { projectId: string }>;
  defaultBuildSession: (a: BuildSessionArgs) => Session;
  persistSession: (e: SessionEntry) => Promise<void>;
};

describe('buildTargetProjectId — durable live app-build target (Option C)', () => {
  it('persist half: persistSession writes a RETARGETED build-target projectId into meta.json (and only then)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-buildtarget-'));
    tmpDirs.push(root);
    const projectId = 'user';
    const sessionId = 'sess-bt-1';
    const snapshotDir = join(root, projectId, 'sessions', sessionId);
    await mkdir(snapshotDir, { recursive: true });

    const manager = makeManager(root);
    const priv = manager as unknown as ManagerPriv;
    const entry: SessionEntry = {
      sessionId,
      session: makeBareSession(),
      renderHost: new WebRenderHost(),
      hub: new TraceHub(),
      spaceDir: join(root, projectId),
      agentSlug: 'thing',
      lastActivity: Date.now(),
      started: true,
      status: 'idle',
      projectId,
      createdAt: Date.now(),
      messageCount: 1,
      totalCostUsd: 0,
      snapshotDir,
    };

    // THING retargeted the live build to a DIFFERENT project than its own (`user`) — this is what
    // must survive a re-establish, so it must be persisted.
    priv.buildTargets.set(sessionId, { projectId: 'app-live' });
    await priv.persistSession(entry);
    const meta = JSON.parse(await readFile(join(snapshotDir, 'meta.json'), 'utf8')) as PersistedSessionMeta;
    expect(meta.buildTargetProjectId).toBe('app-live'); // ← RED if the persist edit is reverted

    // A target that never moved off the session's own project carries nothing to restore (the
    // resolver builds into its own project anyway), so it is deliberately NOT persisted.
    priv.buildTargets.set(sessionId, { projectId });
    await priv.persistSession(entry);
    const meta2 = JSON.parse(await readFile(join(snapshotDir, 'meta.json'), 'utf8')) as PersistedSessionMeta;
    expect(meta2.buildTargetProjectId).toBeUndefined();
  });

  it('seed half: defaultBuildSession seeds + registers the holder from initialBuildTargetProjectId (?? own project)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-buildtarget-'));
    tmpDirs.push(root);
    const manager = makeManager(root);
    const priv = manager as unknown as ManagerPriv;
    const base: BuildSessionArgs = {
      spaceDir: join(root, 'space'),
      agentSlug: 'thing',
      projectId: 'user',
      projectRoot: join(root, 'user'),
      appGlobals: {},
      renderHost: new WebRenderHost(),
    };

    // WITH an initial target (a RESUME restoring the persisted retarget): the holder seeds to it,
    // so the delegated build resumes into the SAME live project THING originally created.
    priv.defaultBuildSession({ ...base, sessionId: 'sess-seed-a', initialBuildTargetProjectId: 'app-live' });
    expect(priv.buildTargets.get('sess-seed-a')?.projectId).toBe('app-live'); // ← RED if the seed edit is reverted

    // WITHOUT one (a FRESH session): the holder seeds to the session's OWN project.
    priv.defaultBuildSession({ ...base, sessionId: 'sess-seed-b' });
    expect(priv.buildTargets.get('sess-seed-b')?.projectId).toBe('user');
  });
});
