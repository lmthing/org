/**
 * Emitted-event DISPATCH (S5) — the seam between a producer's emitted events and
 * the CONSUMER-side event hooks that subscribe to them.
 *
 * A webhook emitter def (verified inbound → pure `emit(inbound)`, in
 * `routes/webhooks.ts`) — and later a cron/db/internal emitter (S6/S8) — produces
 * a list of typed {@link Emitted} events. {@link dispatchEmittedEvents} takes that
 * list, source-qualifies each event's address (`<scope>/<event>`, where the
 * project scope is literally `'project'`), finds every subscribing event hook
 * across the PROJECT and every installed SPACE ({@link loadAllHooks}), and runs
 * each:
 *
 *   - a `trigger` hook → a headless agent run via the manager (mirrors how
 *     `routes/webhooks.ts` runs a legacy webhook trigger). When the emitted event
 *     carries a `threadKey`, the run continues ONE persisted multi-turn session
 *     per (address, threadKey) via {@link getOrCreateThreadSession} +
 *     `runHeadlessThreaded`, exactly like inbound webhook threading.
 *   - a `handler` hook → {@link runHook} with the emitted event as `ctx.input`
 *     (`{ event, payload, threadKey? }`). The handler's declared `connections:`
 *     gate + (for space hooks) worker isolation + own-provider lock all apply as
 *     S7 built them — this module just supplies the structured input.
 *
 * DIRECT dispatch: async + sequential per event. This is the RIGHT path for
 * webhook/cron/internal-originated events — they arrive one-at-a-time from an
 * external edge (an inbound POST, a cron tick, a runtime signal) and need no
 * post-commit coalescing. Only DB-write-originated dispatch routes through the
 * unified `app/hooks/dispatcher.ts` queue (S6): a burst of same-table writes made
 * during one eval must collapse to a single non-re-entrant fire, which is exactly
 * what the coalescing queue + snapshot-drain provide. Both paths share ONE event
 * matcher ({@link matchEventHooks}, re-exported from `app/hooks/loop-guard.ts`)
 * and ONE depth cap, so the loop-guard bounds are uniform across event kinds.
 */

import { join } from 'node:path';

import { validateOutput, type Emitted, type EmitsSchema } from '@lmthing/core';

import { loadAllHooks, matchEventHooks, type EventHookDef, type LoadedHook } from '../app/hooks/index.js';
import { getOrCreateThreadSession } from './webhook-threads.js';
import { emitInternalSignal } from './internal-signals.js';
import { runHook, type Hook, type HookBudget, type HookManager } from './routes/hooks.js';

// The pure event matcher is shared with the db-coalesced queue — re-exported so
// existing importers of `event-dispatch.matchEventHooks` keep working.
export { matchEventHooks };

/** The manager surface event dispatch needs: `runHeadless` + `getProjectDb` (both
 *  from {@link HookManager}, for trigger runs and handler-hook ctx) plus threaded
 *  runs for `threadKey`-carrying triggers. The concrete `SessionManager` satisfies
 *  it. */
export interface EventDispatchManager extends HookManager {
  /** Like `runHeadless`, but continues a persisted multi-turn session bound to
   *  `sessionId` (resume if a snapshot exists, else start) — for threaded triggers. */
  runHeadlessThreaded(args: {
    sessionId: string;
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
    budget?: HookBudget;
  }): Promise<unknown>;
}

/** Injectable thread-session resolver (defaults to the on-disk
 *  {@link getOrCreateThreadSession}) — a seam so tests can observe threading
 *  without touching the filesystem. */
export type ThreadSessionResolver = (projectRoot: string, addr: string, threadKey: string) => Promise<string>;

