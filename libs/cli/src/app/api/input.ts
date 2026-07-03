/**
 * API **method-aware input assembly** (Phase 3).
 *
 * `Input` is ONE object. Where each field travels is derived from the HTTP
 * method + the route's dynamic segments, not declared per-field:
 *
 *   - **Path params (`[id]`) ALWAYS merge into `Input`** — and win on key clash.
 *   - `GET` / `DELETE` take the rest from the **query string**.
 *   - `POST` / `PATCH` / `PUT` take the rest from the **JSON body**.
 *
 * {@link assembleInput} builds that single object. Phase 4 swaps
 * {@link passThroughValidator} for an ajv-backed validator with
 * `coerceTypes: true`, which coerces the assembled Input (e.g. a GET's string
 * `unreadOnly=true` → boolean, a path-param string `:id` → number if the schema
 * says so). Until then everything — including path params — stays a string, and
 * {@link passThroughValidator} accepts the object unchanged.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Methods that read their non-path input from the query string. */
const QUERY_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'DELETE']);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Assemble the single {@link Input} object for a request.
 *
 * Merge order: start from the method's source — `query` for `GET`/`DELETE`, the
 * JSON `body` for `POST`/`PATCH`/`PUT` — then merge the path `params` on top so
 * **path always wins** on a key clash.
 *
 * A non-object body (a JSON array/primitive) for a body method is handled
 * **leniently**: the base becomes `{}` and only `params` merge on top. (This
 * keeps a stray `[]`/`"x"` payload from throwing here; the ajv validator in
 * Phase 4 rejects it against the declared `Input` shape with a typed 400.)
 */
export function assembleInput(
  method: HttpMethod,
  params: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = QUERY_METHODS.has(method)
    ? { ...query }
    : isPlainObject(body)
      ? { ...body }
      : {};
  // Path params always merge last → path wins on collision.
  return { ...base, ...params };
}

/**
 * The input-validation seam. Phase 3 ships {@link passThroughValidator}; Phase 4
 * swaps an ajv-backed implementation (`coerceTypes: true`) that returns the
 * coerced value on success or the ajv errors as `details` on failure.
 */
export type InputValidator = (
  input: Record<string, unknown>,
) => { ok: true; value: Record<string, unknown> } | { ok: false; details: unknown };

/**
 * Phase-3 pass-through validator: accepts every assembled Input unchanged. No
 * coercion — path-param strings stay strings until the ajv validator lands in
 * Phase 4.
 */
export const passThroughValidator: InputValidator = (input) => ({ ok: true, value: input });

/**
 * Parse a URL query string into a flat string map. Repeated keys are **last
 * wins** (`?a=1&a=2` → `{ a: '2' }`). Accepts a leading `?` or a bare search
 * string. Kept minimal for 3A's router; the ajv validator coerces types later.
 */
export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const [key, value] of params) out[key] = value; // iteration order → last wins
  return out;
}
