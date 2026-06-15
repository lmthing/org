import type { YieldRequest } from '../eval/yield.js';

export interface DelegateOpts {
  query?: string;
  context?: unknown;
}

/**
 * Create the `delegate` global. Ends the current turn; runs a child agent.
 *
 * `action` is OPTIONAL: with an action id the child runs that action (its tasklist
 * if it has one); without one the child runs model-driven, sees its available
 * actions/tasklists in its system prompt, and may initiate a tasklist itself.
 * For ergonomics, `delegate(pkg, agent, opts)` (opts object in the action slot) is
 * accepted as the no-action form.
 */
export function createDelegateGlobal(
  pushYield: (req: YieldRequest) => void,
): (packageName: string, agentName: string, action?: string, opts?: DelegateOpts) => Promise<unknown> {
  return function delegate(
    packageName: string,
    agentName: string,
    action?: string | DelegateOpts,
    opts?: DelegateOpts,
  ): Promise<unknown> {
    // Allow delegate(pkg, agent, opts) — opts passed positionally where action goes.
    let resolvedAction: string | undefined;
    let resolvedOpts: DelegateOpts | undefined;
    if (action !== null && typeof action === 'object') {
      resolvedAction = undefined;
      resolvedOpts = action;
    } else {
      resolvedAction = action;
      resolvedOpts = opts;
    }
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'delegate',
        args: [packageName, agentName, resolvedAction, resolvedOpts],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
