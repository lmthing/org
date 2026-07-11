/**
 * Pod-side {@link StoreResolver} for the agent-facing store globals (plan S10):
 * `storeSearch`/`storeInspect` read the public catalog via the route module's
 * {@link searchCatalog}/{@link inspectCatalogSpace} helpers, and `installSpace`
 * runs the SAME pure {@link installStoreSpace} the HTTP route uses (pristine-hash
 * divergence guard included).
 *
 * Division of labour with the core yield router (`installSpace` case):
 *   resolver.install → PURE install only (this module);
 *   router          → live-registers the installed dir (registerSpace mechanics)
 *                     then calls resolver.republish (→ `SessionManager.republish()`),
 * giving the exact order consent → install → register → republish. `onInstalled`
 * mirrors the HTTP route's callback (page-cache invalidation + the S8
 * `space.installed` signal) so both install paths have the same side effects.
 */

import type { StoreResolver, StoreInstallOutcome } from '@lmthing/core';
import { inspectCatalogSpace, installStoreSpace, searchCatalog } from './routes/store-spaces.js';

/** Configuration for {@link createStoreResolver} — one resolver per project. */
export interface StoreResolverConfig {
  /** The pod projects root (`.lmthing`). */
  root: string;
  /** The project installs land in (the session's project). */
  projectId: string;
  /** Store base override (tests / self-hosting). */
  storeUrl?: string;
  /** Re-derive the pod's published artifacts after an install — wire to
   *  `SessionManager.republish()`. Called by the CORE router AFTER live
   *  registration (never by `install` itself). */
  republish: () => Promise<void>;
  /** Post-install notification, mirroring the HTTP route's `onInstalled`
   *  (serve.ts invalidates the page-build cache + emits `space.installed`). */
  onInstalled?: (projectId: string, spaceId?: string) => void;
}

/** Build the per-project {@link StoreResolver} the SessionManager folds into
 *  `AppGlobalImpls.store` (threaded to the yield router like `callConnection`). */
export function createStoreResolver(cfg: StoreResolverConfig): StoreResolver {
  return {
    search: (query?: string) => searchCatalog(query, cfg.storeUrl),
    inspect: (spaceId: string) => inspectCatalogSpace(spaceId, cfg.storeUrl),
    install: async (spaceId: string): Promise<StoreInstallOutcome> => {
      const result = await installStoreSpace({
        lmthingRoot: cfg.root,
        spaceId,
        projectId: cfg.projectId,
        storeUrl: cfg.storeUrl,
        // NOTE: no `force` — the agent path always respects the divergence
        // guard; overwriting local edits stays a deliberate HTTP/UI action.
      });
      if (result.ok) {
        cfg.onInstalled?.(result.projectId, result.spaceId);
        return {
          ok: true,
          spaceId: result.spaceId,
          projectId: result.projectId,
          installedDir: result.installedDir,
        };
      }
      if (result.diverged === true) {
        return {
          ok: false,
          spaceId: result.spaceId,
          projectId: result.projectId,
          diverged: true,
          message: result.message,
        };
      }
      return { ok: false, spaceId, error: result.error };
    },
    republish: () => cfg.republish(),
  };
}
