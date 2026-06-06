import type { YieldRequest } from '../eval/yield.js';

export interface DelegateOpts {
  query?: string;
  context?: unknown;
}

/**
 * Create the `delegate` global. Ends the current turn; runs a child agent action.
 */
export function createDelegateGlobal(
  pushYield: (req: YieldRequest) => void,
): (packageName: string, agentName: string, action: string, opts?: DelegateOpts) => Promise<unknown> {
  return function delegate(
    packageName: string,
    agentName: string,
    action: string,
    opts?: DelegateOpts,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'delegate',
        args: [packageName, agentName, action, opts],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
