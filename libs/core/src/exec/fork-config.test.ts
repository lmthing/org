import { describe, it, expect } from 'vitest';
import { forkEngineOptsFrom, type ForkEngineParentContext } from './fork-config.js';
import { runDelegate } from '../delegate/delegate.js';
import { DelegateRegistry } from '../delegate/registry.js';
import { BudgetExceededError } from '../eval/budget.js';
import { mockMatch } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { Space, AgentDef } from '../spaces/load.js';

const silentHost: RenderHost = { display: () => {}, ask: async () => '', log: () => {} };
const noopStream = async (_o: StreamOpts): Promise<StreamSession> => ({
  textStream: (async function* () {})(),
  abort() {},
});

/**
 * Regression lock for A1: the session and delegate ForkEngine wiring sites both
 * go through `forkEngineOptsFrom`, whose parameter type requires EVERY
 * ForkEngineOpts field to be spelled out. Given identical parent state, the two
 * bags must produce FIELD-IDENTICAL engine options — the drift that dropped
 * budgetLimits/roleModels/forkDepth/dynamicSpaces at the delegate site is now a
 * compile error, and this test pins it at runtime too.
 */
describe('forkEngineOptsFrom (A1 regression lock)', () => {
  function parentState() {
    const dynamicSpaces = new Map<string, Space>();
    const delegateRunner = async (): Promise<unknown> => undefined;
    return {
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: '/some/space',
      parentAgentSlug: 'main',
      parentAgentCharter: 'Be helpful.',
      renderHost: silentHost,
      streamFn: noopStream,
      clock: undefined,
      tracer: undefined,
      agentFunctions: { fn: 'export function fn() {}' },
      agentFunctionsBundled: {},
      budgetLimits: { maxEpisodes: 7, maxForkDepth: 3 },
      roleModels: { explore: 'cheap-model' },
      defaultModel: 'main-model',
      dynamicSpaces,
      projectSpacesDir: '/proj/spaces',
      projectRoot: '/proj',
      projectId: 'proj',
      parentAppCapabilities: {},
      appGlobals: undefined,
      delegateRunner,
      documentResolver: undefined,
      knowledgeFallbackDirs: ['/system/spaces/user-thing/knowledge'],
    };
  }

  /** Session-style bag: forkDepth is explicitly undefined (top-level forks default to 1). */
  function sessionBag(p: ReturnType<typeof parentState>): ForkEngineParentContext {
    return { ...p, forkDepth: undefined };
  }

  /** Delegate-style bag at delegation depth `depth`: forks nest one level below. */
  function delegateBag(p: ReturnType<typeof parentState>, depth: number): ForkEngineParentContext {
    return { ...p, forkDepth: depth + 1 };
  }

  it('given identical parent state, both wiring sites produce field-identical opts (forkDepth aside)', () => {
    const p = parentState();
    const fromSession = forkEngineOptsFrom(sessionBag(p));
    const fromDelegate = forkEngineOptsFrom(delegateBag(p, 0));

    // Identical key sets — an option added to ForkEngineOpts cannot silently
    // exist at one site and not the other.
    expect(Object.keys(fromSession).sort()).toEqual(Object.keys(fromDelegate).sort());

    // Every shared field is identical by reference/value.
    for (const key of Object.keys(fromSession) as Array<keyof typeof fromSession>) {
      if (key === 'forkDepth') continue; // the one intentionally different field
      expect(fromDelegate[key], `field "${String(key)}" drifted between wiring sites`).toBe(fromSession[key]);
    }

    // The one intentional difference: a top-level delegate's forks are depth 1
    // (same level as session forks — ForkEngine defaults undefined to 1).
    expect(fromSession.forkDepth).toBeUndefined();
    expect(fromDelegate.forkDepth).toBe(1);
  });

  it('the delegate-side opts now include budgetLimits/roleModels/forkDepth/dynamicSpaces (the A1 fields)', () => {
    const p = parentState();
    const opts = forkEngineOptsFrom(delegateBag(p, 2));
    expect(opts.budgetLimits).toBe(p.budgetLimits);
    expect(opts.roleModels).toBe(p.roleModels);
    expect(opts.dynamicSpaces).toBe(p.dynamicSpaces);
    expect(opts.forkDepth).toBe(3); // delegation depth 2 → its forks are depth 3
  });
});

