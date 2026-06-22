import { describe, it, expect } from 'vitest';
import { runDelegate } from './delegate.js';
import { DelegateRegistry } from './registry.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';
import { loadSystemSpaces, defaultSystemSpaceDirs } from '../spaces/system.js';
import { createMockStreamFn } from '../testing/mock-provider.js';

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
    const memory = systemSpaces.find((s) => s.dir.endsWith('/memory'));
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
