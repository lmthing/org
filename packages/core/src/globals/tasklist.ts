import type { YieldRequest } from '../eval/yield.js';

/**
 * Create the `tasklist` global. Ends the current turn; runs a named tasklist.
 */
export function createTasklistGlobal(
  pushYield: (req: YieldRequest) => void,
): (name: string) => Promise<unknown> {
  return function tasklist(name: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'tasklist',
        args: [name],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
