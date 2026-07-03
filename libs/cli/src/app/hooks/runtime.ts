import type { ProjectDb, WriteListener } from '../store.js';
import { HookDispatcher, matchDatabaseHooks, type LoadedHook, type WriteEvent } from './index.js';
import { runHook, type HookManager, type Hook } from '../../server/routes/hooks.js';

/** How long a db hook is coalesced after firing (loop-guard cooldown). */
const HOOK_COOLDOWN_MS = 5_000;

/** Flatten 6A's `LoadedHook { slug, def }` into 6C's dispatch shape. */
function toFlat(l: LoadedHook): Hook {
  const d = l.def as { type?: string; trigger?: string; handler?: Hook['handler']; budget?: Hook['budget'] };
  return { slug: l.slug, type: d.type, trigger: d.trigger, handler: d.handler, budget: d.budget };
}

/**
 * Per-project `database`-hook dispatch (Phase 6). Wires the project's db `onWrite`
 * seam → the decoupled 6A dispatch queue → 6C's `runHook`. The DECOUPLING invariant:
 * a committed write ENQUEUES matching hooks and returns; the queue drains on the NEXT
 * event-loop tick (setImmediate), after the current eval unwinds — never re-entrantly.
 *
 * The loop guard rides an ambient `currentDepth`/`currentSlug`: while a hook-triggered
 * run executes, its own db writes (agent sync db, main-process) fire `onWrite` and are
 * stamped with THAT hook's depth+slug, so `HookDispatcher` applies the depth cap (3) and
 * self-write exclusion. Runs drain sequentially, so the ambient context is unambiguous.
 */
export class ProjectHookRuntime {
  private dispatcher: HookDispatcher;
  private dbHooks: LoadedHook[];
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
    this.dbHooks = hooks.filter((h) => (h.def as { type?: string }).type === 'database');
    this.dispatcher = new HookDispatcher({ hooks: this.dbHooks, cooldownMs: HOOK_COOLDOWN_MS });
    const listener: WriteListener = (e) => this.onDbWrite(e);
    projectDb.setOnWrite(listener);
  }

  /** Detach the write listener (server shutdown / project reload). */
  dispose(): void {
    this.projectDb.setOnWrite(undefined);
  }

  private onDbWrite(e: { table: string; event: 'insert' | 'update' | 'remove'; rows: unknown[] }): void {
    // Fast-path: nothing to do if no database hook targets this table+event.
    const event: WriteEvent = {
      table: e.table,
      event: e.event,
      rows: e.rows,
      hookDepth: this.currentDepth,
      originatingHookSlug: this.currentSlug,
    };
    if (matchDatabaseHooks(this.dbHooks, event).length === 0) return;
    // ENQUEUE only — decoupled. The queue drains after the current eval unwinds.
    this.dispatcher.enqueue(event);
    this.scheduleDrain();
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
        const hook = this.dbHooks.find((h) => h.slug === entry.slug);
        if (!hook) return;
        const prevDepth = this.currentDepth;
        const prevSlug = this.currentSlug;
        this.currentDepth = entry.hookDepth;
        this.currentSlug = entry.slug;
        try {
          const row = Array.isArray(entry.event.rows) ? entry.event.rows[0] : undefined;
          const outcome = await runHook(this.manager, this.lmthingRoot, this.projectId, toFlat(hook), row);
          if (outcome.queued) return { budgetExhausted: true };
        } finally {
          this.currentDepth = prevDepth;
          this.currentSlug = prevSlug;
        }
      });
    } finally {
      this.draining = false;
    }
  }
}
