/**
 * Space-hook loading + WORKER ISOLATION ({@link ./loader.ts} `loadSpaceHooks`).
 *
 * Space hooks are store-downloaded code. The security invariant is that their
 * module is NEVER evaluated in the main process — the def is extracted in a
 * worker, and an imperative handler is invoked worker-isolated. These tests
 * PROVE non-execution in-proc with a top-level side-effect marker (a worker has
 * its own `globalThis`, so a real in-proc `require` would flip the MAIN marker),
 * and prove the handler actually runs in the worker (its proxied `delegate`
 * round-trips back to a main-process spy while its OWN globalThis write never
 * reaches the main thread).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSpaceHooks, type EventHookDef } from './loader.js';

let root: string; // acts as the project root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'space-hooks-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>)['__SPACE_HOOK_DEF_INPROC'];
  delete (globalThis as Record<string, unknown>)['__SPACE_HOOK_HANDLER_INPROC'];
});

function writeSpaceHook(spaceId: string, name: string, source: string): void {
  const dir = join(root, 'spaces', spaceId, 'hooks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), source, 'utf8');
}

describe('loadSpaceHooks — worker-isolated def extraction', () => {
  it('loads a space event hook, namespaced by owner, WITHOUT executing it in-proc', async () => {
    // A top-level side effect: if this module were require()d in-proc, the MAIN
    // thread's globalThis marker would flip. In a worker it flips a DIFFERENT global.
    writeSpaceHook(
      'integration-slack',
      'on-message.ts',
      `(globalThis).__SPACE_HOOK_DEF_INPROC = true;
       export default { type: 'event', on: { event: 'integration-slack/message.posted' }, trigger: 'integration-slack/responder#reply', connections: ['slack'] };`,
    );

    const hooks = await loadSpaceHooks(root, 'integration-slack');

    // The def loaded correctly…
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.slug).toBe('integration-slack:on-message');
    expect(hooks[0]!.owner).toBe('integration-slack');
    const def = hooks[0]!.def as EventHookDef;
    expect(def).toMatchObject({
      type: 'event',
      on: { event: 'integration-slack/message.posted' },
      trigger: 'integration-slack/responder#reply',
      connections: ['slack'],
    });
    // …and the main process was NEVER polluted by the module's top-level code.
    expect((globalThis as Record<string, unknown>)['__SPACE_HOOK_DEF_INPROC']).toBeUndefined();
  }, 20_000);

  it('runs a space hook HANDLER in the worker (proxied delegate round-trips; no in-proc pollution)', async () => {
    writeSpaceHook(
      'integration-demo',
      'react.ts',
      `export default {
         type: 'event',
         on: { event: 'integration-demo/ping' },
         handler: async (ctx) => {
           (globalThis).__SPACE_HOOK_HANDLER_INPROC = true; // worker-local only
           const out = await ctx.delegate('integration-demo/agent', 'go', { input: { n: 21 } });
           return { delegated: out };
         },
       };`,
    );

    const [hook] = await loadSpaceHooks(root, 'integration-demo');
    const def = hook!.def as EventHookDef;
    expect(typeof def.handler).toBe('function');

    // Main-process delegate spy — the worker proxies into this.
    const seen: Array<{ ref: string; action?: string; opts?: unknown }> = [];
    const delegate = async (ref: string, action?: string, opts?: unknown) => {
      seen.push({ ref, action, opts });
      return { ok: true, result: 'ran', sessionId: 's1' };
    };

    const result = await def.handler!({ db: {}, delegate });

    expect(result).toEqual({ delegated: { ok: true, result: 'ran', sessionId: 's1' } });
    expect(seen).toEqual([{ ref: 'integration-demo/agent', action: 'go', opts: { input: { n: 21 } } }]);
    // The handler's own globalThis write happened in the worker — never in-proc.
    expect((globalThis as Record<string, unknown>)['__SPACE_HOOK_HANDLER_INPROC']).toBeUndefined();
  }, 20_000);

  it('returns [] for a space with no hooks/ dir', async () => {
    mkdirSync(join(root, 'spaces', 'integration-empty'), { recursive: true });
    expect(await loadSpaceHooks(root, 'integration-empty')).toEqual([]);
  });
});
