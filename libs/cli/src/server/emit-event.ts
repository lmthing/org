/**
 * Pod-side resolver for the agent-facing `emitEvent(name, payload)` global
 * (plan S10, capability `events:emit`). The core global bakes the caller's
 * `sourceScope` into its host closure at injection (never sandbox-controlled);
 * this resolver:
 *
 *   1. validates `name` against the CALLER scope's declared-event union
 *      (`scanEmitterDefs(...).scopes[sourceScope].declaredEvents` — the same
 *      contract webhook/cron/db emitters are held to),
 *   2. validates the payload against that event's declared field schema
 *      ({@link validateEmitted} — an empty result means the payload mismatched),
 *   3. depth-caps the manual cascade in lockstep with the hook loop guard
 *      ({@link HOOK_DEPTH_CAP}): a manual emit whose subscribers' agent runs emit
 *      again (and so on) is refused once the chain is CAP deep, and
 *   4. dispatches via {@link dispatchEmittedEvents} with `sourceScope` = the
 *      caller's scope, threading the chain depth as `hookDepth` (S8) so the
 *      internal-signal loop guard sees manual emits like any other hook firing.
 *
 * The depth counter is SHARED per pod ({@link SessionManager} holds one) because
 * a nested manual emit arrives through a DIFFERENT session's resolver (the
 * subscriber's headless run) — a per-resolver counter would never see the chain.
 * Concurrent unrelated emits briefly inflate each other's depth; acceptable for
 * a loop guard (fail-closed direction) on a single-user pod.
 */

import { HOOK_DEPTH_CAP } from '../app/hooks/loop-guard.js';
import { scanEmitterDefs } from './emitter-manifests.js';
import { dispatchEmittedEvents, validateEmitted, type EventDispatchManager } from './event-dispatch.js';
import type { EmitEventResolver, EmitEventResult } from '@lmthing/core';

/** Shared (per-pod) manual-emit chain depth — see module doc. */
export interface ManualEmitDepth {
  value: number;
}

/** Configuration for {@link createEmitEventResolver}. `scan`/`dispatch` are
 *  injectable test seams (default to the real modules). */
export interface EmitEventResolverConfig {
  /** The pod projects root. */
  root: string;
  /** The project whose emitter defs + event hooks are in scope. */
  projectId: string;
  /** The run seam for subscribing hooks (the concrete SessionManager). */
  manager: EventDispatchManager;
  /** SHARED depth counter (one per pod/manager). Defaults to a private one —
   *  fine for tests, but production must pass the manager-wide counter. */
  depth?: ManualEmitDepth;
  scan?: typeof scanEmitterDefs;
  dispatch?: typeof dispatchEmittedEvents;
}

/**
 * Build the {@link EmitEventResolver} for one project. Wired onto
 * `AppGlobalImpls.emitEvent` by the SessionManager for project-rooted sessions;
 * the yield router calls it with `(name, payload, sourceScope)`.
 */
export function createEmitEventResolver(cfg: EmitEventResolverConfig): EmitEventResolver {
  const depth = cfg.depth ?? { value: 0 };
  const scan = cfg.scan ?? scanEmitterDefs;
  const dispatch = cfg.dispatch ?? dispatchEmittedEvents;

  return async (name, payload, sourceScope): Promise<EmitEventResult> => {
    // 1. Declared-event validation against the CALLER's scope. Undeclared names
    //    fail loud with the scope's actual contract, so the agent can correct.
    const scanResult = await scan(cfg.root, cfg.projectId);
    const declared = scanResult.scopes[sourceScope]?.declaredEvents ?? {};
    if (!(name in declared)) {
      const known = Object.keys(declared).sort().join(', ') || '(none)';
      throw new Error(
        `emitEvent: "${name}" is not declared by scope "${sourceScope}" — declared events: ${known}. ` +
          `Declare it in an events/*.ts emitter def's \`emits\` first.`,
      );
    }

    // 2. Payload-schema validation (shared with every other emitter kind).
    const emitted = validateEmitted(declared, [{ event: name, payload }], `${sourceScope}/emitEvent`);
    if (emitted.length === 0) {
      throw new Error(
        `emitEvent: payload for "${sourceScope}/${name}" does not match its declared schema — ` +
          `check the event's \`emits\` field types`,
      );
    }

    // 3. Manual-cascade depth cap, in lockstep with the hook loop guard.
    const chainDepth = depth.value;
    if (chainDepth >= HOOK_DEPTH_CAP) {
      throw new Error(
        `emitEvent: manual-emit depth cap (${HOOK_DEPTH_CAP}) reached — refusing to cascade deeper ` +
          `(an emit's subscribers emitted again, ${chainDepth} levels down)`,
      );
    }

    // 4. Dispatch to subscribing event hooks. Awaited so the agent's result is
    //    truthful ("subscribers ran"); the shared counter stays raised for the
    //    whole window so nested emits see their chain depth.
    depth.value = chainDepth + 1;
    try {
      await dispatch({
        root: cfg.root,
        projectId: cfg.projectId,
        sourceScope,
        emitted,
        manager: cfg.manager,
        hookDepth: chainDepth,
      });
    } finally {
      depth.value--;
    }

    return { ok: true, event: `${sourceScope}/${name}` };
  };
}
