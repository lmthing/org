import type { ProjectDb, WriteListener } from '../store.js';
import { HookDispatcher, matchEventHooks, type DispatchEvent, type LoadedHook } from './index.js';
import { runHook, type HookManager, type Hook } from '../../server/routes/hooks.js';
import { makeHookTasklistRunner } from '../../server/tasklist-runner.js';
import { scanEmitterDefs } from '../../server/emitter-manifests.js';
import { validateEmitted } from '../../server/event-dispatch.js';
import { invokeDefaultFnInWorker } from '../worker-load.js';

/** How long an event hook is coalesced after firing (loop-guard cooldown). */
const HOOK_COOLDOWN_MS = 5_000;

/** Wall-clock ceiling for one worker-isolated db-emitter `emit(row)` (same env
 *  knob family as the webhook/internal pure-emit paths — ops tune ONE number). */
const EMIT_TIMEOUT_MS = Number(process.env['LMTHING_EMITTER_EMIT_TIMEOUT_MS']) || 5_000;

/** Flatten a loaded EVENT hook into 6C's dispatch shape (keeps `owner` +
 *  `connections` so runHook applies the space own-provider lock + worker shim). */
function toRunHook(l: LoadedHook): Hook {
  const d = l.def as {
    type?: string;
    trigger?: string;
    handler?: Hook['handler'];
    connections?: string[];
    budget?: Hook['budget'];
  };
  return {
    slug: l.slug,
    type: d.type,
    owner: (l as { owner?: string }).owner,
    trigger: d.trigger,
    handler: d.handler,
    connections: d.connections,
    budget: d.budget,
  };
}

/**
 * Per-project DB-write → EVENT dispatch (Phase 6; unified in S6). Wires the
 * project's db `onWrite` seam → the decoupled dispatch queue → 6C's `runHook`.
 *
 * S6 replaced `{type:'database'}` hooks with the event pipeline. A committed db
 * write now produces two kinds of events, both enqueued into the SAME
 * {@link HookDispatcher} (so per-slug coalesce, budget-pending, snapshot-drain,
 * depth cap + self-write exclusion + cooldown all still bound the loop):
 *   1. a SYNTHETIC `project/db.<table>.<event>` event whose payload IS the
 *      written row — the direct replacement for what database hooks subscribed
 *      to (an event hook `on:{event:'project/db.posts.insert'}` reads it as
 *      `ctx.input`). Enqueued SYNCHRONOUSLY (fast path, preserves decoupling).
 *   2. any `{type:'db'}` EMITTER def's typed events — the def's PURE `emit(row)`
 *      runs worker-isolated (no ctx handlers), its output validated against the
 *      def's `emits` schema, each surviving event enqueued at its own address
 *      (`<scope>/<event>`). This runs on a follow-up microtask (the worker emit
 *      is async) and re-arms a drain — never on the write's synchronous path.
 *
 * The DECOUPLING invariant holds: a committed write ENQUEUES and returns; the
 * queue drains on the NEXT event-loop tick (setImmediate), never re-entrantly.
 *
 * The loop guard rides an ambient `currentDepth`/`currentSlug`: while a
 * hook-triggered run executes, its own db writes fire `onWrite` and are stamped
 * with THAT hook's depth+slug (captured synchronously at write time), so the
 * dispatcher applies the depth cap (3) and self-write exclusion. Runs drain
 * sequentially, so the ambient context is unambiguous.
 */
export class ProjectHookRuntime {
  private dispatcher: HookDispatcher;
  /** The project's EVENT hooks (subscribers matched per event address). MUTATED IN
   *  PLACE by {@link reload} — the dispatcher holds this same array reference, so a
   *  newly authored hook joins the subscriber set without rebuilding (and therefore
   *  without dropping) the live queue. */
  private readonly eventHooks: LoadedHook[] = [];
  private draining = false;
  private drainScheduled = false;
  // Ambient context of the currently-running hook (0 = a user/agent write, not a hook).
  private currentDepth = 0;
  private currentSlug: string | undefined = undefined;

  constructor(
    private readonly projectId: string,
    private readonly lmthingRoot: string,
    private readonly manager: HookManager,
    private readonly projectDb: ProjectDb,
    hooks: LoadedHook[],
  ) {
    this.setHooks(hooks);
    this.dispatcher = new HookDispatcher({ hooks: this.eventHooks, cooldownMs: HOOK_COOLDOWN_MS });
    const listener: WriteListener = (e) => this.onDbWrite(e);
    projectDb.setOnWrite(listener);
  }

  private setHooks(hooks: LoadedHook[]): void {
    this.eventHooks.length = 0;
    for (const h of hooks) {
      if ((h.def as { type?: string }).type === 'event') this.eventHooks.push(h);
    }
  }

  /**
   * Adopt a freshly loaded hook set (after a live-project authoring write). The db-write
   * → event dispatch is wired ONCE, when the project's db first boots; without this a
   * hook the automator authors AFTERWARDS would never fire on a db write until the pod
   * restarted (found live in scenario 01 — "whenever a tip is stored, summarize it" is
   * authored after the table that booted the db).
   */
  reload(hooks: LoadedHook[]): void {
    this.setHooks(hooks);
  }

