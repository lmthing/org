import { apiUrl } from '../../platform/api-base';
import { authHeaders } from './auth';

/**
 * JSON helpers for the pod's `/api/*` routes.
 *
 * These four functions existed twice — character for character in `Sidebar.tsx` and
 * `ProjectSettings.tsx` — which is exactly the shape a transport seam must not be added to twice.
 * They are one module now, and the only thing that changed is that the path goes through
 * {@link apiUrl}: identity on web, an absolute pod URL on native.
 *
 * The thrown message keeps the *path* rather than the resolved URL, so an error string reads the
 * same on both targets and no token-bearing origin leaks into a log.
 */

/**
 * A non-2xx answer, carrying the status alongside the unchanged message.
 *
 * The status is what lets a caller tell "that thing does not exist" (4xx — say so, offer a way on)
 * from "the pod is busy or waking" (5xx — say try again). Opening a conversation from a URL is the
 * first place that distinction became user-visible: both used to render the same dead end.
 */
export class ApiError extends Error {
  // Declared and assigned rather than a `readonly status` constructor parameter: parameter
  // properties are not erasable syntax, and this workspace compiles with `erasableSyntaxOnly`.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** True when the server said the thing is not there, as opposed to not available right now. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 400);
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path), { headers: authHeaders() });
  if (!r.ok) throw new ApiError(`GET ${path} → ${r.status}`, r.status);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(`POST ${path} → ${r.status}`, r.status);
  return r.json() as Promise<T>;
}

export async function apiPut(path: string, body: unknown): Promise<void> {
  const r = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiError(`PUT ${path} → ${r.status}`, r.status);
}

export async function apiDelete(path: string): Promise<void> {
  const r = await fetch(apiUrl(path), { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new ApiError(`DELETE ${path} → ${r.status}`, r.status);
}
