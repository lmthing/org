/**
 * `@app/runtime` — **browser client** (`apiCall` + api-base resolution).
 *
 * This is the bare, non-React data surface bundled into every page app. It has
 * NO node builtins and NO React import so it stays browser-only and cheaply
 * unit-testable.
 *
 * A page/agent addresses an endpoint by its stable **`name`**; the network layer
 * addresses it by **route** (`<METHOD> <routePath>`). The bridge is the injected
 * **endpoint manifest** — `name → { method, routePath }` — set on the window by
 * the generated page entry (`window.__APP_ENDPOINTS__`). {@link apiCall} looks up
 * the entry, fills `:param` segments from `input`, routes GET/DELETE remainders
 * to the query string and POST/PATCH/PUT remainders to the JSON body, and
 * `fetch`es `…/app/<project>/api<routePath>`.
 *
 * **Base resolution** — the identical build is served under several prefixes
 * (`localhost:8080/app/<project>/`, `lmthing.studio/app/<project>/`, and the
 * `/app`-stripped `lmthing.app/<project>/`). {@link resolveAppBase} derives the
 * `…/app/<project>` prefix from `window.location.pathname` at call time (so the
 * build stays prefix-agnostic); a `window.__APP_BASE__` override covers the
 * `/app`-stripped host where the prefix can't be recovered from the path alone.
 */

/** One endpoint's routing facts (from the generated `EndpointContract[]`). */
export interface EndpointManifestEntry {
  /** HTTP method — decides query-vs-body and GET/DELETE-vs-mutation semantics. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Route pattern with `:param` segments, e.g. `/items/:id`. */
  routePath: string;
}

/** The injected `name → routing` manifest (window global `__APP_ENDPOINTS__`). */
export type EndpointManifest = Record<string, EndpointManifestEntry>;

/** The `{ error }` body shape every api error response carries (mirrors the pod runtime). */
export interface HttpErrorBody {
  error: { status: number; message: string; details?: unknown };
}

/**
 * The error {@link apiCall} throws on a non-2xx response — the **one error shape**
 * shared across the browser client and the pod api runtime. `instanceof HttpError`
 * holds for callers that want to branch on it.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/** Read `window.__APP_ENDPOINTS__` (throws a helpful error if the entry never injected it). */
function manifest(): EndpointManifest {
  const m = (globalThis as { __APP_ENDPOINTS__?: EndpointManifest }).__APP_ENDPOINTS__;
  if (!m) throw new HttpError(500, 'endpoint manifest not injected (window.__APP_ENDPOINTS__)');
  return m;
}

function baseOverride(): string | undefined {
  const o = (globalThis as { __APP_BASE__?: string }).__APP_BASE__;
  return typeof o === 'string' && o.length > 0 ? o : undefined;
}

/**
 * Resolve the app's server root (`…/app/<project>`) from a pathname.
 *
 * Primary rule: the first `…/app/<project>` prefix in `pathname`. A
 * `window.__APP_BASE__` (or explicit `override`) wins — it covers the
 * `/app`-stripped host (`lmthing.app/<project>/…`) where the prefix isn't in the
 * path. Returns `''` when neither is available (relative-to-origin api calls).
 */
export function resolveAppBase(pathname: string, override?: string): string {
  const o = override ?? baseOverride();
  if (o) return o.replace(/\/+$/, '');
  const m = /^(.*?\/app\/[^/]+)/.exec(pathname);
  return m ? m[1] : '';
}

/** Fill a route pattern's `:param` segments from `input`; report which keys were consumed. */
function fillPath(
  routePath: string,
  input: Record<string, unknown>,
): { path: string; consumed: Set<string> } {
  const consumed = new Set<string>();
  const segs = routePath
    .split('/')
    .filter((s) => s.length > 0)
    .map((seg) => {
      if (seg.startsWith(':')) {
        const key = seg.slice(1);
        consumed.add(key);
        return encodeURIComponent(String(input[key]));
      }
      return seg;
    });
  // Root route → '' so the final url is `<base>/api` (no trailing slash).
  return { path: segs.length > 0 ? '/' + segs.join('/') : '', consumed };
}

/** Serialize the non-path remainder of `input` into a query string. */
function toQuery(input: Record<string, unknown>, consumed: Set<string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (consumed.has(k) || v === undefined || v === null) continue;
    params.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return params.toString();
}

function isQueryMethod(method: string): boolean {
  return method === 'GET' || method === 'DELETE';
}

/** Assemble the `{ method, url, init }` for an endpoint call — pure, unit-testable. */
export function buildRequest(
  entry: EndpointManifestEntry,
  input: Record<string, unknown>,
  base: string,
): { method: string; url: string; init: RequestInit } {
  const { path, consumed } = fillPath(entry.routePath, input);
  let url = `${base}/api${path}`;
  const init: RequestInit = { method: entry.method };
  if (isQueryMethod(entry.method)) {
    const qs = toQuery(input, consumed);
    if (qs) url += `?${qs}`;
  } else {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (!consumed.has(k)) body[k] = v;
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return { method: entry.method, url, init };
}

/**
 * Call a named endpoint. Resolves the api base from `window.location`, builds the
 * method-aware request, and returns the parsed JSON body. A non-2xx response is
 * thrown as an {@link HttpError} carrying the `{ error }` contract's status,
 * message and details.
 */
export async function apiCall(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const entry = manifest()[name];
  if (!entry) throw new HttpError(500, `unknown endpoint "${name}"`);

  const base = resolveAppBase(window.location.pathname);
  const { url, init } = buildRequest(entry, input, base);

  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as HttpErrorBody | undefined)?.error;
    throw new HttpError(err?.status ?? res.status, err?.message ?? 'request failed', err?.details);
  }
  return body;
}
