import type { YieldRequest } from '../eval/yield.js';

/**
 * Store globals (plan S10) — the agent-facing surface of the lmthing store's
 * space catalog, following the `integrationStatus` value-yield pattern:
 *
 *   - `storeSearch(query?)`  — catalog entries matching `query` (all when omitted).
 *   - `storeInspect(spaceId)` — the full catalog entry for one space.
 *   - `installSpace(spaceId)` — install a catalog space into the CURRENT project
 *     and live-register it for `delegate()`. CONSENT-MARKED (see
 *     `globals/consent.ts` — the yield router runs the user-approval gate before
 *     the resolver executes; consumer #1 of the generic mechanism).
 *
 * Capability-gated at injection (`store:read` for the two readers,
 * `store:install` for the installer — see `exec/bootstrap.ts`), with matching
 * DTS fragments so an ungranted call fails typecheck. The host resolver
 * ({@link StoreResolver}) is supplied by libs/cli on `AppGlobalImpls.store`
 * (mirroring `callConnection`) and threaded through the yield router
 * (`YieldRouterContext.storeResolver`); absent ⇒ a clear, retryable error.
 *
 * Catalog entries pass through the resolver VERBATIM (S12 enriches them with
 * events/functions/agents — nothing here picks fields).
 */

/** The pod-side outcome of a store-space install ({@link StoreResolver.install}).
 *  `installedDir` (the absolute installed space dir) is present on success —
 *  the yield router live-registers it à la `registerSpace`. */
export interface StoreInstallOutcome {
  ok: boolean;
  spaceId: string;
  projectId?: string;
  /** Absolute path of the installed space dir (`<project>/spaces/<spaceId>`). */
  installedDir?: string;
  /** Local edits diverge from the store template — install held back. */
  diverged?: boolean;
  message?: string;
  error?: string;
}

/** Host resolver for the store globals — supplied by libs/cli (which knows the
 *  store URL + project root) on `AppGlobalImpls.store` and threaded through the
 *  yield router. Absent ⇒ store yields reject with a clear error. */
export interface StoreResolver {
  /** Catalog entries matching `query` (id/title/description/tags; all when
   *  omitted). Entries are returned verbatim (S12-enriched shape flows through). */
  search(query?: string): Promise<unknown[]>;
  /** The full catalog entry for `spaceId`, or `undefined` when not in the catalog. */
  inspect(spaceId: string): Promise<unknown>;
  /** Materialize the space into the current project (pristine-hash divergence
   *  guard applies). Pure install — live registration + republish are the yield
   *  router's job, so the order is consent → install → register → republish. */
  install(spaceId: string): Promise<StoreInstallOutcome>;
  /** Re-derive the pod's published artifacts (webhook manifest + crontab +
   *  emitter scan cache) after an install — `SessionManager.republish()`. */
  republish?(): Promise<void>;
}

/** The agent-facing resolution of `installSpace(spaceId)`. On success
 *  `spaceKey`/`agentSlug` identify the freshly live-registered space, ready for
 *  `delegate(spaceKey, agentSlug, …)` (same contract as `registerSpace`). */
export interface InstallSpaceResult {
  ok: boolean;
  spaceId: string;
  projectId?: string;
  /** delegate() key of the registered space (its installed dir path). */
  spaceKey?: string;
  /** Slug of the first agent found in the installed space. */
  agentSlug?: string;
  diverged?: boolean;
  message?: string;
  error?: string;
}

/** Create the `storeSearch` global — catalog search, gated on `store:read`. */
export function createStoreSearchGlobal(
  pushYield: (req: YieldRequest) => void,
): (query?: string) => Promise<unknown[]> {
  return function storeSearch(query?: string): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      pushYield({
        kind: 'storeSearch',
        args: [query],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}

/** Create the `storeInspect` global — one catalog entry, gated on `store:read`. */
export function createStoreInspectGlobal(
  pushYield: (req: YieldRequest) => void,
): (spaceId: string) => Promise<unknown> {
  return function storeInspect(spaceId: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      pushYield({
        kind: 'storeInspect',
        args: [spaceId],
        deferred: { resolve, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}

/** Create the `installSpace` global — consent-marked store install, gated on
 *  `store:install`. The consent gate runs HOST-side in the yield router (before
 *  the resolver), so nothing sandbox-side can skip it. */
export function createInstallSpaceGlobal(
  pushYield: (req: YieldRequest) => void,
): (spaceId: string) => Promise<InstallSpaceResult> {
  return function installSpace(spaceId: string): Promise<InstallSpaceResult> {
    return new Promise<InstallSpaceResult>((resolve, reject) => {
      pushYield({
        kind: 'installSpace',
        args: [spaceId],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
