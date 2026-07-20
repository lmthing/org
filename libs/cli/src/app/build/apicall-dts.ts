/**
 * Build-time **typed `apiCall` surface** (Phase 4, typed-contract pipeline
 * consumer 3).
 *
 * Two artifacts, both pure data transforms over the {@link EndpointContract}s:
 *
 *  1. {@link buildApiCallDts} — the ambient DTS the integrator threads into the
 *     agent sandbox when the agent holds `api:call` (replacing/augmenting the
 *     generic `API_CALL_DTS` from `@lmthing/core`). Each known endpoint becomes
 *     a strictly-typed overload keyed on a string-literal `name`, so a malformed
 *     call (`apiCall('markRead', {})`) FAILS TYPECHECK inside the sandbox; a
 *     trailing generic overload keeps dynamic / not-yet-generated names compiling.
 *  2. {@link buildApiToolSignatures} — the model-facing callable-tool menu
 *     (`{ name, description, inputSchema, outputSchema }`), optionally filtered to
 *     the agent's `api:call` allow-list.
 */

import type { EndpointContract } from './schema.js';

/** The Phase-1 fallback overload: dynamic names still compile as `Promise<any>`. */
const GENERIC_OVERLOAD = 'declare function apiCall(name: string, input?: unknown): Promise<any>;';

/** Render a value as a TypeScript single-quoted string literal (escaped). */
function tsStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Emit the ambient DTS for `apiCall`: one string-literal-keyed overload per
 * endpoint using its `inputTsType`/`outputTsType`.
 *
 * `fallback` (default `true`) appends the generic `apiCall(name: string, input?: unknown)`
 * overload so dynamic / not-yet-generated names still compile. **For the agent sandbox
 * DTS the runtime passes `fallback: false`** — with the fallback present, a WRONG-typed
 * call to a KNOWN endpoint (`apiCall('markRead', { id: 123 })`) would resolve via the
 * generic overload and silently typecheck; omitting it makes both a bad name AND a bad
 * input a hard typecheck error, which is the whole point of the typed contract. Empty
 * `endpoints` → just the generic overload (`fallback:true`) or `''` (`fallback:false`).
 */
export function buildApiCallDts(endpoints: EndpointContract[], opts?: { fallback?: boolean }): string {
  const lines = endpoints.map(
    (ep) =>
      `declare function apiCall(name: ${tsStringLiteral(ep.name)}, input: ${ep.inputTsType}): Promise<${ep.outputTsType}>;`,
  );
  if (opts?.fallback !== false) lines.push(GENERIC_OVERLOAD);
  return lines.join('\n');
}

/** One endpoint as the CLIENT ambient needs it: its stable name and its route params. */
export interface ClientEndpoint {
  name: string;
  /** `[id]` route segments, e.g. `['id']`. Empty for a plain route. */
  paramNames: string[];
}

/**
 * Emit the `@app/runtime` data-hook declarations for a project's OWN endpoints.
 *
 * Two things the generic `useApi<T>(name: string, …)` signature cannot express, both of
 * which ship silently broken today:
 *
 *  1. **An endpoint name that does not exist.** `apiCall` throws `unknown endpoint` BEFORE
 *     any fetch (`../runtime/client.ts`), so the page renders its error branch with no
 *     network request at all — invisible to the bundler and to an HTTP probe. Typing `name`
 *     as a string-literal UNION makes it a typecheck error instead.
 *  2. **A `[id]` route called without its param.** The client stringifies the missing value,
 *     so the request goes to `/api/trips/undefined`, matches on segment count, passes ajv,
 *     and returns a wrong-but-plausible 200. A dedicated overload makes `input` REQUIRED for
 *     parameterized routes, with the param keys spelled out.
 *
 * The `T` type parameter is deliberately KEPT (defaulted, never constrained): pages author
 * `useApi<Alert[]>('listAlerts')`, and binding the return type to the endpoint's real
 * `Output` would reject every one of those call sites. Response-SHAPE agreement is enforced
 * on the writer side instead, against the endpoint contract.
 *
 * Returns `''` when the project has no endpoints — callers then keep the generic fallback
 * declarations, so an app that hasn't authored its `api/` yet still compiles.
 */
export function buildClientApiDts(endpoints: ClientEndpoint[]): string {
  if (endpoints.length === 0) return '';

  const named = [...endpoints].sort((a, b) => a.name.localeCompare(b.name));
  const withParams = named.filter((ep) => ep.paramNames.length > 0);
  const plain = named.filter((ep) => ep.paramNames.length === 0);

  const union = (list: ClientEndpoint[]): string =>
    list.map((ep) => tsStringLiteral(ep.name)).join(' | ');
  // `{ id: string; slug: string }` — every route param, all required.
  const paramsType = (ep: ClientEndpoint): string =>
    `{ ${ep.paramNames.map((p) => `${p}: string | number`).join('; ')}; [k: string]: unknown }`;

  const lines: string[] = [`  export type EndpointName = ${union(named)};`, ''];

  // Parameterized routes FIRST: overload resolution picks the most specific literal, so a
  // param route can never fall through to the optional-input overload below.
  for (const ep of withParams) {
    lines.push(
      `  export function useApi<T = unknown>(name: ${tsStringLiteral(ep.name)}, input: ${paramsType(ep)}, opts?: UseApiOptions): QueryResult<T>;`,
    );
  }
  if (plain.length > 0) {
    lines.push(
      `  export function useApi<T = unknown>(name: ${union(plain)}, input?: Record<string, unknown>, opts?: UseApiOptions): QueryResult<T>;`,
    );
  }
  lines.push('');
  lines.push(
    `  export function useApiMutation<T = unknown>(name: EndpointName, opts?: { invalidates?: EndpointName[] }): { mutate: (input?: Record<string, unknown>) => Promise<T>; isPending: boolean; error: HttpError | undefined };`,
  );
  for (const ep of withParams) {
    lines.push(
      `  export function apiCall(name: ${tsStringLiteral(ep.name)}, input: ${paramsType(ep)}): Promise<unknown>;`,
    );
  }
  if (plain.length > 0) {
    lines.push(
      `  export function apiCall(name: ${union(plain)}, input?: Record<string, unknown>): Promise<unknown>;`,
    );
  }
  return lines.join('\n');
}

/**
 * The model-facing signature for one callable endpoint. `description` seeds the
 * tool's docs; `inputSchema`/`outputSchema` are the endpoint's declared JSON
 * schemas.
 */
export interface ApiToolSignature {
  name: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
}

/**
 * Project the endpoint contracts into the agent's callable-tool menu. When
 * `allow` is provided, only endpoints whose `name` is in the list are surfaced
 * (the agent's `api:call` allow-list). Pure data transform — no compilation.
 */
export function buildApiToolSignatures(
  endpoints: EndpointContract[],
  allow?: string[],
): ApiToolSignature[] {
  const allowSet = allow ? new Set(allow) : null;
  return endpoints
    .filter((ep) => allowSet === null || allowSet.has(ep.name))
    .map((ep) => ({
      name: ep.name,
      description: ep.description,
      inputSchema: ep.inputSchema,
      outputSchema: ep.outputSchema,
    }));
}
