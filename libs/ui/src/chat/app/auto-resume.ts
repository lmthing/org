// ─── Integration auto-resume helpers (S13) ────────────────────────────────────
// Pure, DOM-free helpers behind the chat Integrations tab's "save → wait for the
// pod to come back → nudge THING to continue" flow. Kept side-effect-free and
// injectable so the gating (never post before the pod is serving; never post
// twice; surface a retry on timeout instead of silently dropping) is unit-testable.

/** Overlay THIS page's integration keys onto the pod's full env map for a PUT.
 *  The gateway `PUT /api/compute/env` REPLACES the whole var set, so callers must
 *  GET the current map first and overlay only the keys they own (mirrors
 *  studio/shell/project-settings-view save). Absent field values become `''`
 *  (an explicit unset) rather than dropping the key. */
export function overlayEnvKeys(
  current: Record<string, string>,
  keys: string[],
  fields: Record<string, string>,
): Record<string, string> {
  const all = { ...current };
  for (const k of keys) all[k] = fields[k] ?? '';
  return all;
}

/** Injectable clock/probe surface so `waitForPodReady` is deterministic in tests. */
export interface PodReadyDeps {
  /** Resolves `true` once the pod's edge serves again AND the chat socket is live
   *  (so a follow-up `sendMessage` actually reaches the agent, never silently
   *  dropped against a closed socket). */
  probe: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface PodReadyOpts {
  timeoutMs?: number;
  intervalMs?: number;
  /** A short grace period before the first probe: the env PUT triggers a rolling
   *  restart, and the OLD pod can still answer for a beat before it terminates. */
  initialDelayMs?: number;
}

/**
 * Poll `deps.probe()` until it reports the restarted pod is serving again, or
 * throw once `timeoutMs` elapses. The throw is deliberate — the caller turns it
 * into a visible Retry affordance rather than dropping the resume nudge.
 */
export async function waitForPodReady(
  deps: PodReadyDeps,
  { timeoutMs = 90_000, intervalMs = 1_000, initialDelayMs = 1_500 }: PodReadyOpts = {},
): Promise<void> {
  const deadline = deps.now() + timeoutMs;
  await deps.sleep(initialDelayMs);
  while (deps.now() < deadline) {
    if (await deps.probe()) return;
    await deps.sleep(intervalMs);
  }
  throw new Error("Your workspace is taking a while to restart — the keys were saved.");
}

/** The resume message posted into the active chat once the pod is back. Stable +
 *  idempotent wording so a caller can dedupe on it if needed. */
export function resumeMessage(spaceId: string): string {
  return `Integration "${spaceId}" is now configured — please continue.`;
}
