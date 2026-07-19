import type { YieldRequest } from '../eval/yield.js';
import type { AppCheckResult } from '../db/types.js';

/**
 * Create the `buildApp` global — the agent-facing entry that BUILDS and
 * programmatically CHECKS the session's live-project app (lint → typecheck → esbuild
 * bundle) and resolves the structured {@link AppCheckResult} (exit-status + the error
 * list — programmatic ground truth, never a model self-assessment). A build gate node
 * calls it, reads `errors[]`, fixes the offending file, and calls it again until the
 * app is clean (or fails loudly); a clean resolve sets `built:true` for ALL routes.
 *
 * Value-yielding, exactly like `apiCall`/`fetch` — the underlying esbuild + tsc are
 * heavy and async (with the pod's build serialization + memory-pressure guards), so it
 * ends the current turn and resumes once the host resolver runs. Injected only when the
 * agent holds `pages:write` (the same grant as the page/component writers it verifies);
 * the host resolver is threaded through the yield router
 * (`YieldRouterContext.buildAppResolver`). If no resolver is present (a session outside
 * a project-app), the yield rejects with a clear, retryable error rather than binding
 * undefined.
 */
export function createBuildAppGlobal(
  pushYield: (req: YieldRequest) => void,
): () => Promise<AppCheckResult> {
  return function buildApp(): Promise<AppCheckResult> {
    return new Promise<AppCheckResult>((resolve, reject) => {
      pushYield({
        kind: 'buildApp',
        args: [],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
