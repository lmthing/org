/**
 * Internal SIGNAL seam (S8) — the process-local bus that lets lmthing observe
 * ITSELF through the unified event pipeline. Instrumented runtime paths
 * (session lifecycle, hook fires, space installs, document writes, project
 * creates — see the curated set below) call {@link emitInternalSignal}; a
 * routing sink installed once at serve boot ({@link installInternalSignalSink})
 * fans each signal out to every `internal`-type emitter def whose `on.signal`
 * matches, runs the def's PURE `emit({name, data})` worker-isolated, validates
 * the result against the def's declared `emits`, and dispatches the surviving
 * events to subscribing event hooks ({@link dispatchEmittedEvents}).
 *
 * ── Fire-and-forget guarantees (HARD requirements) ───────────────────────────
 * {@link emitInternalSignal} must NEVER throw into — or slow — the instrumented
 * path. It is a synchronous enqueue: push onto an in-memory queue + arm a
 * `setImmediate` drain, the whole body inside a try/catch. No awaits, no i/o,
 * no scan on the caller's stack; a broken/hostile emitter def, a missing sink,
 * or a bus bug can never break a session, a hook run, or an install. Signals
 * fired before the sink is installed (early boot) are DROPPED by design.
 *
 * ── The initial signal set (S12's integration-lmthing defs bind to these) ────
 *   session.started    { projectId, agent, sessionId, spaceRef? }
 *   session.completed  { projectId, agent, sessionId, spaceRef?, ok, durationMs }
 *   agent.delegated    { projectId, from?, to }
 *   space.installed    { projectId, spaceId? }
 *   hook.fired         { projectId, slug, hookType }
 *   document.written   { projectId, path }
 *   project.created    { projectId }
 * `data.projectId` scopes the fan-out to that one project; a signal without it
 * fans out to EVERY project the sink can list.
 *
 * ── Loop protection ──────────────────────────────────────────────────────────
 * A signal may originate from hook-triggered work (`hook.fired` carries
 * `meta.originatingHookSlug` + `meta.hookDepth`). Two guards keep the
 * signal→def→event→hook→signal cycle bounded, mirroring the db loop guard:
 *   1. DEPTH CAP — a signal whose `meta.hookDepth` is at/beyond
 *      {@link HOOK_DEPTH_CAP} (imported from `app/hooks/loop-guard.ts` — one
 *      constant for every cascade kind) is dropped before any dispatch.
 *   2. SELF-TRIGGER SUPPRESSION — `meta.originatingHookSlug` is threaded to
 *      {@link dispatchEmittedEvents} as `skipHookSlug`, so a `hook.fired`-derived
 *      event can never re-trigger the very hook that fired it.
 * Hooks fired from a dispatch at depth d emit their own `hook.fired` at d+1
 * (see `routes/hooks.ts` `runHook`), so an A→B→A ping-pong still terminates.
 *
 * The drain is concurrency-bounded: ONE signal at a time, each project/def
 * processed sequentially (the sink is observability plumbing, not a hot path —
 * `scanEmitterDefs` is mtime-cached, so per-signal scans are cheap after the
 * first).
 */

import { HOOK_DEPTH_CAP } from '../app/hooks/loop-guard.js';
import { invokeDefaultFnInWorker } from '../app/worker-load.js';
import { scanEmitterDefs, type EmitterScanResult } from './emitter-manifests.js';
import {
  dispatchEmittedEvents,
  validateEmitted,
  type EventDispatchManager,
} from './event-dispatch.js';

/** Wall-clock ceiling for one worker-isolated `emit(signal)` run (same env knob
 *  as the webhook emit path, so ops tune ONE number for all pure emits). */
const EMIT_TIMEOUT_MS = Number(process.env['LMTHING_EMITTER_EMIT_TIMEOUT_MS']) || 5000;

/** Loop-protection metadata a signal may carry when it originates from
 *  hook-triggered work (see the module header). */
export interface InternalSignalMeta {
  /** How many hook firings already sit in this signal's causal chain
   *  (0/absent = not hook-derived). At/beyond {@link HOOK_DEPTH_CAP} the sink
   *  drops the signal. */
  hookDepth?: number;
  /** The hook whose run produced this signal — its derived events never
   *  re-trigger that same slug (threaded as `skipHookSlug` into dispatch). */
  originatingHookSlug?: string;
}

