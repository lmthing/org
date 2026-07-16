/**
 * API **endpoint discovery** (Phase 3, 3A).
 *
 * Walks `<projectRoot>/api/`. Each `GET.ts`/`POST.ts`/`PUT.ts`/`PATCH.ts`/
 * `DELETE.ts` under a route directory is an endpoint: **the endpoint route is the
 * directory, the HTTP method is the filename**. The route pattern derives from
 * the dir path with `[id]` segments → `:id` params:
 *
 *   api/feed-list/GET.ts        → GET    /feed-list           (name "feedList")
 *   api/mark-read/POST.ts       → POST   /mark-read           (name "markRead")
 *   api/items/[id]/GET.ts       → GET    /items/:id           (name "getItem")
 *   api/items/[id]/PATCH.ts     → PATCH  /items/:id           (name "updateItem")
 *
 * Non-method `.ts` files in a route dir (helpers, `types.ts`) are **ignored**.
 * Each endpoint's `name` (from `export const name`) is the stable agent-facing
 * id; it is **unique per project** — a duplicate is a **fail-loud** throw.
 *
 * `name`/`description` are read by a light **static parse** (not by evaluating
 * the module) — deliberately: evaluating handler code in the main process would
 * breach the crash-boundary invariant, so discovery never runs handler code.
 */

import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

import type { HttpMethod } from './input.js';

/** The five HTTP methods the file-based router maps from a filename. */
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const METHOD_FILE_RE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

/** A single discovered endpoint. */
export interface Endpoint {
  /** The HTTP method (from the filename). */
  method: HttpMethod;
  /** The route pattern, `[id]` → `:id` (e.g. `/items/:id`; the api root is `/`). */
  pattern: string;
  /** Ordered dynamic-param names in the pattern (e.g. `['id']`). */
  paramNames: string[];
  /** Absolute path to the handler `.ts` file. */
  file: string;
  /** The stable agent-facing id (`export const name`) — unique per project. */
  name: string;
  /** Optional description (`export const description`). */
  description?: string;
}

/** The route table: endpoints indexed by `(method, pattern)` and by `name`. */
export interface RouteTable {
  endpoints: Endpoint[];
  /** Keyed `"<METHOD> <pattern>"` (e.g. `"GET /items/:id"`). */
  byMethodPattern: Map<string, Endpoint>;
  /** Keyed by the endpoint `name`. */
  byName: Map<string, Endpoint>;
}

/** The key for {@link RouteTable.byMethodPattern}. */
export function routeKey(method: string, pattern: string): string {
  return `${method} ${pattern}`;
}

/**
 * Discover every endpoint under `<projectRoot>/api/`. Returns an empty table when
 * there is no `api/` dir (a spaces-only or api-less project). Throws fail-loud on
 * a duplicate `name` or a method file missing `export const name`.
 */
export async function loadApiRoutes(projectRoot: string): Promise<RouteTable> {
  const apiDir = join(projectRoot, 'api');
  const endpoints: Endpoint[] = [];
  await walk(apiDir, [], endpoints);

  // Deterministic order — stable diagnostics + first-defined wins nothing (dups throw).
  endpoints.sort((a, b) => routeKey(a.method, a.pattern).localeCompare(routeKey(b.method, b.pattern)));

  const byMethodPattern = new Map<string, Endpoint>();
  const byName = new Map<string, Endpoint>();
  for (const ep of endpoints) {
    const key = routeKey(ep.method, ep.pattern);
    if (byMethodPattern.has(key)) {
      throw new Error(`[api-loader] duplicate route "${key}" (${ep.file})`);
    }
    byMethodPattern.set(key, ep);
    const existing = byName.get(ep.name);
    if (existing) {
      throw new Error(
        `[api-loader] duplicate endpoint name "${ep.name}" — ${existing.file} and ${ep.file}`,
      );
    }
    byName.set(ep.name, ep);
  }

  return { endpoints, byMethodPattern, byName };
}

/** Recursively collect method files, tracking the route segments so far. */
async function walk(dir: string, segments: string[], out: Endpoint[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // no api/ dir
    throw err;
  }

  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, [...segments, entry.name], out);
      continue;
    }
    if (!entry.isFile()) continue;
    const m = METHOD_FILE_RE.exec(entry.name);
    if (!m) continue; // ignore non-method .ts (helpers/types) and other files
    const method = m[1] as HttpMethod;
    const { pattern, paramNames } = patternFromSegments(segments);
    const source = await readFile(abs, 'utf8');
    const contractErr = apiEndpointContractError(source);
    if (contractErr) {
      throw new Error(`[api-loader] ${abs}: ${contractErr}`);
    }
    const name = parseExportedString(source, 'name')!;
    const description = parseExportedString(source, 'description');
    out.push({ method, pattern, paramNames, file: abs, name, description });
  }
}

/** Build a `/`-rooted route pattern (`[id]` → `:id`) + its param names. */
function patternFromSegments(segments: string[]): { pattern: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const parts = segments.map((seg) => {
    const dyn = /^\[(.+)\]$/.exec(seg);
    if (dyn) {
      paramNames.push(dyn[1]);
      return `:${dyn[1]}`;
    }
    return seg;
  });
  return { pattern: '/' + parts.join('/'), paramNames };
}

/**
 * Static-parse `export const <key> = '<value>'` (single/double/backtick quotes)
 * from handler source, without evaluating it. Returns `undefined` if absent.
 * Exported so the write-time lint can run the SAME name/uniqueness contract this loader enforces.
 */
export function parseExportedString(source: string, key: string): string | undefined {
  const re = new RegExp(`export\\s+const\\s+${key}\\s*=\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`);
  const m = re.exec(source);
  return m ? m[2] : undefined;
}

/**
 * The API-endpoint MODULE contract, as ONE reusable check shared by the loader `walk` (which wraps
 * the message with the file path) and the write-time lint. Static — never evaluates the module.
 * Returns a human message describing the first violation, or null when the source satisfies it.
 */
export function apiEndpointContractError(source: string): string | null {
  if (!parseExportedString(source, 'name')) {
    return 'missing `export const name` (every endpoint must be named)';
  }
  return null;
}

/**
 * Match a concrete request `path` against a method's routes. Returns the matched
 * endpoint + extracted path params (`Record<string, string>`), or `null`.
 */
export function matchRoute(
  table: RouteTable,
  method: string,
  path: string,
): { endpoint: Endpoint; params: Record<string, string> } | null {
  const reqSegs = splitPath(path);
  for (const ep of table.endpoints) {
    if (ep.method !== method) continue;
    const patSegs = splitPath(ep.pattern);
    if (patSegs.length !== reqSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      const p = patSegs[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(reqSegs[i]);
      else if (p !== reqSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { endpoint: ep, params };
  }
  return null;
}

/** Split a `/`-path into non-empty segments (the root `/` → `[]`). */
function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}
