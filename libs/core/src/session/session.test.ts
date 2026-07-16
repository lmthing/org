import { describe, it, expect } from 'vitest';
import { Session } from './session.js';
import type { SessionOpts, SessionDeps, RenderHost } from './types.js';
import type { YieldRequest } from '../eval/yield.js';
import type { TraceEvent } from '../sandbox/trace.js';

const renderHost: RenderHost = {
  display: () => {},
  ask: async () => undefined,
  log: () => {},
};

const deps: SessionDeps = {
  streamFn: async () => {
    throw new Error('streamFn should not be called in this test');
  },
};

function makeSession(maxConcurrentForks?: number): Session {
  const opts: SessionOpts = {
    spaceDir: '/tmp/does-not-matter',
    agentSlug: 'default',
    modelAlias: 'M',
    renderHost,
    maxConcurrentForks,
  };
  return new Session(opts, deps);
}

describe('Session fork engine sharing', () => {
  it('reuses one ForkEngine across fork/tasklist yields (shared semaphore)', async () => {
    const session = makeSession(2);
    // getForkEngine is private; reach it for a white-box check of the caching fix.
    const getEngine = (session as unknown as { getForkEngine: () => Promise<unknown> }).getForkEngine.bind(session);
    const a = await getEngine();
    const b = await getEngine();
    expect(a).toBe(b); // same instance => the maxConcurrentForks semaphore is shared
  });

  it('starts with no cached fork engine', () => {
    const session = makeSession();
    expect((session as unknown as { forkEngine: unknown }).forkEngine).toBeNull();
  });
});

describe('Session recordSessionMeta (fire-and-forget naming)', () => {
  /** Reach the private recordSessionMeta (the setSessionMeta host hook). It only
   *  touches the tracer + sessionId, so no VM/start() is required. */
  function driveMeta(
    session: Session,
    meta: unknown,
  ): { events: TraceEvent[]; ok: boolean } {
    const events: TraceEvent[] = [];
    session.getTracer().subscribe((e) => events.push(e));
    const record = (
      session as unknown as { recordSessionMeta: (m: unknown) => boolean }
    ).recordSessionMeta.bind(session);
    return { events, ok: record(meta) };
  }

  it('emits a session_meta trace event with a slugified slug and returns true', () => {
    const session = makeSession();
    const { events, ok } = driveMeta(session, { title: '  Pasta night  ', slug: 'Pasta Night!' });
    expect(ok).toBe(true);
    const meta = events.find((e) => e.type === 'session_meta') as
      | Extract<TraceEvent, { type: 'session_meta' }>
      | undefined;
    expect(meta).toBeDefined();
    expect(meta!.title).toBe('Pasta night'); // trimmed
    expect(meta!.slug).toBe('pasta-night'); // lowercased, non-alphanumerics → '-', trimmed
    expect(meta!.nodeId).toBe(session.getRootNodeId());
  });

  it('sets title only (no slug) and returns true', () => {
    const session = makeSession();
    const { events, ok } = driveMeta(session, { title: 'Just a title' });
    expect(ok).toBe(true);
    const meta = events.find((e) => e.type === 'session_meta') as
      | Extract<TraceEvent, { type: 'session_meta' }>
      | undefined;
    expect(meta!.title).toBe('Just a title');
    expect(meta!.slug).toBeUndefined();
  });

  it('emits nothing and returns false for an empty/invalid input', () => {
    const session = makeSession();
    const { events, ok } = driveMeta(session, { slug: '!!!' }); // slugifies to empty
    expect(ok).toBe(false);
    expect(events.some((e) => e.type === 'session_meta')).toBe(false);
  });
});
