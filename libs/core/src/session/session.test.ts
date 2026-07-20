import { describe, it, expect } from 'vitest';
import { Session } from './session.js';
import type { SessionOpts, SessionDeps, RenderHost } from './types.js';
import type { YieldRequest } from '../eval/yield.js';
import type { TraceEvent } from '../sandbox/trace.js';
import type { Space, AgentDef } from '../spaces/load.js';
import { loadSystemSpaces, defaultSystemSpaceDirs } from '../spaces/system.js';

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

// ── buildInjectedFunctions — the pool/injected two-set split (Slice B) ──────────────
//
// webSearch/webFetch are GRANTED-ONLY for the top-level injected view (filterUniversalFunctions
// in spaces/system.ts): withheld unless the running agent's own `functions:` frontmatter names
// them, but always present in the UNFILTERED fork-engine pool (poolFunctions/poolFunctionsBundled)
// so a task node (e.g. research_and_store's research node) can still select them via its own
// `functions:` allow-list even when the parent agent's top-level VM never sees them. See
// `.issues/research-store-noop-diagnosis.md` (Slice B). No SHIPPED agent grants webSearch/webFetch
// today (confirmed by grep — neither THING nor the researcher calls them at top level; both route
// through delegation/tasklists), so this is exercised here with a throwaway fixture agent/space
// hand-built directly (the AgentDef.capabilities doc comment names this as a blessed test pattern)
// — that sidesteps loadSpace's OWN unrelated invariant that a declared `functions:` name must
// resolve to a file under that space's local `functions/` dir, which a granted-only universal
// name never does.
describe('Session.buildInjectedFunctions — granted-only pool/injected split', () => {
  const emptySpace: Space = {
    dir: '/fixture',
    agents: {},
    tasklists: {},
    functions: {},
    functionsBundled: {},
    dependentSpaces: {},
    components: { view: {}, form: {} },
    knowledge: { domains: {} },
  };

  function fixtureAgent(functions: string[]): AgentDef {
    return {
      slug: 'specialist',
      title: 'Specialist',
      instructBody: '',
      charterBody: '',
      actions: [],
      config: { knowledge: [], functions, components: [] },
    };
  }

  /** White-box: populate this.systemSpaces the same way loadMergedSpace does (via the real
   *  system-global toolkit, which carries webSearch/webFetch), then reach buildInjectedFunctions
   *  directly with a hand-built space/agent — no on-disk fixture, no loadSpace() call at all. */
  async function build(functions: string[]): Promise<{
    functions: Record<string, string>;
    functionsBundled: Record<string, string>;
    poolFunctions: Record<string, string>;
    poolFunctionsBundled: Record<string, string>;
  }> {
    const session = makeSession();
    const priv = session as unknown as {
      systemSpaces: Space[];
      buildInjectedFunctions: (space: Space, agent: AgentDef) => {
        functions: Record<string, string>;
        functionsBundled: Record<string, string>;
        poolFunctions: Record<string, string>;
        poolFunctionsBundled: Record<string, string>;
      };
    };
    priv.systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    return priv.buildInjectedFunctions(emptySpace, fixtureAgent(functions));
  }

  it('functions: [] — webSearch is in the fork-engine pool but withheld from the injected view', async () => {
    const { functions, poolFunctions } = await build([]);
    expect('webSearch' in functions).toBe(false);
    expect('webSearch' in poolFunctions).toBe(true);
    // An ordinary universal function (not granted-only) is unaffected either way.
    expect('remember' in functions).toBe(true);
    expect('remember' in poolFunctions).toBe(true);
  });

  it('functions: ["webSearch"] — webSearch is in BOTH the injected view and the pool', async () => {
    const { functions, poolFunctions } = await build(['webSearch']);
    expect('webSearch' in functions).toBe(true);
    expect('webSearch' in poolFunctions).toBe(true);
    // webFetch was NOT granted — still withheld from the injected view, still in the pool.
    expect('webFetch' in functions).toBe(false);
    expect('webFetch' in poolFunctions).toBe(true);
  });
});
