import { describe, it, expect } from 'vitest';
import { Session } from './session.js';
import type { SessionOpts, SessionDeps, RenderHost } from './types.js';

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
