import type { YieldRequest } from '../eval/yield.js';

export interface ForkGlobalOpts {
  instruction: string;
  output: Record<string, string>;
  seed?: Record<string, unknown>;
  timeout?: number;
  taskId?: string;
  upstreamOutputs?: Record<string, unknown>;
}

/**
 * Create the `fork` global. Ends the current turn; spawns a child VM.
 */
export function createForkGlobal(
  pushYield: (req: YieldRequest) => void,
): (opts: ForkGlobalOpts) => Promise<unknown> {
  return function fork(opts: ForkGlobalOpts): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'fork',
        args: [opts],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