  /** Detach the write listener (server shutdown / project reload). */
  dispose(): void {
    this.projectDb.setOnWrite(undefined);
  }

  private onDbWrite(e: { table: string; event: 'insert' | 'update' | 'remove'; rows: unknown[] }): void {
    // Capture the ambient cascade context SYNCHRONOUSLY — the async emitter path
    // below resolves later, by when `currentDepth`/`currentSlug` may have moved on.
    const depth = this.currentDepth;
    const slug = this.currentSlug;
    // Representative row (matches the pre-S6 database-hook behavior of `rows[0]`);
    // a burst coalesces to a single fire anyway, so this is the row that survives.
    const row = (Array.isArray(e.rows) ? e.rows[0] : undefined) as Record<string, unknown> | undefined;

    // 1. Synthetic raw-table event — the database-hook replacement. Enqueue
    //    synchronously so a subscriber reacts on the same decoupled ladder.
    const synthetic: DispatchEvent = {
      address: `project/db.${e.table}.${e.event}`,
      payload: row ?? {},
      hookDepth: depth,
      ...(slug !== undefined ? { originatingHookSlug: slug } : {}),
    };
    if (this.dispatcher.enqueue(synthetic).length > 0) this.scheduleDrain();

    // 2. `{type:'db'}` emitter defs — worker-isolated pure emit(row) → typed
    //    events. Off the write's synchronous path (fire-and-forget, guarded).
    void this.enqueueDbEmitterEvents(e, row, depth, slug).catch((err) => {
      console.warn(
        `[hooks] db-emitter dispatch failed for "${this.projectId}" (${e.table}.${e.event}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    });
  }

  /** Scan the project's `{type:'db'}` emitter defs, run each matching def's pure
   *  `emit(row)` worker-isolated, validate its output, and enqueue the surviving
   *  typed events (each at `<scope>/<event>`). Re-arms a drain if anything queued. */
  private async enqueueDbEmitterEvents(
    e: { table: string; event: 'insert' | 'update' | 'remove'; rows: unknown[] },
    row: Record<string, unknown> | undefined,
    depth: number,
    slug: string | undefined,
  ): Promise<void> {
    if (row === undefined) return;
    const { scopes } = await scanEmitterDefs(this.lmthingRoot, this.projectId);
    let enqueuedAny = false;
    for (const [scope, scopeDefs] of Object.entries(scopes)) {
      for (const def of scopeDefs.defs) {
        if (def.def.type !== 'db') continue;
        if (def.def.on.table !== e.table || def.def.on.event !== e.event) continue;
        // Pure emit: EMPTY handlers (the worker's db/callConnection proxies reject
        // if a db emitter tries to touch them — db emitters are pure transforms).
        let raw: unknown;
        try {
          raw = await invokeDefaultFnInWorker(
            def.file,
            'emit',
            { table: e.table, event: e.event, row },
            {},
            { timeoutMs: EMIT_TIMEOUT_MS },
          );
        } catch (err) {
          console.warn(
            `[hooks] db-emitter "${scope}/${def.name}" emit failed: ` +
              (err instanceof Error ? err.message : String(err)),
          );
          continue;
        }
        const emitted = validateEmitted(def.def.emits, raw, `${scope}/${def.name}`);
        for (const ev of emitted) {
          const event: DispatchEvent = {
            address: `${scope}/${ev.event}`,
            payload: ev.payload,
            hookDepth: depth,
            ...(slug !== undefined ? { originatingHookSlug: slug } : {}),
            ...(ev.threadKey ? { threadKey: ev.threadKey } : {}),
          };
          if (this.dispatcher.enqueue(event).length > 0) enqueuedAny = true;
        }
      }
    }
    if (enqueuedAny) this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.draining) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.dispatcher.drain(async (entry) => {
        const hook = this.eventHooks.find((h) => h.slug === entry.slug);
        if (!hook) return;
        const prevDepth = this.currentDepth;
        const prevSlug = this.currentSlug;
        this.currentDepth = entry.hookDepth;
        this.currentSlug = entry.slug;
        try {
          const outcome = await runHook(this.manager, this.lmthingRoot, this.projectId, toRunHook(hook), undefined, {
            // The event payload is the handler's ctx.input (and a trigger's kickoff seed).
            input: entry.event.payload,
            // S8: thread the cascade depth so the fire's `hook.fired` internal signal
            // carries the REAL depth (+1), keeping signal-derived cascades on the same
            // bounded ladder as db cascades.
            hookDepth: entry.event.hookDepth,
            tasklistRunner: makeHookTasklistRunner(this.manager, this.lmthingRoot, this.projectId),
          });
          if (outcome.queued) return { budgetExhausted: true };
        } finally {
          this.currentDepth = prevDepth;
          this.currentSlug = prevSlug;
        }
      });
    } finally {
      this.draining = false;
    }
    // A hook-triggered run may have enqueued cascaded events DURING the drain above:
    // its db writes fire `onDbWrite` while `this.draining` was true, so `scheduleDrain`
    // was suppressed and the dispatcher's snapshot-up-front drain never saw them.
    // Re-arm a fresh drain tick so the cascade continues on the next tick — still
    // non-re-entrant, and bounded by the loop guard's depth cap (3), so it terminates.
    if (this.dispatcher.queued.length > 0) this.scheduleDrain();
  }
}
