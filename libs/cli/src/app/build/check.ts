/**
 * Project-app **programmatic-check aggregator** (Phase 2 of the durability fix).
 *
 * {@link runProjectAppCheck} is what `libs/cli/src/server/session-manager.ts` binds
 * the agent-facing `buildApp()` global to (via `libs/core`'s `buildAppResolver` yield
 * seam — see `@lmthing/core`'s `AppBuildFn`/`AppCheckResult` in `libs/core/src/db/types.ts`,
 * which this module's exported types structurally mirror EXACTLY so the two packages
 * never have to import each other's runtime).
 *
 * Three phases, cheapest-first, each short-circuiting the next:
 *   1. **typecheck** ({@link typecheckProjectApp}) — a real `tsc` program over the
 *      project's own `pages/`/`components/`/`api/` sources. Non-empty ⇒ short-circuit:
 *      we never generate contracts or esbuild code that doesn't even typecheck (cheaper,
 *      and the errors are more precise than whatever the later phases would report on the
 *      same broken code).
 *   2. **contract** ({@link checkProjectContracts}) — {@link generateProjectContracts}, the
 *      SAME per-endpoint `ts-json-schema-generator` pass `POST .../app/build` runs
 *      (`app/build/pages.ts#runBuild` → `app/build/schema.ts#generateAppTypes`). Until this
 *      phase existed, a contract-generation throw (e.g. an endpoint's `Output`/`Input` naming
 *      a global from `types/contract.d.ts` that doesn't resolve) propagated UNCAUGHT out of
 *      `runProjectAppCheck` — a clean `typecheck` phase does NOT prove this phase would also
 *      be clean, because `typecheck` runs ONE whole-program `tsc` pass with `contract.d.ts`
 *      as a root while `ts-json-schema-generator` builds its OWN program per handler file
 *      (`app/build/schema.ts#buildGeneratorConfig`). The agent-facing `buildApp()` global is
 *      documented to always resolve a structured `AppCheckResult`, never throw; this phase is
 *      what keeps that promise for a contract-generation failure the way phase 3 already did
 *      for an esbuild one.
 *   3. **build** ({@link buildProjectPagesChecked} in `./pages.js`) — the real esbuild
 *      bundle (which regenerates the same contracts as a side effect, now known-good), with
 *      `BuildFailure`s captured as structured errors instead of thrown.
 *
 * `ok` is zero errors across all three phases; `built` additionally requires the esbuild
 * bundle to have actually emitted (`index.html` on disk) — a type-clean project with
 * no `pages/` dir bundles nothing and is `ok:true, built:false, routes:[]`.
 */

import { relative, sep } from 'node:path';
import { BaseError } from 'ts-json-schema-generator';

import { typecheckProjectApp } from './typecheck.js';
import { buildProjectPagesChecked } from './pages.js';
import { generateProjectContracts } from './contracts.js';

// The check contract is the SINGLE source of truth in `@lmthing/core` (the `buildApp()`
// yield resolver is typed against it there); re-exported here as a type-only import (erased
// at build — no runtime coupling) so `typecheck.ts`/`pages.ts` share the exact same shape
// and can never drift from what the core `buildAppResolver` returns to the sandbox.
export type { AppCheckError, AppCheckResult } from '@lmthing/core';
import type { AppCheckError, AppCheckResult } from '@lmthing/core';

/**
 * Build + programmatically check a project's live app: typecheck first (short-
 * circuiting on any type error — never bundle known-broken code), then contract
 * generation, then esbuild. This is what the agent-facing `buildApp()` global
 * resolves to (bound to a project root by `libs/cli/src/server/session-manager.ts`).
 */
export async function runProjectAppCheck(projectRoot: string): Promise<AppCheckResult> {
  const tcErrors = await typecheckProjectApp(projectRoot);
  if (tcErrors.length > 0) {
    return { ok: false, built: false, routes: [], errors: tcErrors };
  }

  const contractError = await checkProjectContracts(projectRoot);
  if (contractError) {
    return { ok: false, built: false, routes: [], errors: [contractError] };
  }

  const b = await buildProjectPagesChecked(projectRoot);
  return {
    ok: b.errors.length === 0,
    built: b.built && b.errors.length === 0,
    routes: b.routes,
    errors: b.errors,
  };
}

/**
 * Run {@link generateProjectContracts} and convert a thrown failure into a structured
 * `phase:'contract'` {@link AppCheckError} instead of letting it propagate uncaught. `null`
 * on success (the generated contracts/dts are discarded here — `buildProjectPagesChecked`
 * regenerates them as part of the real build in phase 3).
 */
async function checkProjectContracts(projectRoot: string): Promise<AppCheckError | null> {
  try {
    await generateProjectContracts(projectRoot);
    return null;
  } catch (err) {
    return contractErrorToAppCheckError(err, projectRoot);
  }
}

/**
 * Map a contract-generation throw to a `phase:'contract'` {@link AppCheckError}.
 * `ts-json-schema-generator`'s own errors (`BaseError` and its subclasses — e.g. the
 * `UnhandledError` "Unhandled error while creating Base Type." a project with an unresolved
 * `Output`/`Input` name hits) carry a `diagnostic.file`/`diagnostic.start` when they have a
 * source location, giving a precise `file`/`line`/`column`, the same shape `typecheckProjectApp`
 * reports. Any other throw (a malformed `database/*.json`, an unreadable `api/` route) still
 * becomes a structured error rather than a raw exception, with a project-relative placeholder.
 */
function contractErrorToAppCheckError(err: unknown, projectRoot: string): AppCheckError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof BaseError && err.diagnostic.file) {
    const { file, start } = err.diagnostic;
    const pos = file.getLineAndCharacterOfPosition(start ?? 0);
    return {
      phase: 'contract',
      file: relative(projectRoot, file.fileName).split(sep).join('/'),
      line: pos.line + 1,
      column: pos.character + 1,
      message,
    };
  }
  return { phase: 'contract', file: '(project)', message };
}
