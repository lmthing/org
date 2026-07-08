import type { YieldRequest } from '../eval/yield.js';

/**
 * Create the `apiCall` global — the agent-facing entry to the project's own
 * `api/` endpoints. Dual-addressed with the browser path: both enter the SAME
 * main-process api runtime by endpoint `name`. Value-yielding, exactly like
 * `fetch`/`delegate` — it ends the current turn and resumes once the host
 * resolves the endpoint (which runs the handler worker-isolated). Injected only
 * when the agent holds `api:call`; the host resolver is threaded through the
 * yield router (`YieldRouterContext.apiCallResolver`). If no resolver is present
 * (a session outside a project-app, or a project with no `api/` dir), the yield
 * rejects with a clear, retryable error rather than silently binding undefined.
 */
export function createApiCallGlobal(
  pushYield: (req: YieldRequest) => void,
): (name: string, input?: unknown) => Promise<unknown> {
  return function apiCall(name: string, input?: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'apiCall',
        args: [name, input],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
