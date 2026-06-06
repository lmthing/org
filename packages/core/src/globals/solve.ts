import type { YieldRequest } from '../eval/yield.js';
import type { SolveYieldOpts } from '../fork/solve.js';

/**
 * Create the `solve` global. Ends the current turn; runs the verifier-gated
 * escalation ladder host-side (single → retry-with-feedback → race-N), bounded
 * by the run's budget. Like `tasklist`, the orchestration of multiple forks
 * happens in the host — not via VM yields — so it resolves in one await.
 */
export function createSolveGlobal(
  pushYield: (req: YieldRequest) => void,
): (opts: SolveYieldOpts) => Promise<unknown> {
  return function solve(opts: SolveYieldOpts): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'solve',
        args: [opts],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
