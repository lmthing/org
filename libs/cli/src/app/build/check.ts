/**
 * Project-app **programmatic-check aggregator** (Phase 2 of the durability fix).
 *
 * {@link runProjectAppCheck} is what `libs/cli/src/server/session-manager.ts` binds
 * the agent-facing `buildApp()` global to (via `libs/core`'s `buildAppResolver` yield
 * seam — see `@lmthing/core`'s `AppBuildFn`/`AppCheckResult` in `libs/core/src/db/types.ts`,
 * which this module's exported types structurally mirror EXACTLY so the two packages
 * never have to import each other's runtime).
 *
 * Two phases, cheapest-first:
 *   1. **typecheck** ({@link typecheckProjectApp}) — a real `tsc` program over the
 *      project's own `pages/`/`components/`/`api/` sources. Non-empty ⇒ short-circuit:
 *      we never esbuild code that doesn't even typecheck (cheaper, and the errors are
 *      more precise than whatever esbuild would report on the same broken code).
 *   2. **build** ({@link buildProjectPagesChecked} in `./pages.js`) — the real esbuild
 *      bundle, with `BuildFailure`s captured as structured errors instead of thrown.
 *
 * `ok` is zero errors across both phases; `built` additionally requires the esbuild
 * bundle to have actually emitted (`index.html` on disk) — a type-clean project with
 * no `pages/` dir bundles nothing and is `ok:true, built:false, routes:[]`.
 */

import { typecheckProjectApp } from './typecheck.js';
import { buildProjectPagesChecked } from './pages.js';

// The check contract is the SINGLE source of truth in `@lmthing/core` (the `buildApp()`
// yield resolver is typed against it there); re-exported here as a type-only import (erased
// at build — no runtime coupling) so `typecheck.ts`/`pages.ts` share the exact same shape
// and can never drift from what the core `buildAppResolver` returns to the sandbox.
export type { AppCheckError, AppCheckResult } from '@lmthing/core';
import type { AppCheckResult } from '@lmthing/core';

/**
 * Build + programmatically check a project's live app: typecheck first (short-
 * circuiting on any type error — never bundle known-broken code), then esbuild.
 * This is what the agent-facing `buildApp()` global resolves to (bound to a
 * project root by `libs/cli/src/server/session-manager.ts`).
 */
export async function runProjectAppCheck(projectRoot: string): Promise<AppCheckResult> {
  const tcErrors = await typecheckProjectApp(projectRoot);
  if (tcErrors.length > 0) {
    return { ok: false, built: false, routes: [], errors: tcErrors };
  }

  const b = await buildProjectPagesChecked(projectRoot);
  return {
    ok: b.errors.length === 0,
    built: b.built && b.errors.length === 0,
    routes: b.routes,
    errors: b.errors,
  };
}
