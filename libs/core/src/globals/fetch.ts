import type { YieldRequest } from '../eval/yield.js';

export interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text(): string;
  json(): unknown;
}

/**
 * Create the `fetch` global. A real, non-blocking HTTP call — ends the current
 * turn and resumes once the host's actual `fetch()` (see `eval/fetch-yield.ts`)
 * settles. Replaces the old `execSync(curl ...)` primitive, which blocked the
 * single Node thread for the duration of every request (see
 * `system-spaces/DEVELOPMENT.md` §5 — "the big one").
 */
export function createFetchGlobal(
  pushYield: (req: YieldRequest) => void,
): (url: string, opts?: FetchOpts) => Promise<FetchResult> {
  return function fetch(url: string, opts?: FetchOpts): Promise<FetchResult> {
    return new Promise<FetchResult>((resolve, reject) => {
      pushYield({
        kind: 'fetch',
        args: [url, opts],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
