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
