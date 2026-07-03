/**
 * Client for the Studio **project-app management API** (Phase 8A).
 *
 * These endpoints live under the reserved top-level `/api/` on the compute pod
 * (NOT the app's own `/app/<project>/api/*`): manifest, data browser, app-file
 * editor, build status/rebuild, and manual hook runs. We reach the pod at
 * {@link COMPUTER_BASE_URL} and authenticate with the shared `authFetch`
 * (bearer token + 401-refresh retry) — the same token/refresh convention the
 * rest of Studio uses (`PodTransport`, `ThingDock`).
 *
 * Manifest shapes + pure path helpers live in {@link ./manifest} (import-free,
 * unit-tested) and are re-exported here for callers.
 */
import { useMemo } from 'react'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL } from '@/lib/config'
import type { AppManifest, AppHookRun, AppBuildStatus, DataPage } from './manifest'

export * from './manifest'

export interface AppApi {
  getManifest(signal?: AbortSignal): Promise<AppManifest>
  getData(
    table: string,
    opts?: { page?: number; pageSize?: number; signal?: AbortSignal },
  ): Promise<DataPage>
  patchRow(
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  readFile(path: string, signal?: AbortSignal): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  getBuild(signal?: AbortSignal): Promise<AppBuildStatus>
  rebuild(): Promise<AppBuildStatus>
  runHook(slug: string): Promise<AppHookRun>
}

/** Base for all management routes of a project. */
export function appApiBase(projectId: string): string {
  return `${COMPUTER_BASE_URL}/api/projects/${encodeURIComponent(projectId)}`
}

/**
 * Build an {@link AppApi} bound to `projectId`, using an `authFetch` that
 * attaches the bearer token and retries once on 401.
 */
export function createAppApi(
  projectId: string,
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
): AppApi {
  const base = appApiBase(projectId)

  async function req<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await authFetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = await res.text()
      } catch {
        /* ignore */
      }
      throw new Error(
        `${init?.method ?? 'GET'} ${url} failed: ${res.status}${detail ? ` — ${detail}` : ''}`,
      )
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    getManifest: (signal) => req<AppManifest>(`${base}/app`, { signal }),

    getData: (table, opts = {}) => {
      const params = new URLSearchParams()
      if (opts.page != null) params.set('page', String(opts.page))
      if (opts.pageSize != null) params.set('pageSize', String(opts.pageSize))
      const qs = params.toString()
      return req<DataPage>(
        `${base}/app/data/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`,
        { signal: opts.signal },
      )
    },

    patchRow: (table, id, patch) =>
      req<Record<string, unknown>>(
        `${base}/app/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      ),

    readFile: async (path, signal) => {
      const data = await req<{ content: string }>(
        `${base}/app/files/${encodePath(path)}`,
        { signal },
      )
      return data.content
    },

    writeFile: async (path, content) => {
      await req<{ ok?: boolean }>(`${base}/app/files/${encodePath(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      })
    },

    getBuild: (signal) => req<AppBuildStatus>(`${base}/app/build`, { signal }),

    rebuild: () => req<AppBuildStatus>(`${base}/app/build`, { method: 'POST' }),

    runHook: (slug) =>
      req<AppHookRun>(`${base}/hooks/${encodeURIComponent(slug)}/run`, {
        method: 'POST',
      }),
  }
}

/** Encode a slash-separated app-relative path segment-by-segment (keep the `/`s). */
function encodePath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
}

/** Hook: an {@link AppApi} bound to `projectId` and the current auth session. */
export function useAppApi(projectId: string): AppApi {
  const { authFetch } = useAuth()
  return useMemo(() => createAppApi(projectId, authFetch), [projectId, authFetch])
}
