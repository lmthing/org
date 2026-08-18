/**
 * Harness selection — which execution engine runs a project's agent sessions.
 *
 * lmthing historically had ONE engine: the `@lmthing/core` QuickJS/TypeScript-REPL
 * runtime, hard-wired into {@link Session}. This module introduces the seam that
 * lets a project choose between engines:
 *
 * - `'lmthing'` — the built-in QuickJS statement-streaming runtime (the default;
 *   unchanged behaviour).
 * - `'dsh'` — the DeepSeek Harness (Cordis) runtime, embedded in-process, with the
 *   lmthing-compat plugin bundle (space-format loading + app serving) mounted.
 *
 * This file is deliberately dependency-free: it only knows the id set and the
 * resolution rule. The provider seam that actually *builds* a session for a
 * chosen harness lives in `session-manager.ts` (see `HarnessProvider`), which is
 * where {@link Session} and the build wiring already are.
 *
 * Resolution order (see {@link resolveHarness}): an explicit per-project value
 * wins; otherwise the pod-wide default from `LMTHING_HARNESS`; otherwise
 * {@link DEFAULT_HARNESS}.
 */

/** Every harness a pod can run. Order is display order (settings surfaces). */
export const HARNESS_IDS = ['lmthing', 'dsh'] as const;

/** The engine that runs a project's agent sessions. */
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * The engine used when neither the project nor the pod expresses a preference.
 * Always `'lmthing'`: the built-in runtime is the only one guaranteed present,
 * so an unconfigured pod behaves exactly as it did before harness selection.
 */
export const DEFAULT_HARNESS: HarnessId = 'lmthing';

/** Type guard: is `v` one of the known harness ids? */
export function isHarnessId(v: unknown): v is HarnessId {
  return typeof v === 'string' && (HARNESS_IDS as readonly string[]).includes(v);
}

/** Narrow an unknown (parsed JSON, env var, request field) to a `HarnessId`, or
 *  `undefined` when it names no known harness. Never throws — an unknown value is
 *  simply "no preference", which resolution then fills from the next source. */
export function coerceHarnessId(v: unknown): HarnessId | undefined {
  return isHarnessId(v) ? v : undefined;
}

/**
 * The pod-wide default harness, read from `LMTHING_HARNESS`. Returns `undefined`
 * (not {@link DEFAULT_HARNESS}) when unset or invalid, so {@link resolveHarness}
 * can distinguish "pod said lmthing" from "pod said nothing" — both currently
 * land on lmthing, but keeping them distinct lets a future pod default to dsh
 * without every unconfigured project silently following.
 */
export function harnessEnvDefault(env: NodeJS.ProcessEnv = process.env): HarnessId | undefined {
  return coerceHarnessId(env['LMTHING_HARNESS']);
}

/**
 * Resolve the effective harness for a session.
 *
 * @param project - the project's stored `harness` field (may be undefined/invalid).
 * @param envDefault - the pod default (typically {@link harnessEnvDefault}'s result).
 * @returns the project value if valid, else the pod default if valid, else
 *   {@link DEFAULT_HARNESS}.
 */
export function resolveHarness(project?: unknown, envDefault?: unknown): HarnessId {
  return coerceHarnessId(project) ?? coerceHarnessId(envDefault) ?? DEFAULT_HARNESS;
}
