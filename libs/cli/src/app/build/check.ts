/**
 * Project-app **programmatic-check aggregator** (Phase 2 of the durability fix).
 *
 * {@link runProjectAppCheck} is the host-side app check — reached from a tasklist CODE
 * node via `ctx.buildProjectApp()` (the `build_live_project` verify step) and over HTTP at
 * `POST .../app/check`. Its result type structurally mirrors `@lmthing/core`'s
 * `AppCheckResult` (`libs/core/src/db/types.ts`) EXACTLY so the two packages never have to
 * import each other's runtime.
 *
 * Three phases, cheapest-first, each short-circuiting the next:
 *   1. **typecheck** ({@link typecheckProjectApp}) — a real `tsc` program over the
 *      project's own legacy `pages/`/`components/`/`api/` sources. Non-empty ⇒ short-circuit:
 *      we never generate contracts or build known-broken code.
 *   2. **contract** ({@link checkProjectContracts}) — {@link generateProjectContracts}, the
 *      per-endpoint `ts-json-schema-generator` pass both transports and API handlers rely on.
 *      It turns failures into structured errors instead of leaking throws from the check API.
 *   3. **build** — a legacy TSX app runs {@link buildProjectPagesChecked}; a view-spec app mounts
 *      every view through the shared renderer, including its shell and layout chain.
 *
 * `ok` is zero errors across all phases. `built` means the served artifact exists: an esbuild
 * bundle for legacy pages, or a clean shared-renderer mount for an AppHost project.
 */

import { relative, sep } from 'node:path';

import { BaseError } from 'ts-json-schema-generator';

import { typecheckProjectApp } from './typecheck.js';
import { buildProjectPagesChecked } from './pages.js';
import { generateProjectContracts } from './contracts.js';
import { loadProjectViews, viewRoutePath } from '../view-spec/files.js';
import { renderSpecAppSmoke } from '../view-spec/validate.js';

// The check contract's SINGLE source of truth is `@lmthing/core`'s `AppCheckResult`;
// re-exported here as a type-only import (erased at build — no runtime coupling) so
// `typecheck.ts`/`pages.ts` share the exact same shape and can never drift.
export type { AppCheckError, AppCheckResult } from '@lmthing/core';
import type { AppCheckError, AppCheckResult } from '@lmthing/core';

/**
 * Build + programmatically check a project's live app: typecheck first (short-
 * circuiting on any type error — never bundle known-broken code), then contract
 * generation, then esbuild. Reached from a tasklist CODE node via `ctx.buildProjectApp()`
 * and over HTTP at `POST .../app/check`.
 */
export async function runProjectAppCheck(projectRoot: string): Promise<AppCheckResult> {
  const views = loadProjectViews(projectRoot).views;
  const isSpecApp = views.length > 0;
  const routes = isSpecApp ? views.map((view) => viewRoutePath(view.route)) : [];

  const tcErrors = await typecheckProjectApp(projectRoot, isSpecApp ? { sourceDirs: ['api'] } : undefined);
  if (tcErrors.length > 0) {
    return { ok: false, built: false, routes, errors: tcErrors };
  }

  const contractError = await checkProjectContracts(projectRoot);
  if (contractError) {
    return { ok: false, built: false, routes, errors: [contractError] };
  }

  if (isSpecApp) {
    const smoke = await renderSpecAppSmoke(projectRoot);
    return {
      ok: smoke.errorCount === 0,
      built: smoke.errorCount === 0,
      routes,
      errors: smoke.errors.map((error) => ({
        phase: 'build' as const,
        file: error.file ?? '(app)',
        message: error.message,
      })),
    };
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
    const contracts = await generateProjectContracts(projectRoot);
    /**
     * A per-endpoint schema failure no longer throws — `schema.ts#buildContract` degrades that ONE
     * endpoint to a permissive contract so a single unreadable handler cannot take the whole app
     * build down with it. The CHECK must stay honest about it: the degraded endpoint has lost its
     * ajv input validation and its derived form fields, and reporting nothing here would turn a
     * loud 400 into a silent half-working app. So the build survives and the gate still names the
     * offending endpoint.
     */
    const degraded = contracts.endpoints.find((ep) => ep.schemaError);
    if (degraded) {
      // `routePath` is the matcher form (`/jobs/:id`); the handler lives in the bracketed dir.
      const dir = degraded.routePath.replace(/\/:([A-Za-z0-9_]+)/g, '/[$1]');
      return {
        phase: 'contract',
        file: `api${dir}/${degraded.method}.ts`,
        message: `endpoint "${degraded.name}": ${degraded.schemaError}`,
      };
    }
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
