/**
 * Hook handler CTX upgrade ({@link ./hooks.ts} `runHook` / `buildHookCtx`).
 *
 * Covers the S7 behavioral fixes to the imperative-handler ctx:
 *   - `delegate(spaceRef, action, { input })` threads structured input INTO the
 *     headless run's kickoff message AND returns the run's `DelegateResult`
 *     (previously `void opts` dropped the input and the result was discarded).
 *   - `callConnection(provider, req)` is gated by the hook def's `connections:` —
 *     a declared provider reaches the resolver; an undeclared one throws.
 *   - a SPACE-owned hook's connections are additionally locked to the owning
 *     space's OWN provider(s): a provider it declared but the space itself does
 *     not own is still blocked.
 *   - `tasklist.run` is a seam that throws until a runner is injected.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runHook, type Hook, type HookManager } from './hooks.js';

let root: string;
const PROJECT = 'p1';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hooks-ctx-'));
  mkdirSync(join(root, PROJECT), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function mockManager(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runHeadless: any = vi.fn(async () => ({ ok: true, result: 'R', sessionId: 'sid' })),
): HookManager & { runHeadless: ReturnType<typeof vi.fn> } {
  return {
    runHeadless,
    getProjectDb: vi.fn(async () => ({ async: { query: () => [] } })),
  } as unknown as HookManager & { runHeadless: ReturnType<typeof vi.fn> };
}

describe('delegate — threads input + returns result', () => {
  it('serializes opts.input into the run message and returns the DelegateResult', async () => {
    const manager = mockManager();
    const hook: Hook = {
      slug: 'react',
      type: 'event',
      handler: async (ctx) => ctx.delegate('feed/curator', 'summarize', { input: { itemId: 42 } }),
    };

    const outcome = await runHook(manager, root, PROJECT, hook);

    expect(outcome.queued).toBe(false);
    expect(outcome.result).toEqual({ ok: true, result: 'R', sessionId: 'sid' });

    const arg = manager.runHeadless.mock.calls[0]![0] as { spaceRef: string; agentSlug: string; message: string };
    expect(arg).toMatchObject({ spaceRef: 'feed/curator', agentSlug: 'curator' });
    expect(arg.message).toContain('Input: {"itemId":42}');
  });

  it('normalizes a bare delegate return into { ok, result }', async () => {
    const manager = mockManager(vi.fn(async () => 'plain-value'));
    const hook: Hook = { slug: 'h', type: 'event', handler: async (ctx) => ctx.delegate('sp/agent') };
    const outcome = await runHook(manager, root, PROJECT, hook);
    expect(outcome.result).toEqual({ ok: true, result: 'plain-value' });
  });
});

describe('callConnection — gated by declared connections', () => {
  const resolver = vi.fn(async (provider: string, req: { path: string }) => ({
    ok: true,
    status: 200,
    data: { provider, path: req.path },
  }));

  beforeEach(() => {
    resolver.mockClear();
  });

  it('allows a declared provider (routes to the resolver)', async () => {
    const hook: Hook = {
      slug: 'h',
      type: 'event',
      owner: 'project',
      connections: ['slack'],
      handler: async (ctx) => ctx.callConnection('slack', { method: 'POST', path: '/chat.postMessage' }),
    };
    const outcome = await runHook(mockManager(), root, PROJECT, hook, undefined, { connectionResolver: resolver });
    expect(outcome.result).toMatchObject({ ok: true, data: { provider: 'slack', path: '/chat.postMessage' } });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('throws for an undeclared provider (never reaches the resolver)', async () => {
    const hook: Hook = {
      slug: 'h',
      type: 'event',
      owner: 'project',
      connections: ['slack'],
      handler: async (ctx) => ctx.callConnection('github', { method: 'GET', path: '/user' }),
    };
    await expect(runHook(mockManager(), root, PROJECT, hook, undefined, { connectionResolver: resolver })).rejects.toThrow(
      /callConnection\("github"\): not in hook "h"'s declared connections/,
    );
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('space-hook connections — locked to the owning space provider', () => {
  const resolver = vi.fn(async (provider: string) => ({ ok: true, status: 200, data: { provider } }));

  beforeEach(() => {
    resolver.mockClear();
    // The space owns only `slack` (its own lmthing.connection descriptor).
    const dir = join(root, PROJECT, 'spaces', 'integration-slack');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'integration-slack', lmthing: { connection: { provider: 'slack', tokenEnv: 'INTEGRATION_SLACK_TOKEN' } } }),
    );
  });

  it('allows the space its own provider but blocks a declared foreign provider', async () => {
    const hook: Hook = {
      slug: 'integration-slack:react',
      type: 'event',
      owner: 'integration-slack',
      // Declares BOTH, but only `slack` is the space's own provider.
      connections: ['slack', 'github'],
      handler: async (ctx) => {
        const own = await ctx.callConnection('slack', { method: 'POST', path: '/x' });
        let foreign: string;
        try {
          await ctx.callConnection('github', { method: 'GET', path: '/y' });
          foreign = 'allowed';
        } catch {
          foreign = 'blocked';
        }
        return { own, foreign };
      },
    };
    const outcome = await runHook(mockManager(), root, PROJECT, hook, undefined, { connectionResolver: resolver });
    expect(outcome.result).toMatchObject({ own: { ok: true, data: { provider: 'slack' } }, foreign: 'blocked' });
    expect(resolver).toHaveBeenCalledTimes(1); // only the allowed `slack` call reached it
  });
});

describe('tasklist.run — seam', () => {
  it('throws until a runner is injected', async () => {
    const hook: Hook = {
      slug: 'h',
      type: 'event',
      handler: async (ctx) => ctx.tasklist.run('integration-x/flow', { seed: 1 }),
    };
    await expect(runHook(mockManager(), root, PROJECT, hook)).rejects.toThrow(/tasklist runner not available yet/);
  });

  it('routes to an injected runner', async () => {
    const tasklistRunner = vi.fn(async (ref: string, seed?: unknown) => ({ ref, seed, ran: true }));
    const hook: Hook = {
      slug: 'h',
      type: 'event',
      handler: async (ctx) => ctx.tasklist.run('integration-x/flow', { seed: 1 }),
    };
    const outcome = await runHook(mockManager(), root, PROJECT, hook, undefined, { tasklistRunner });
    expect(outcome.result).toEqual({ ref: 'integration-x/flow', seed: { seed: 1 }, ran: true });
  });
});