/** The payload of one signal. `projectId` (when present) scopes the fan-out. */
export type InternalSignalData = Record<string, unknown> & { projectId?: string };

interface QueuedSignal {
  name: string;
  data: InternalSignalData;
  meta?: InternalSignalMeta;
}

/** Dependencies for {@link installInternalSignalSink}. The seams (`scan`,
 *  `invokeEmit`, `dispatch`, `timeoutMs`) default to the real implementations
 *  and exist so tests can exercise the routing/loop-protection logic without
 *  spawning workers. */
export interface InternalSignalSinkOpts {
  /** The pod projects root (`.lmthing`). */
  root: string;
  /** The run seam handed to {@link dispatchEmittedEvents} (trigger runs +
   *  handler-hook ctx). The concrete `SessionManager` satisfies it. */
  manager: EventDispatchManager;
  /** Enumerate the project ids a projectId-less signal fans out to (exclude the
   *  synthetic `system` project, matching the other pod-wide scans). */
  listProjectIds: () => Promise<string[]>;
  /** Test seam — defaults to {@link scanEmitterDefs}. */
  scan?: (root: string, projectId: string) => Promise<EmitterScanResult>;
  /** Test seam — defaults to a worker-isolated {@link invokeDefaultFnInWorker}
   *  `emit(signal)` call with EMPTY capability handlers (internal emits are pure;
   *  the worker's db/delegate/callConnection proxies reject if touched). */
  invokeEmit?: (
    file: string,
    signal: { name: string; data: Record<string, unknown> },
    timeoutMs: number,
  ) => Promise<unknown>;
  /** Test seam — defaults to {@link dispatchEmittedEvents}. */
  dispatch?: typeof dispatchEmittedEvents;
  /** Per-emit worker timeout override (defaults to {@link EMIT_TIMEOUT_MS}). */
  timeoutMs?: number;
}

// ── Module-singleton bus state ────────────────────────────────────────────────
// One sink per process (the pod has one serve loop); installed at boot,
// re-installable by tests. All mutation happens on the main thread.

let sink: InternalSignalSinkOpts | undefined;
const queue: QueuedSignal[] = [];
let scheduled = false;
let draining = false;
let currentDrain: Promise<void> | null = null;

/**
 * Emit one internal signal — fire-and-forget, from anywhere in the pod.
 *
 * NEVER throws and never slows the caller: the body is a synchronous
 * queue-push + `setImmediate` arm inside a full try/catch. All routing (scan,
 * worker emit, validation, dispatch) happens later on the drain task. With no
 * sink installed (early boot, bare tests) the signal is silently dropped.
 */
export function emitInternalSignal(
  name: string,
  data: InternalSignalData,
  meta?: InternalSignalMeta,
): void {
  try {
    if (!sink) return; // no sink — drop (fire-and-forget; early-boot signals are uninteresting)
    queue.push({ name, data, ...(meta ? { meta } : {}) });
    scheduleDrain();
  } catch {
    /* HARD guarantee: never throw into the instrumented path. */
  }
}

/**
 * Install the routing sink (once, at serve boot). Returns an uninstall fn
 * (tests). A re-install replaces the previous sink (last wins, with a warn) —
 * production installs exactly once.
 */
export function installInternalSignalSink(opts: InternalSignalSinkOpts): () => void {
  if (sink) console.warn('[internal-signals] sink re-installed (replacing the previous one)');
  const installed = opts;
  sink = installed;
  return () => {
    if (sink === installed) sink = undefined;
  };
}

/** Test seam — drop the sink and any queued signals (afterEach hygiene). */
export function resetInternalSignals(): void {
  sink = undefined;
  queue.length = 0;
}

/**
 * Await until every queued signal (including ones enqueued by cascades during
 * the wait) has fully routed. Test/diagnostic helper ONLY — production code
 * never awaits the bus (that would defeat fire-and-forget).
 */
export async function flushInternalSignals(): Promise<void> {
  while (queue.length > 0 || scheduled || draining || currentDrain) {
    if (currentDrain) await currentDrain;
    else await new Promise<void>((r) => setImmediate(r));
  }
}

// ── Drain (one signal at a time) ──────────────────────────────────────────────

