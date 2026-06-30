import type { YieldRequest } from '../eval/yield.js';

export interface RegisterSpaceResult {
  ok: boolean;
  /** The key to pass as the first argument to delegate(). Equal to the dir path. */
  spaceKey: string;
  /** Slug of the first agent found in the registered space. */
  agentSlug: string;
  error?: string;
}

/**
 * Create the `registerSpace` global. Ends the current turn; loads the space at
 * `dir` into the live DelegateRegistry so `delegate()` can reach it immediately.
 *
 * Usage in model-generated TS:
 *   const reg = await registerSpace('/tmp/architect-spaces/analyst');
 *   if (!reg.ok) throw new Error(reg.error);
 *   const result = await delegate(reg.spaceKey, reg.agentSlug, 'run', { query: '...' });
 */
export function createRegisterSpaceGlobal(
  pushYield: (req: YieldRequest) => void,
): (dir: string) => Promise<RegisterSpaceResult> {
  return function registerSpace(dir: string): Promise<RegisterSpaceResult> {
    return new Promise<RegisterSpaceResult>((resolve, reject) => {
      pushYield({
        kind: 'registerSpace',
        args: [dir],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
