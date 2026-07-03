/**
 * `@app/runtime` — **React data hooks** (browser).
 *
 * A minimal hand-rolled query layer over {@link apiCall} (no external query lib):
 *
 *   - {@link useApi}`(name, input, opts?)` — a query hook for GET/DELETE reads.
 *     Fetches on mount and whenever `[name, JSON.stringify(input)]` changes;
 *     returns `{ data, error, isLoading, refetch }`. Each live query registers a
 *     refetch under `name` so a mutation can invalidate it.
 *   - {@link useApiMutation}`(name, { invalidates? })` — a mutation hook for
 *     POST/PATCH/PUT. `mutate(input)` resolves the `Output`; on success it
 *     re-fetches every live query named in `invalidates`.
 *
 * Invalidation is a tiny in-module registry (a `Set` of refetchers per query
 * `name`) — explicit and predictable, matching the spec's v1 `invalidates: []`
 * contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiCall, HttpError } from './client.js';

// ── Refetch registry (invalidation bus) ───────────────────────────────────────

const registry = new Map<string, Set<() => void>>();

function register(name: string, refetch: () => void): () => void {
  let set = registry.get(name);
  if (!set) {
    set = new Set();
    registry.set(name, set);
  }
  set.add(refetch);
  return () => {
    const s = registry.get(name);
    s?.delete(refetch);
    if (s && s.size === 0) registry.delete(name);
  };
}

/** Re-fetch every live {@link useApi} query registered under `name`. */
function invalidate(names: string[]): void {
  for (const name of names) {
    const set = registry.get(name);
    if (set) for (const refetch of set) refetch();
  }
}

// ── useApi ────────────────────────────────────────────────────────────────────

/** The state a {@link useApi} query exposes. */
export interface QueryResult<T> {
  data: T | undefined;
  error: HttpError | undefined;
  isLoading: boolean;
  refetch: () => void;
}

/** Options for {@link useApi}. */
export interface UseApiOptions {
  /** Skip fetching while `false` (e.g. until a param is known). Default `true`. */
  enabled?: boolean;
}

/**
 * Query an endpoint by `name`. Re-fetches when `[name, JSON.stringify(input)]`
 * changes; a stale in-flight response is discarded (last-write-wins) so rapid
 * input changes never flip `data` back.
 */
export function useApi<T = unknown>(
  name: string,
  input: Record<string, unknown> = {},
  opts: UseApiOptions = {},
): QueryResult<T> {
  const enabled = opts.enabled ?? true;
  const key = JSON.stringify(input ?? {});

  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<HttpError | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);

  // The active request id — a resolved response only commits if it is the latest.
  const reqId = useRef(0);

  const run = useCallback(() => {
    if (!enabled) return;
    const id = ++reqId.current;
    setIsLoading(true);
    setError(undefined);
    apiCall(name, JSON.parse(key) as Record<string, unknown>).then(
      (result) => {
        if (id !== reqId.current) return;
        setData(result as T);
        setIsLoading(false);
      },
      (err: unknown) => {
        if (id !== reqId.current) return;
        setError(err instanceof HttpError ? err : new HttpError(500, String(err)));
        setIsLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, enabled]);

  useEffect(() => {
    run();
  }, [run]);

  // Register for mutation-driven invalidation.
  useEffect(() => {
    if (!enabled) return;
    return register(name, run);
  }, [name, run, enabled]);

  return { data, error, isLoading, refetch: run };
}

// ── useApiMutation ────────────────────────────────────────────────────────────

/** Options for {@link useApiMutation}. */
export interface UseApiMutationOptions {
  /** Query `name`s to re-fetch after a successful mutation. */
  invalidates?: string[];
}

/** The state/handle a {@link useApiMutation} exposes. */
export interface MutationResult<T> {
  mutate: (input?: Record<string, unknown>) => Promise<T>;
  isPending: boolean;
  error: HttpError | undefined;
}

/**
 * Mutate via an endpoint (POST/PATCH/PUT). `mutate(input)` resolves the endpoint
 * `Output`; on success it invalidates (re-fetches) every live query named in
 * `invalidates`. A failed mutation stores + rethrows an {@link HttpError}.
 */
export function useApiMutation<T = unknown>(
  name: string,
  opts: UseApiMutationOptions = {},
): MutationResult<T> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<HttpError | undefined>(undefined);
  const invalidates = opts.invalidates ?? [];
  // Stable across renders without re-creating `mutate` on every array identity change.
  const invalidatesRef = useRef(invalidates);
  invalidatesRef.current = invalidates;

  const mutate = useCallback(
    async (input: Record<string, unknown> = {}): Promise<T> => {
      setIsPending(true);
      setError(undefined);
      try {
        const result = (await apiCall(name, input)) as T;
        invalidate(invalidatesRef.current);
        return result;
      } catch (err) {
        const httpErr = err instanceof HttpError ? err : new HttpError(500, String(err));
        setError(httpErr);
        throw httpErr;
      } finally {
        setIsPending(false);
      }
    },
    [name],
  );

  return { mutate, isPending, error };
}