/** Arguments for {@link dispatchEmittedEvents}. */
export interface DispatchEmittedEventsArgs {
  /** The pod projects root. */
  root: string;
  /** The project whose event hooks may subscribe. */
  projectId: string;
  /** The EMITTING scope: `'project'` or a `<spaceId>`. Prefixes the event name
   *  into the source-qualified address subscribers match on. */
  sourceScope: string;
  /** The validated events to dispatch (already schema-checked by the caller). */
  emitted: Emitted[];
  /** The run seam (trigger runs + handler-hook ctx db). */
  manager: EventDispatchManager;
  /** Optional thread-session resolver override (tests). */
  threading?: ThreadSessionResolver;
  /** Loop protection (S8, additive): how many hook firings already sit in this
   *  dispatch's causal chain (absent/0 = a fresh external/inbound event). Rides
   *  into each fired hook so ITS `hook.fired` internal signal carries depth+1 —
   *  the signal sink drops the cascade at `HOOK_DEPTH_CAP`. */
  hookDepth?: number;
  /** Loop protection (S8, additive): a subscribing hook with THIS slug is
   *  skipped — a `hook.fired`-derived event must never re-trigger the very hook
   *  whose run originated it (self-trigger suppression). */
  skipHookSlug?: string;
}

/** Parse `space/agent#action` → the pieces a headless run wants (local copy —
 *  keeps this module free of a compile-time dep on the hooks route's private fn). */
function parseTrigger(trigger: string): { spaceRef: string; agentSlug: string; action: string } {
  const hash = trigger.indexOf('#');
  const spaceRef = hash >= 0 ? trigger.slice(0, hash) : trigger;
  const action = hash >= 0 ? trigger.slice(hash + 1) : '';
  const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
  return { spaceRef, agentSlug, action };
}

/** Best-effort JSON for embedding the emitted event into a trigger's kickoff
 *  message (mirrors the hooks route's spawn-input serialization). */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Flatten a {@link LoadedHook} into the flat {@link Hook} shape {@link runHook}
 *  dispatches on. (The hooks route has an equivalent private `toFlat`; this is the
 *  event-hook-only view.) A space hook's `handler` is already the worker shim
 *  installed by `loadSpaceHooks`, so it stays worker-isolated when runHook invokes it. */
function toRunHook(l: LoadedHook): Hook {
  const d = l.def as EventHookDef;
  return {
    slug: l.slug,
    type: d.type,
    owner: l.owner,
    ...(d.trigger !== undefined ? { trigger: d.trigger } : {}),
    ...(d.handler !== undefined ? { handler: d.handler as Hook['handler'] } : {}),
    ...(d.connections !== undefined ? { connections: d.connections } : {}),
    ...(d.budget !== undefined ? { budget: d.budget } : {}),
  };
}

/** Run one `trigger` event hook: a headless agent run seeded with the emitted
 *  event. A `threadKey` continues one persisted session per (address, key). */
async function runTriggerHook(
  manager: EventDispatchManager,
  projectRoot: string,
  projectId: string,
  hook: LoadedHook,
  def: EventHookDef,
  address: string,
  ev: Emitted,
  resolveThread: ThreadSessionResolver,
): Promise<void> {
  const { spaceRef, agentSlug, action } = parseTrigger(def.trigger!);
  const message =
    `Event "${address}" fired` +
    (action ? ` — perform the "${action}" action.` : '.') +
    `\nPayload: ${safeStringify({ event: ev.event, payload: ev.payload, ...(ev.threadKey ? { threadKey: ev.threadKey } : {}) })}`;
  const budget = def.budget;
  if (ev.threadKey === undefined) {
    await manager.runHeadless({ projectId, spaceRef, agentSlug, message, budget });
    return;
  }
  // Threaded: stable session per (event address, external threadKey) — the SAME
  // continuity mechanism inbound webhooks use, namespaced by the event address so
  // two different events never collide even when a producer reuses key values.
  const sessionId = await resolveThread(projectRoot, `event:${address}`, ev.threadKey);
  await manager.runHeadlessThreaded({ sessionId, projectId, spaceRef, agentSlug, message, budget });
}

/**
 * Dispatch a producer's emitted events to their subscribing event hooks. For
 * each event: source-qualify the address, match subscribing hooks (project +
 * space), and run each (trigger → headless run; handler → {@link runHook} with the
 * event as `ctx.input`). A single failing hook is logged and skipped — one bad
 * subscriber must not sink the rest. Fire-and-forget by the caller (agent runs may
 * be slow); the whole scan is fail-soft.
 */
