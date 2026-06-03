import type { YieldRequest } from '../eval/yield.js';

/**
 * Create the `tasklist` global. Ends the current turn; runs a named tasklist.
 * Accepts an optional seed object to pass context variables to all fork tasks.
 */
export function createTasklistGlobal(
  pushYield: (req: YieldRequest) => void,
): (name: string, seed?: Record<string, unknown>) => Promise<unknown> {
  return function tasklist(name: string, seed?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'tasklist',
        args: [name, seed],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
