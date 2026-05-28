import type { YieldRequest } from '../eval/yield.js';

export interface DelegateQuery {
  query: string;
  context?: unknown;
  output?: Record<string, string>;
}

export interface DelegateOpts {
  query?: string;
  context?: unknown;
}

/**
 * Create the `delegate` global. Ends the current turn; runs a child agent.
 */
export function createDelegateGlobal(
  pushYield: (req: YieldRequest) => void,
): (target: string, queryOrAction: DelegateQuery | string, opts?: DelegateOpts) => Promise<unknown> {
  return function delegate(
    target: string,
    queryOrAction: DelegateQuery | string,
    opts?: DelegateOpts,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'delegate',
        args: [target, queryOrAction, opts],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
