import type { YieldRequest } from '../eval/yield.js';
import type { ConnectionRequest } from '../db/types.js';

/**
 * Create the `callConnection` global — the agent/space-function entry to a
 * user-connected external service (Google/Slack/GitHub/…). Value-yielding,
 * exactly like `apiCall`/`fetch`: it ends the current turn and resumes once the
 * host resolves the request through the gateway egress proxy. Injected only when
 * the agent holds `connections:use`; the per-grant DTS (built in
 * `buildAppCapabilityDts`) types `provider` to the granted providers, so a call
 * to a provider the agent didn't declare fails typecheck. The host resolver is
 * threaded through the yield router (`YieldRouterContext.connectionResolver`); if
 * absent (no pod connections gateway configured) the yield rejects with a clear,
 * retryable error rather than silently binding undefined.
 *
 * The OAuth token never enters the sandbox: the sandbox supplies only
 * `provider` + `{ method, path, query?, body?, headers? }`; the gateway attaches
 * the token and pins the outbound host to the provider's API base.
 */
export function createCallConnectionGlobal(
  pushYield: (req: YieldRequest) => void,
): (provider: string, req: ConnectionRequest) => Promise<unknown> {
  return function callConnection(provider: string, req: ConnectionRequest): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'callConnection',
        args: [provider, req],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
