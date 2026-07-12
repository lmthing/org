import { describe, it, expect } from 'vitest';
import { runDelegate } from './delegate.js';
import { DelegateRegistry } from './registry.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';
import type { Space, AgentDef } from '../spaces/load.js';
import { loadSystemSpaces, defaultSystemSpaceDirs } from '../spaces/system.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import { Tracer, type TraceEvent } from '../sandbox/trace.js';

/**
 * Delegate depth guard. runDelegate refuses to recurse past maxDepth — the check
 * fires before any space is loaded, so a runaway delegate chain is bounded. The
 * happy-path + nested (A→B) chain is covered end-to-end in
 * testing/harness-features.test.ts; here we pin the cap itself.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => '', log: () => {} };
const emptyStream = async (): Promise<StreamSession> => ({
  textStream: (async function* () {})(),
  abort() {},
});

describe('runDelegate depth cap', () => {
  it('throws when depth has reached maxDepth (before loading the target)', async () => {
    const registry = new DelegateRegistry(new Map()); // empty: proves we never reach resolution
    await expect(
      runDelegate({
        packageName: 'pkg',
        agentName: 'agent',
        action: 'act',
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 5,
        maxDepth: 5,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/Maximum delegation depth \(5\) exceeded/);
  });

  it('the error names the unresolved target', async () => {
    const registry = new DelegateRegistry(new Map());
    await expect(
      runDelegate({
        packageName: 'somePkg',
        agentName: 'someAgent',
        action: 'go',
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 3,
        maxDepth: 3,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/somePkg\/someAgent/);
  });
});

/**
 * Regression: a delegate VM must have the universal `global` toolkit in BOTH the
 * typecheck overlay and the injected runtime — not just the runtime. The `memory`
 * system agent declares no functions of its own and calls `recallAll()` directly;
 * before the fix the overlay was built from the agent's declared functions only, so
 * the statement failed typecheck with "Cannot find name 'recallAll'", never resolved,
 * and the delegate returned undefined. (Found via the THING → memory delegation.)
 */
describe('runDelegate exposes the global toolkit to declared-functionless agents', () => {
  it('the memory agent can call recallAll() (typechecks + injects)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory, 'memory system space should load').toBeTruthy();

    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));
    // The "model" calls a universal global tool and resolves with its result. If
    // recallAll were missing from the overlay this statement would fail typecheck and
    // the result would never be captured (→ undefined).
    const streamFn = createMockStreamFn(
      () => `const r = recallAll();\ncurrentTask.resolve({ ok: r.ok, isObject: typeof r.facts === 'object' });`,
    );

    const result = (await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { ok: boolean; isObject: boolean } | undefined;

    expect(result).toEqual({ ok: true, isObject: true });
  });
});

/**
 * A delegation's inputs are recorded on its trace node so a downstream ledger can
 * report "with what inputs" it was made. runDelegate writes a truncated preview of
 * `delegateOpts.query` into the delegate `node_start` detail.
 */
describe('runDelegate records the query input on its trace node', () => {
  it('the delegate node_start detail carries the query preview', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory).toBeTruthy();
    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve({ ok: true });`);

    const tracer = new Tracer(null);
    const starts: Extract<TraceEvent, { type: 'node_start' }>[] = [];
    tracer.subscribe((e) => { if (e.type === 'node_start' && e.kind === 'delegate') starts.push(e); });

    await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
      tracer,
      delegateOpts: { query: 'remember my birthday' },
    });

    expect(starts).toHaveLength(1);
    expect(starts[0]!.detail?.query).toBe('remember my birthday');
    expect(starts[0]!.detail?.agent).toBe('memory');
  });
});

describe('runDelegate forced-resolve nudge (E4 live finding)', () => {
  it('a model-driven delegate that finishes without resolving gets resolve-only turns instead of returning undefined', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const memory = systemSpaces.find((s) => s.dir.endsWith('/user-memory'));
    expect(memory).toBeTruthy();
    const registry = new DelegateRegistry(new Map([[memory!.dir, memory!]]));

    let nudged = false;
    const streamFn = createMockStreamFn((o) => {
      const last = [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      if (last.includes('currentTask.resolve()')) {
        // The STOP nudge — NOW resolve.
        nudged = true;
        return `currentTask.resolve({ done: true, via: 'nudge' });`;
      }
      // Main run: do work, display, and end WITHOUT resolving (the live E4 engineer shape).
      return `display("did the work but forgot to resolve");`;
    });

    const result = (await runDelegate({
      packageName: memory!.dir,
      agentName: 'memory',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      systemSpaces,
    })) as { done: boolean; via: string } | undefined;

    expect(nudged).toBe(true);
    expect(result).toEqual({ done: true, via: 'nudge' });
  });
});

/**
 * Action-restriction enforcement (WP-3 / org/format/space/agents/delegation.md). A `canDelegateTo` entry with
 * a `#action` suffix (e.g. "helper#greet") resolves to a `ResolvedDep` whose
 * `allowedActions` gates which action ids may be delegated. `runDelegate` is the
 * enforcement point: it rejects a disallowed action up front (before loading the
 * target's VM) and lets an allowed one proceed normally.
 */
describe('runDelegate action-restriction (allowedActions)', () => {
  function fakeAgent(slug: string, actions: { id: string }[]): AgentDef {
    return {
      slug,
      title: slug,
      instructBody: '',
      charterBody: '',
      actions: actions.map((a) => ({ id: a.id, label: a.id, description: '', tasklist: '' })),
      canDelegateTo: [],
      config: { knowledge: [], functions: [], components: [] },
    };
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
    } as Space;
  }

  it('throws naming the allowed actions when the requested action is disallowed', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }, { id: 'farewell' }]);
    const space = fakeSpace('/fake/space', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space', space]]));

    await expect(
      runDelegate({
        packageName: '/fake/space',
        agentName: 'helper',
        action: 'farewell',
        allowedActions: ['greet'],
        registry,
        renderHost: silentHost,
        streamFn: emptyStream,
        depth: 0,
        maxDepth: 5,
        maxConcurrentForks: 4,
      }),
    ).rejects.toThrow(/does not allow action "farewell".*allowed actions: greet/);
  });

  it('allows a permitted action through to the model-driven run', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }, { id: 'farewell' }]);
    const space = fakeSpace('/fake/space2', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space2', space]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve("hi");`);

    const result = await runDelegate({
      packageName: '/fake/space2',
      agentName: 'helper',
      action: 'greet',
      allowedActions: ['greet'],
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    });

    expect(result).toBe('hi');
  });

  it('undefined allowedActions means unrestricted (no-action model-driven call passes)', async () => {
    const helper = fakeAgent('helper', [{ id: 'greet' }]);
    const space = fakeSpace('/fake/space3', { helper });
    const registry = new DelegateRegistry(new Map([['/fake/space3', space]]));
    const streamFn = createMockStreamFn(() => `currentTask.resolve("ok");`);

    const result = await runDelegate({
      packageName: '/fake/space3',
      agentName: 'helper',
      // no action — model-driven; no allowedActions — unrestricted.
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
    });

    expect(result).toBe('ok');
  });
});
