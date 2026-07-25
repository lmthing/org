/**
 * Session title/slug ingestion (keyless, in-process). Proves that a `session_meta`
 * trace event — emitted by the core setSessionMeta() global — is picked up by the
 * manager's wireTracer subscription (updating the live SessionEntry) and persisted
 * to meta.json, then surfaced by listProjectSessions().
 *
 * No API keys / no model turn: we build a real Session only to borrow its Tracer,
 * wire it via the private wireTracer, and drive one event through it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { SessionEntry } from './session-manager.js';
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

/** A real Session (constructor mints a Tracer + empty history, no VM/disk) so
 *  wireTracer/persistSession see a genuine tracer, getHistory and getRootNodeId. */
function makeBareSession(): Session {
  return new Session(
    { spaceDir: '/tmp/nope', agentSlug: 'thing', modelAlias: 'M',
      renderHost: { display: () => {}, ask: async () => undefined, log: () => {} } },
    { streamFn: () => Promise.reject(new Error('unused')) },
  );
}

describe('session_meta ingestion + persistence', () => {
  it('updates the live entry, persists title+slug, and surfaces them in listProjectSessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-sessmeta-'));
    tmpDirs.push(root);
    const projectId = 'user';
    const sessionId = 'sess-1';
    const snapshotDir = join(root, projectId, 'sessions', sessionId);
    await mkdir(snapshotDir, { recursive: true });

    const manager = makeManager(root);
    const session = makeBareSession();
    const entry: SessionEntry = {
      sessionId,
      session,
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
    // Register the entry so listProjectSessions overlays the live values.
    (manager as unknown as { sessions: Map<string, SessionEntry> }).sessions.set(sessionId, entry);
    // Wire the tracer exactly like createSession does.
    (manager as unknown as { wireTracer: (s: Session, e: SessionEntry) => void }).wireTracer(session, entry);

    // The agent named the session — this is what the core setSessionMeta case emits.
    session.getTracer().write({
      ts: Date.now(),
      type: 'session_meta',
      nodeId: session.getRootNodeId(),
      title: 'Pasta night',
      slug: 'pasta-night',
    });

    // Live entry updated synchronously by the subscription.
    expect(entry.title).toBe('Pasta night');
    expect(entry.slug).toBe('pasta-night');

    // Persisted deterministically (wireTracer's persist is fire-and-forget; call
    // it directly to await the disk write).
    await (manager as unknown as { persistSession: (e: SessionEntry) => Promise<void> }).persistSession(entry);
    const meta = JSON.parse(await readFile(join(snapshotDir, 'meta.json'), 'utf8')) as PersistedSessionMeta;
    expect(meta.title).toBe('Pasta night');
    expect(meta.slug).toBe('pasta-night');

    // Surfaced by the sessions listing (live overlay).
    const listed = await manager.listProjectSessions(projectId);
    const found = listed.find((m) => m.sessionId === sessionId);
    expect(found?.title).toBe('Pasta night');
    expect(found?.slug).toBe('pasta-night');
  });
});
