import type { YieldRequest } from '../eval/yield.js';
import type { Clock } from '../session/types.js';

/**
 * Parse a human-readable duration string to milliseconds.
 * Supports: "500ms", "1s", "2min", "3h"
 */
export function parseDuration(duration: string): number {
  const trimmed = duration.trim().toLowerCase();

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|min|m|h|hr|hrs)$/);
  if (!match) {
    throw new Error(`sleep(): cannot parse duration "${duration}"`);
  }

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm':
    case 'min': return value * 60 * 1000;
    case 'h':
    case 'hr':
    case 'hrs': return value * 60 * 60 * 1000;
    default: throw new Error(`sleep(): unknown unit "${unit}"`);
  }
}

/**
 * Create the `sleep` global. Ends the current turn; schedules a resume after
 * the given delay.
 */
export function createSleepGlobal(
  pushYield: (req: YieldRequest) => void,
  clock?: Clock,
): (duration: string) => Promise<void> {
  const effectiveClock: Clock = clock ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };

  return function sleep(duration: string): Promise<void> {
    const ms = parseDuration(duration);

    return new Promise<void>((resolve, reject) => {
      // processYield in session.ts handles the actual sleep; deferred just resolves the Promise
      pushYield({
        kind: 'sleep',
        args: [duration, ms],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
