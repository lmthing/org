/**
 * Write-time lint for generated app artifacts.
 *
 * The typed writers (`writeProjectApi/Page/Hook/Component/Table` and the catalog twins) validate
 * parse + slug + column names today, but NOT the real loader/compiler CONTRACT — so a file the app
 * loader will later reject (an API endpoint with no `export const name`, a page with no default
 * export, a hook of the wrong shape, a schema with a dangling relation) is accepted at write time and
 * only fails downstream at compile/serve, with a confusing error far from the cause.
 *
 * These validators mirror the ACTUAL loader contracts by reusing the loaders' own functions
 * (`apiEndpointContractError`, `validateHook`, `validateSchemaSet`), so the lint can never drift from
 * what the app requires. Each returns a human message (the first violation) or null. The writer
 * throws a {@link LintError} on a non-null result, which the model sees as a retryable error and
 * fixes in place — like a typecheck failure. (Lives in `libs/cli` because it reuses the CLI loaders;
 * `@lmthing/core` must never import it.)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiEndpointContractError, parseExportedString } from '../api/loader.js';
import { evalHookDefaultFromSource } from '../hooks/loader.js';

/**
 * A write-time CONTRACT violation in generated content (not an fs/host failure). Writers re-throw
 * this past their catch-to-`{ok:false}`, so it surfaces to the model as a retryable error rather
 * than a swallowed `{ ok:false }` a node might ignore.
 */
export class LintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LintError';
  }
}

const HTTP_METHOD_FILE_RE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/** True when the source has a default export in any form the bundler/loader accepts. */
function hasDefaultExport(src: string): boolean {
  return /export\s+default\b/.test(src) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(src);
}

/**
 * The API-endpoint contract at write time: the loader's own `export const name` check
 * ({@link apiEndpointContractError}), a default/`handler` export (the runtime handler-module
 * contract, `api/handler-module.ts#loadHandlerFromCode`), and a project-unique name.
 */
export function lintApiHandler(src: string, opts: { existingNames?: Map<string, string> } = {}): string | null {
  const contractErr = apiEndpointContractError(src);
  if (contractErr) {
    return `api endpoint rejected (not saved): ${contractErr}. Add e.g. \`export const name = 'itemsList'\` and re-write.`;
  }
  const hasHandler =
    hasDefaultExport(src) ||
    /export\s+(?:async\s+)?function\s+handler\b/.test(src) ||
    /export\s+const\s+handler\b/.test(src);
  if (!hasHandler) {
    return (
      'api endpoint rejected (not saved): no request handler — an endpoint must `export default` a ' +
      'handler function (or `export function handler`). Add `export default async (req, ctx) => { … }` and re-write.'
    );
  }
  const name = parseExportedString(src, 'name');
  if (name && opts.existingNames) {
    const owner = opts.existingNames.get(name);
    if (owner) {
      return (
        `api endpoint rejected (not saved): the name "${name}" is already used by ${owner} — endpoint ` +
        'names are unique per project. Pick a different `export const name` (or edit that file).'
      );
    }
  }
  return null;
}

/** A page must default-export a component (else the page bundle has nothing to render). */
export function lintPageSource(src: string): string | null {
  if (!hasDefaultExport(src)) {
    return (
      'page rejected (not saved): no default export — a page must `export default` a React component. ' +
      'Add `export default function Page() { … }` and re-write.'
    );
  }
  return null;
}

/** A shared component must default-export the component an importing page renders. */
export function lintComponentSource(src: string): string | null {
  if (!hasDefaultExport(src)) {
    return (
      'component rejected (not saved): no default export — a component must `export default` its ' +
      'React component. Add `export default function <Name>() { … }` and re-write.'
    );
  }
  return null;
}

const HOOK_TYPES = new Set(['cron', 'event', 'webhook']);

/**
 * A hook's GROSS shape: `export default` must be a hook OBJECT with a known `type`. Evaluated with
 * the loader's OWN eval (so write-time sees exactly what load-time will), then a light shape check.
 *
 * Deliberately NOT the full `validateHook` (every/daily/on.event/trigger/handler): the hook LOADER
 * is fail-soft — a hook that fails those finer checks is skipped-with-warn at load, not fatal — so
 * making the finer shape a hard write-time throw would invert that design and could stall a build on
 * a detail the app tolerates. This catches the errors that are unambiguously broken (default is a
 * function/value, or an unknown/missing `type`) and leaves the fine shape to the fail-soft loader.
 */
export function lintHookSource(src: string, _slug: string, file: string): string | null {
  let raw: unknown;
  try {
    raw = evalHookDefaultFromSource(src, file);
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    return `hook rejected (not saved): the module failed to evaluate — ${first}. A hook must \`export default\` a plain object.`;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return (
      'hook rejected (not saved): `export default` must be a hook OBJECT ' +
      "(`{ type: 'cron' | 'event' | 'webhook', … }`), not a function or bare value. Re-write it as an object."
    );
  }
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !HOOK_TYPES.has(type)) {
    return (
      `hook rejected (not saved): the hook \`type\` must be one of ${[...HOOK_TYPES].map((t) => `'${t}'`).join(' | ')} ` +
      `(got ${JSON.stringify(type)}). Set e.g. \`type: 'cron'\` and re-write.`
    );
  }
  return null;
}

/** Scan `api/**` for the endpoint names already claimed → `Map<name, project-relative file>`. */
export function existingApiNames(projectRoot: string, excludeFile: string): Map<string, string> {
  const out = new Map<string, string>();
  const apiDir = join(projectRoot, 'api');
  if (!existsSync(apiDir)) return out;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !HTTP_METHOD_FILE_RE.test(entry.name) || abs === excludeFile) continue;
      try {
        const nm = parseExportedString(readFileSync(abs, 'utf8'), 'name');
        if (nm) out.set(nm, abs.slice(projectRoot.length + 1));
      } catch {
        /* unreadable sibling — skip */
      }
    }
  };
  try {
    walk(apiDir);
  } catch {
    /* no api dir */
  }
  return out;
}
