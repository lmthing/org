/**
 * `createEmitEventResolver` (plan S10) — the pod half of the agent-facing
 * `emitEvent(name, payload)`: declared-event validation against the CALLER's
 * scope, payload-schema validation, the manual-cascade depth cap (lockstep with
 * `HOOK_DEPTH_CAP`), and dispatch threading (sourceScope + S8 `hookDepth`).
 * The scan + dispatch seams are faked — the real ones are covered by
 * `emitter-manifests.test.ts` / `webhook-emitter-dispatch.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import { HOOK_DEPTH_CAP } from '../app/hooks/loop-guard.js';
import { createEmitEventResolver, type EmitEventResolverConfig } from './emit-event.js';
import type { EventDispatchManager, DispatchEmittedEventsArgs } from './event-dispatch.js';
import type { EmitterScanResult } from './emitter-manifests.js';

/** A scan fixture: one space scope declaring `message.posted {text}` and a
 *  project scope declaring `order.created {id}`. */
function fakeScan(): Promise<EmitterScanResult> {
  return Promise.resolve({
    scopes: {
      'integration-x': {
        defs: [],
        declaredEvents: { 'message.posted': { payload: { text: 'string' } } },
        envRefs: [],
      },
      project: {
        defs: [],
        declaredEvents: { 'order.created': { payload: { id: 'string' } } },
        envRefs: [],
      },
    },
  });
}

const manager = {} as EventDispatchManager; // passed through to the (faked) dispatch

function makeResolver(over: Partial<EmitEventResolverConfig> = {}): {
  resolver: ReturnType<typeof createEmitEventResolver>;
  dispatched: DispatchEmittedEventsArgs[];
} {
  const dispatched: DispatchEmittedEventsArgs[] = [];
  const resolver = createEmitEventResolver({
    root: '/data/.lmthing',
    projectId: 'user',
    manager,
    scan: () => fakeScan(),
    dispatch: async (args) => {
      dispatched.push(args);
    },
    ...over,
  });
  return { resolver, dispatched };
}

describe('createEmitEventResolver — declared-event validation', () => {
  it('dispatches a declared event with the caller scope + validated payload + hookDepth', async () => {
    const { resolver, dispatched } = makeResolver();
    const result = await resolver('message.posted', { text: 'hi' }, 'integration-x');
    expect(result).toEqual({ ok: true, event: 'integration-x/message.posted' });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      root: '/data/.lmthing',
      projectId: 'user',
      sourceScope: 'integration-x',
      emitted: [{ event: 'message.posted', payload: { text: 'hi' } }],
      hookDepth: 0,
    });
  });

  it('rejects an UNDECLARED event, naming the scope contract', async () => {
    const { resolver, dispatched } = makeResolver();
    await expect(resolver('order.created', { id: '1' }, 'integration-x')).rejects.toThrow(
      /"order\.created" is not declared by scope "integration-x".*message\.posted/s,
    );
    expect(dispatched).toHaveLength(0);
  });

  it('rejects a scope with NO emitter defs at all', async () => {
    const { resolver } = makeResolver();
    await expect(resolver('anything', {}, 'integration-unknown')).rejects.toThrow(/declared events: \(none\)/);
  });

  it('rejects a schema-mismatched payload without dispatching', async () => {
    const { resolver, dispatched } = makeResolver();
    await expect(resolver('message.posted', { text: 123 }, 'integration-x')).rejects.toThrow(
      /payload for "integration-x\/message\.posted" does not match/,
    );
    expect(dispatched).toHaveLength(0);
  });
});

describe('createEmitEventResolver — manual-cascade depth cap', () => {
  it(`refuses a cascade ${HOOK_DEPTH_CAP} levels deep (lockstep with the hook loop guard)`, async () => {
    // A dispatch whose "subscriber" immediately emits again — the worst-case
    // self-feeding chain. The SHARED depth counter must stop it at the cap.
    const depth = { value: 0 };
    const dispatchDepths: number[] = [];
    const resolver = createEmitEventResolver({
      root: '/r',
      projectId: 'user',
      manager,
      depth,
      scan: () => fakeScan(),
      dispatch: async (args) => {
        dispatchDepths.push(args.hookDepth ?? -1);
        await resolver('order.created', { id: 'again' }, 'project'); // nested emit
      },
    });

    await expect(resolver('order.created', { id: '1' }, 'project')).rejects.toThrow(
      new RegExp(`depth cap \\(${HOOK_DEPTH_CAP}\\) reached`),
    );
    // Exactly CAP dispatches ran (depths 0..CAP-1), the CAP-th emit was refused,
    // and the counter unwound cleanly.
    expect(dispatchDepths).toEqual([...Array(HOOK_DEPTH_CAP).keys()]);
    expect(depth.value).toBe(0);
  });

  it('sequential (non-nested) emits do not accumulate depth', async () => {
    const depth = { value: 0 };
    const { resolver } = makeResolver({ depth });
    for (let i = 0; i < HOOK_DEPTH_CAP + 2; i++) {
      await resolver('order.created', { id: String(i) }, 'project');
    }
    expect(depth.value).toBe(0);
  });
});