function scheduleDrain(): void {
  // An in-flight drain's while-loop picks up new pushes itself; only arm a new
  // macrotask when nothing is scheduled or running.
  if (scheduled || draining) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    currentDrain = drainAll().finally(() => {
      currentDrain = null;
    });
  });
}

/** Route every queued signal, strictly sequentially (concurrency bound = 1).
 *  Each signal's failure is isolated with a warn — the drain itself never rejects. */
async function drainAll(): Promise<void> {
  draining = true;
  try {
    while (queue.length > 0) {
      const s = queue.shift()!;
      try {
        await routeSignal(s);
      } catch (err) {
        console.warn(
          `[internal-signals] routing "${s.name}" failed: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  } finally {
    draining = false;
  }
}

/** Route ONE signal: depth-cap guard → project fan-out → matching internal defs
 *  → worker emit → schema-validate → dispatch (with loop-protection threading). */
async function routeSignal(s: QueuedSignal): Promise<void> {
  const cfg = sink;
  if (!cfg) return; // uninstalled between enqueue and drain (tests)

  // 1. DEPTH CAP — same constant as the db cascade guard (loop-guard.ts): a
  //    signal already ≥ cap deep in a hook cascade routes no further.
  const depth = s.meta?.hookDepth ?? 0;
  if (depth >= HOOK_DEPTH_CAP) {
    console.warn(
      `[internal-signals] dropping "${s.name}": hook cascade depth ${depth} reached the cap (${HOOK_DEPTH_CAP})`,
    );
    return;
  }

  // 2. Fan-out scope: the signal's own project, else every project.
  const explicit = typeof s.data['projectId'] === 'string' && s.data['projectId'] ? [s.data['projectId']] : undefined;
  const projectIds = explicit ?? (await cfg.listProjectIds());

  const scan = cfg.scan ?? scanEmitterDefs;
  const invokeEmit =
    cfg.invokeEmit ??
    ((file: string, signal: { name: string; data: Record<string, unknown> }, timeoutMs: number) =>
      // Pure emit: EMPTY capability handlers — the worker's proxies reject if touched.
      invokeDefaultFnInWorker(file, 'emit', signal, {}, { timeoutMs }));
  const dispatch = cfg.dispatch ?? dispatchEmittedEvents;
  const timeoutMs = cfg.timeoutMs ?? EMIT_TIMEOUT_MS;

  for (const projectId of projectIds) {
    // 3. Matching internal defs across the project's scopes. A scan failure
    //    skips just this project (fail-soft — the bus must never destabilize).
    let result: EmitterScanResult;
    try {
      result = await scan(cfg.root, projectId);
    } catch (err) {
      console.warn(
        `[internal-signals] scan failed for "${projectId}": ` +
          (err instanceof Error ? err.message : String(err)),
      );
      continue;
    }

    for (const scope of Object.values(result.scopes)) {
      for (const d of scope.defs) {
        if (d.def.type !== 'internal' || d.def.on.signal !== s.name) continue;

        // 4. Worker-isolated pure emit — a throwing/hanging def is contained
        //    here (timeout + catch) and can never reach the instrumented path.
        let raw: unknown;
        try {
          raw = await invokeEmit(d.file, { name: s.name, data: s.data }, timeoutMs);
        } catch (err) {
          console.warn(
            `[internal-signals] emit failed for "${d.scope}/${d.name}" on "${s.name}": ` +
              (err instanceof Error ? err.message : String(err)),
          );
          continue;
        }

        // 5. Declared-schema validation (drop-with-warn, shared with S5).
        const emitted = validateEmitted(d.def.emits, raw, `${d.scope}/${d.name}`);
        if (emitted.length === 0) continue;

        // 6. Dispatch to subscribing event hooks, threading the loop guards:
        //    hookDepth rides into the hooks' own `hook.fired` signals (d+1);
        //    the origin slug suppresses self-re-triggering.
        try {
          await dispatch({
            root: cfg.root,
            projectId,
            sourceScope: d.scope,
            emitted,
            manager: cfg.manager,
            hookDepth: depth,
            ...(s.meta?.originatingHookSlug !== undefined
              ? { skipHookSlug: s.meta.originatingHookSlug }
              : {}),
          });
        } catch (err) {
          console.warn(
            `[internal-signals] dispatch failed for "${d.scope}/${d.name}" on "${s.name}": ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
      }
    }
  }
}
