import type { YieldRequest } from '../eval/yield.js';

/** Presence-only configuration status of an installed integration space in the
 *  CURRENT project. `missingRequired` lists the settings-schema `required` env-var
 *  NAMES that are absent/empty on the pod — NEVER any values. `ready` is
 *  `missingRequired.length === 0` (and the space is an installed integration). */
export interface IntegrationStatus {
  ready: boolean;
  missingRequired: string[];
}

/** Host resolver for the `integrationStatus` global — supplied by libs/cli (which
 *  knows the project root + `process.env`) and threaded through the yield router.
 *  Absent ⇒ an `integrationStatus` yield rejects with a clear, retryable error. */
export type IntegrationStatusResolver = (spaceId: string) => Promise<IntegrationStatus>;

/**
 * Create the `integrationStatus` global — the agent-facing check for whether an
 * installed integration space has all its required keys configured. Value-yielding,
 * exactly like `apiCall`/`callConnection`: it ends the current turn and resumes once
 * the host resolves presence-only status (names of missing required env vars — never
 * their values, which never enter the sandbox / LLM context). Injected only for
 * project-rooted sessions; the host resolver is threaded through the yield router
 * (`YieldRouterContext.integrationStatusResolver`), and if absent (no project scope)
 * the yield rejects with a clear error rather than silently binding undefined.
 */
export function createIntegrationStatusGlobal(
  pushYield: (req: YieldRequest) => void,
): (spaceId: string) => Promise<IntegrationStatus> {
  return function integrationStatus(spaceId: string): Promise<IntegrationStatus> {
    return new Promise<IntegrationStatus>((resolve, reject) => {
      pushYield({
        kind: 'integrationStatus',
        args: [spaceId],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
