import { describe, it, expect } from 'vitest';
import { runDelegate } from './delegate.js';
import { DelegateRegistry } from './registry.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';

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
