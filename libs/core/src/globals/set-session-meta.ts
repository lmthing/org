import type { YieldRequest } from '../eval/yield.js';

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
 * NOT injected into forks/delegates). Ends the current turn; the host records the
 * title/slug on the session and emits a `session_meta` trace event that the server
 * ingests to update + persist the SessionEntry.
 *
 * Usage in model-generated TS:
 *   await setSessionMeta({ title: 'Pasta night', slug: 'pasta-night' });
 */
export function createSetSessionMetaGlobal(
  pushYield: (req: YieldRequest) => void,
): (meta: SessionMetaInput) => Promise<SetSessionMetaResult> {
  return function setSessionMeta(meta: SessionMetaInput): Promise<SetSessionMetaResult> {
    return new Promise<SetSessionMetaResult>((resolve, reject) => {
      pushYield({
        kind: 'setSessionMeta',
        args: [meta],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
