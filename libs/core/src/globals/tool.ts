import type { YieldRequest } from '../eval/yield.js';

/**
 * Create the `tool` global — the agent-facing entry to a host-registered tool
 * (specifically: an OpenClaw plugin tool loaded via `@lmthing/openclaw-compat`).
 * Value-yielding, exactly like `apiCall`/`callConnection`/`fetch`: it ends the
 * current turn and resumes once the host resolves the tool call (dispatched to
 * the loaded plugin registry). Injected only when the agent holds `tools:use`;
 * the per-grant DTS (built in `buildAppCapabilityDts`/`composeToolDts`) types
 * `name` to the granted allow-list, so a call to a tool the agent didn't
 * declare fails typecheck. The host resolver is threaded through the yield
 * router (`YieldRouterContext.toolResolver`); if absent (no pod tool registry
 * configured) the yield rejects with a clear, retryable error rather than
 * silently binding undefined.
 */
export function createToolGlobal(
  pushYield: (req: YieldRequest) => void,
): (name: string, input?: unknown) => Promise<unknown> {
  return function tool(name: string, input?: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'tool',
        args: [name, input],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
