import { resolve, sep } from 'node:path';
import type { YieldRequest } from '../eval/yield.js';

/**
 * `emitEvent(name, payload)` (plan S10) — MANUAL event publication into the
 * unified event pipeline, gated on the `events:emit` capability.
 *
 * The event must be DECLARED by the calling agent's own scope (an `events/*.ts`
 * emitter def's `emits`); the cli resolver validates name + payload against the
 * scope's declared-event union (`scanEmitterDefs(...).scopes[scope].declaredEvents`)
 * and dispatches via `dispatchEmittedEvents` with `sourceScope` = the caller's
 * scope, depth-capped in lockstep with the hook loop guard.
 *
 * The emitting scope is derived HOST-side at injection ({@link deriveEventScope}
 * from the VM's spaceDir/projectRoot) and baked into the global's closure, so
 * sandbox code cannot spoof another scope's events: an agent whose space dir
 * lives under `<project>/spaces/<id>` emits as `<id>`, everything else emits as
 * `'project'`.
 */

/** Resolution of a successful `emitEvent` — `event` is the source-qualified
 *  address subscribers matched on (`<scope>/<name>`). */
export interface EmitEventResult {
  ok: boolean;
  event: string;
}

/** Host resolver for `emitEvent` — supplied by libs/cli (which owns the emitter
 *  scan + dispatch) on `AppGlobalImpls.emitEvent` and threaded through the yield
 *  router. `sourceScope` arrives from the global's host closure (never from
 *  sandbox args). Absent ⇒ an `emitEvent` yield rejects with a clear error. */
export type EmitEventResolver = (
  name: string,
  payload: Record<string, unknown>,
  sourceScope: string,
) => Promise<EmitEventResult>;

/**
 * The emitting scope for a VM: the space id when `spaceDir` sits under
 * `<projectRoot>/spaces/<id>`, else `'project'` (project agents, system/user
 * spaces, sessions outside a project). Matches the emitter scan's scope ids.
 */
export function deriveEventScope(spaceDir: string, projectRoot?: string): string {
  if (!projectRoot) return 'project';
  const spacesPrefix = resolve(projectRoot, 'spaces') + sep;
  const dir = resolve(spaceDir);
  if (!dir.startsWith(spacesPrefix)) return 'project';
  const first = dir.slice(spacesPrefix.length).split(sep).filter(Boolean)[0];
  return first || 'project';
}

/**
 * Create the `emitEvent` global — value-yielding, exactly like `apiCall`. The
 * `sourceScope` is fixed at injection time (host-derived, see module doc).
 */
export function createEmitEventGlobal(
  pushYield: (req: YieldRequest) => void,
  sourceScope: string,
): (name: string, payload: Record<string, unknown>) => Promise<EmitEventResult> {
  return function emitEvent(name: string, payload: Record<string, unknown>): Promise<EmitEventResult> {
    return new Promise<EmitEventResult>((resolve, reject) => {
      pushYield({
        kind: 'emitEvent',
        args: [name, payload, sourceScope],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