// ---------------------------------------------------------------------------
// End-to-end A1: a fork spawned INSIDE a delegate now honors the inherited
// budget (fork-depth cap), where the pre-fix delegate engine ran it uncapped.
// ---------------------------------------------------------------------------

function fakeAgent(slug: string): AgentDef {
  return {
    slug,
    title: slug,
    instructBody: '',
    charterBody: '',
    actions: [],
    canDelegateTo: [],
    config: { knowledge: [], functions: [], components: [] },
  } as unknown as AgentDef;
}

function fakeSpace(dir: string, agents: Record<string, AgentDef>): Space {
  return {
    dir,
    packageName: undefined,
    agents,
    tasklists: {},
    functions: {},
    functionsBundled: {},
    dependentSpaces: {},
    components: { view: {}, form: {} },
    knowledge: { domains: {} },
  } as unknown as Space;
}

function forkingDelegateStream(): (opts: StreamOpts) => Promise<StreamSession> {
  let delegateTurn = 0;
  return mockMatch(
    [
      {
        // The fork's own turn: its user message carries the instruction AND the schema.
        when: (o) => o.messages.some((m) => m.content.includes('FORK_WORK') && m.content.includes('Output schema')),
        respond: () => 'currentTask.resolve({ ok: true });',
      },
      {
        when: (o) => o.messages.some((m) => m.content.includes('You have been delegated')),
        respond: () => {
          delegateTurn++;
          return delegateTurn === 1
            ? `const f = await fork({ role: 'general', instruction: 'FORK_WORK', output: { ok: 'boolean' } });`
            : `currentTask.resolve({ ok: (f as { ok: boolean }).ok });`;
        },
      },
    ],
    () => '',
  );
}

describe('delegate-side ForkEngine inherits budgetLimits (A1, end-to-end)', () => {
  function makeRegistry(): DelegateRegistry {
    const space = fakeSpace('/fake/a1-space', { helper: fakeAgent('helper') });
    return new DelegateRegistry(new Map([['/fake/a1-space', space]]));
  }

  it('without budgetLimits the fork under the delegate runs and resolves (control)', async () => {
    const result = await runDelegate({
      packageName: '/fake/a1-space',
      agentName: 'helper',
      registry: makeRegistry(),
      renderHost: silentHost,
      streamFn: forkingDelegateStream(),
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    });
    expect(result).toEqual({ ok: true });
  });

  it('with an inherited maxForkDepth cap, the fork under the delegate is rejected (was silently uncapped before A1)', async () => {
    await expect(
      runDelegate({
        packageName: '/fake/a1-space',
        agentName: 'helper',
        registry: makeRegistry(),
        renderHost: silentHost,
        streamFn: forkingDelegateStream(),
        depth: 0,
        maxDepth: 5,
        maxConcurrentForks: 4,
        budgetLimits: { maxForkDepth: 0 }, // no fork may spawn anywhere below
      }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it('fork depth accounts for the delegation depth: depth-1 delegate forks are depth 2', async () => {
    // maxForkDepth 1 permits depth-1 forks (a top-level delegate) but rejects the
    // same fork when the delegate itself sits one level deeper (depth 1 → forks depth 2).
    const okAtTop = await runDelegate({
      packageName: '/fake/a1-space',
      agentName: 'helper',
      registry: makeRegistry(),
      renderHost: silentHost,
      streamFn: forkingDelegateStream(),
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      budgetLimits: { maxForkDepth: 1 },
    });
    expect(okAtTop).toEqual({ ok: true });

    await expect(
      runDelegate({
        packageName: '/fake/a1-space',
        agentName: 'helper',
        registry: makeRegistry(),
        renderHost: silentHost,
        streamFn: forkingDelegateStream(),
        depth: 1,
        maxDepth: 5,
        maxConcurrentForks: 4,
        budgetLimits: { maxForkDepth: 1 },
      }),
    ).rejects.toThrow(BudgetExceededError);
  });
});