export async function dispatchEmittedEvents(args: DispatchEmittedEventsArgs): Promise<void> {
  const { root, projectId, sourceScope, emitted, manager } = args;
  if (emitted.length === 0) return;
  const resolveThread = args.threading ?? getOrCreateThreadSession;
  const projectRoot = join(root, projectId);

  let hooks: LoadedHook[];
  try {
    hooks = await loadAllHooks(projectRoot);
  } catch {
    hooks = [];
  }

  for (const ev of emitted) {
    // Source-qualify: the project scope is literally 'project', a space scope its id.
    const address = `${sourceScope}/${ev.event}`;
    const subs = matchEventHooks(hooks, address);
    for (const hook of subs) {
      // Self-trigger suppression (S8): an event derived from THIS hook's own
      // `hook.fired` signal must not fire it again.
      if (args.skipHookSlug !== undefined && hook.slug === args.skipHookSlug) {
        console.warn(
          `[event-dispatch] suppressing hook "${hook.slug}" for "${address}": its own run originated this event`,
        );
        continue;
      }
      const def = hook.def as EventHookDef;
      try {
        if (typeof def.trigger === 'string') {
          // S8 instrumentation: TRIGGER event hooks don't funnel through runHook
          // (they go straight to a headless run), so their `hook.fired` signal is
          // emitted here — with the same origin+depth meta runHook stamps.
          emitInternalSignal(
            'hook.fired',
            { projectId, slug: hook.slug, hookType: 'event' },
            { originatingHookSlug: hook.slug, hookDepth: (args.hookDepth ?? 0) + 1 },
          );
          await runTriggerHook(manager, projectRoot, projectId, hook, def, address, ev, resolveThread);
        } else {
          // handler → runHook with the emitted event's PAYLOAD as ctx.input — the
          // SAME shape the db-write path delivers (`input = row`, runtime.ts), so a
          // handler reads `ctx.input` uniformly whether it subscribes to
          // `project/db.<table>.<event>` or `<space>/<event>` (it already knows the
          // event name from its own `on:{event}`). The declared `connections:` gate +
          // (space hooks) worker isolation apply inside runHook. `hookDepth` threads
          // the S8 cascade depth into runHook's own `hook.fired`. Direct (not queued):
          // a webhook/cron/internal event arrives singly from an external edge, so it
          // needs no post-commit coalescing (db writes do — S6).
          await runHook(manager, root, projectId, toRunHook(hook), undefined, {
            input: ev.payload,
            ...(args.hookDepth !== undefined ? { hookDepth: args.hookDepth } : {}),
          });
        }
      } catch (err) {
        console.warn(
          `[event-dispatch] hook "${hook.slug}" failed for "${address}": ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }
}

/**
 * Validate a producer's raw `emit(...)` return into the {@link Emitted} events
 * that are actually dispatchable: each must name a DECLARED event (a key of the
 * def's `emits`) and carry a `payload` that fits that event's declared field
 * schema ({@link validateOutput}). Invalid items are DROPPED with a `console.warn`
 * (a hostile/buggy emitter can't smuggle an undeclared or mistyped event into the
 * pipeline). `where` prefixes each warning (pass `<scope>/<defName>`).
 */
export function validateEmitted(emits: EmitsSchema, raw: unknown, where: string): Emitted[] {
  if (!Array.isArray(raw)) {
    console.warn(`[event-dispatch] emitter "${where}" did not return an array of events — dropping all`);
    return [];
  }
  const out: Emitted[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      console.warn(`[event-dispatch] emitter "${where}" produced a non-object event — dropped`);
      continue;
    }
    const e = item as Record<string, unknown>;
    const event = e['event'];
    if (typeof event !== 'string' || !(event in emits)) {
      console.warn(`[event-dispatch] emitter "${where}" produced undeclared event ${JSON.stringify(event)} — dropped`);
      continue;
    }
    const payload = e['payload'];
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      console.warn(`[event-dispatch] event "${where}/${event}" has a non-object payload — dropped`);
      continue;
    }
    if (!validateOutput(emits[event]!.payload, payload)) {
      console.warn(`[event-dispatch] event "${where}/${event}" payload does not match its declared schema — dropped`);
      continue;
    }
    const threadKey = e['threadKey'];
    out.push({
      event,
      payload: payload as Record<string, unknown>,
      ...(typeof threadKey === 'string' && threadKey ? { threadKey } : {}),
    });
  }
  return out;
}
