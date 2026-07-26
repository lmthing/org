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
export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path), { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function apiPut(path: string, body: unknown): Promise<void> {
  const r = await fetch(apiUrl(path), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PUT ${path} → ${r.status}`);
}

export async function apiDelete(path: string): Promise<void> {
  const r = await fetch(apiUrl(path), { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
}
