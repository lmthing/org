/**
 * TaskEnvelope — the typed degradation signal for tasklist results (Phase 3 of
 * the reliability plan).
 *
 * Historically a fork that never resolved was salvaged with a schema-valid
 * placeholder whose STRING fields carried alarming prose ("(unavailable — the
 * subagent could not produce a synthesis…)"). Orchestrating models read that
 * text in the data plane and went off-script instead of proceeding
 * (.issues/thing-abandons-build-on-salvaged-research.md). Degradation is now a
 * typed signal code can branch on:
 *
 *   - `data` is ALWAYS schema-shaped; salvaged fields are neutral empties
 *     ("" / 0 / false / [] / {}) with NO prose note.
 *   - `ok` / `degraded` / `reason` / `degradedTasks` carry the health of the
 *     run in the control plane, out of the data.
 */
export interface TaskEnvelope<T = unknown> {
  /** true iff the goal task's resolve() was called with a schema-valid value (no salvage). */
  ok: boolean;
  /** Any salvage occurred — this task, or any inner task for tasklists. */
  degraded: boolean;
  /** ALWAYS schema-shaped; salvaged fields are neutral empties. */
  data: T;
  /** Why the (goal) result was salvaged, when it was. */
  reason?: 'no_resolve' | 'schema_mismatch' | 'budget' | 'timeout';
  /** Tasklist-level: which tasks (and forEach elements, e.g. "investigate[3]") were salvaged. */
  degradedTasks?: string[];
}

/** Degradation reason codes — see `TaskEnvelope.reason`. */
export type DegradeReason = NonNullable<TaskEnvelope['reason']>;

/**
 * Build a schema-valid NEUTRAL placeholder object for a fork that never
 * resolved: each field gets a type-appropriate empty value. Strings are ""
 * (no prose note — degradation is signalled via the envelope, never inside
 * the data plane).
 */
export function salvageData(schema: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, rawType] of Object.entries(schema ?? {})) {
    const t = String(rawType).toLowerCase();
    if (t.includes('[]') || t.includes('array')) out[key] = [];
    else if (t.includes('number') || t.includes('int') || t.includes('float')) out[key] = 0;
    else if (t.includes('bool')) out[key] = false;
    else if (t.includes('object') || t.includes('record') || t.startsWith('{')) out[key] = {};
    else out[key] = '';
  }
  return out;
}
