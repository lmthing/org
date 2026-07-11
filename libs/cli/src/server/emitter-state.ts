/**
 * Cron-emitter per-def STATE (S6) — `<projectRoot>/.data/emitter-state.json`.
 *
 * A `cron` emitter def polls on a schedule and often needs a scratchpad that
 * survives across ticks (a cursor, a last-seen id, an ETag). {@link
 * makeEmitterStateStore} gives one def a tiny persisted JSON KV — `get(key)` /
 * `set(key, value)` — that the pod services main-side for the worker-isolated
 * `emit(ctx)` run (via the `state` worker proxy; see `app/worker-load.ts`).
 *
 * Storage: ONE file per project (`.data/emitter-state.json`, next to
 * `webhook-threads.json` + `hooks-state.json`), a map
 * `"<scope>/<defName>" → { key: value }`. Non-executable (plain JSON), tolerant
 * of a missing/corrupt file (treated as empty — it is state, not source of
 * truth), and **size-capped**: a `set` that would push ONE def's serialized KV
 * past {@link EMITTER_STATE_MAX_BYTES} is REJECTED (throws, so the emit's
 * `await ctx.state.set(...)` surfaces the error) and not persisted — a hostile
 * or buggy def can't balloon the pod's disk through its scratchpad.
 *
 * Mirrors `webhook-threads.ts`'s read-modify-write posture: the store re-reads
 * the whole file per op (cron emitters run sequentially + infrequently, so the
 * churn is negligible) and only ever touches its OWN `<scope>/<defName>` slot,
 * so two different defs writing near-simultaneously never clobber each other's
 * slot (a lost update can only affect the same def's own concurrent writes,
 * which don't happen — one emit at a time per def).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** A per-def persisted JSON KV handle handed to a cron emitter's `ctx.state`. */
export interface EmitterStateStore {
  /** Read one key (or `undefined` when absent). */
  get(key: string): Promise<unknown>;
  /** Write one key. Rejects (throws) when the def's serialized KV would exceed
   *  {@link EMITTER_STATE_MAX_BYTES} — the write is NOT persisted. */
  set(key: string, value: unknown): Promise<void>;
}

/** Per-def serialized-KV ceiling (~256KB). A `set` past it is rejected. */
export const EMITTER_STATE_MAX_BYTES = 256 * 1024;

/** `"<scope>/<defName>" → { key → value }`. */
type EmitterStateMap = Record<string, Record<string, unknown>>;

/** The canonical on-disk path for a project's emitter state. */
export function emitterStatePath(projectRoot: string): string {
  return join(projectRoot, '.data', 'emitter-state.json');
}

/** Load the whole map, tolerating a missing/corrupt file (returns `{}`). */
async function loadEmitterState(projectRoot: string): Promise<EmitterStateMap> {
  let text: string;
  try {
    text = await readFile(emitterStatePath(projectRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {}; // corrupt → start clean (state is a cache, not truth)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map: EmitterStateMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) map[k] = v as Record<string, unknown>;
  }
  return map;
}

/** Persist the whole map (creating `.data/` if needed). */
async function saveEmitterState(projectRoot: string, map: EmitterStateMap): Promise<void> {
  const path = emitterStatePath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
}

/**
 * Build the {@link EmitterStateStore} for ONE emitter def, keyed by
 * `(projectId via projectRoot, scope, defName)`. Every op is a read-modify-write
 * of the shared `.data/emitter-state.json`, touching only this def's slot.
 */
export function makeEmitterStateStore(projectRoot: string, scope: string, name: string): EmitterStateStore {
  const slot = `${scope}/${name}`;
  return {
    async get(key: string): Promise<unknown> {
      const map = await loadEmitterState(projectRoot);
      return map[slot]?.[key];
    },
    async set(key: string, value: unknown): Promise<void> {
      const map = await loadEmitterState(projectRoot);
      const def = { ...(map[slot] ?? {}), [key]: value };
      const bytes = Buffer.byteLength(JSON.stringify(def), 'utf8');
      if (bytes > EMITTER_STATE_MAX_BYTES) {
        console.warn(
          `[emitter-state] rejecting set("${key}") for "${slot}": def state would be ${bytes} bytes ` +
            `(> ${EMITTER_STATE_MAX_BYTES}); not persisted`,
        );
        throw new Error(`emitter state for "${slot}" exceeds ${EMITTER_STATE_MAX_BYTES} bytes — set rejected`);
      }
      map[slot] = def;
      await saveEmitterState(projectRoot, map);
    },
  };
}
