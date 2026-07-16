/** The fields the model may set on the current session. Both optional; the host
 *  ignores empty/non-string values and slugifies `slug`. */
export interface SessionMetaInput {
  /** Human-readable conversation title (replaces the auto-derived first-message title). */
  title?: string;
  /** Human-friendly, URL-safe handle for the session. Normalized host-side. */
  slug?: string;
}

export interface SetSessionMetaResult {
  ok: boolean;
}

/**
 * Create the `setSessionMeta` global — top-level session only (like `ask`, it is
 * NOT injected into forks/delegates). FIRE-AND-FORGET: it runs as a bridged host
 * function, calls the host `onSessionMeta` hook synchronously, and returns — it does
 * NOT push a yield, so it does NOT end the turn. That is deliberate: `setSessionMeta`
 * ending the turn was why the agent, which finishes most requests in one or two
 * turns, kept skipping it (it could not both name AND answer in one turn). Now it can
 * name the session inline at zero turn cost. The host slugifies + records the
 * title/slug and emits a `session_meta` trace event the server ingests to persist.
 *
 * Usage in model-generated TS:
 *   setSessionMeta({ title: 'Pasta night', slug: 'pasta-night' });
 */
export function createSetSessionMetaGlobal(
  onSessionMeta: (meta: SessionMetaInput) => boolean,
): (meta: SessionMetaInput) => SetSessionMetaResult {
  return function setSessionMeta(meta: SessionMetaInput): SetSessionMetaResult {
    const ok = onSessionMeta(meta ?? {});
    return { ok };
  };
}
