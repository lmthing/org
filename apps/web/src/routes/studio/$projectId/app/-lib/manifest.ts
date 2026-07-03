/**
 * Project-app **manifest** shapes and pure path-derivation helpers (Phase 8A).
 *
 * Kept import-free (no React/auth/config) so it is node-safe and unit-testable
 * under the root vitest runner. {@link appApi} re-exports everything here.
 *
 * The exact response shapes are owned by 8A; the interfaces are intentionally
 * permissive (most fields optional) so the UI renders defensively against a
 * manifest that omits a section.
 */

export interface AppColumn {
  name: string
  type?: string
  description?: string
  primaryKey?: boolean
  required?: boolean
  unique?: boolean
  default?: unknown
  generated?: string
  references?: { table: string; column?: string; onDelete?: string }
}

export interface AppTable {
  name: string
  title?: string
  description?: string
  columns?: AppColumn[]
  /** Explicit source path, when the manifest provides it (`database/<t>.json`). */
  path?: string
}

export interface AppPage {
  /** Client route, e.g. `/` or `/items/:id`. */
  route: string
  /** Source path, e.g. `pages/items/[id].tsx`, when the manifest provides it. */
  path?: string
}

export interface AppEndpoint {
  name: string
  method: string
  /** HTTP route, e.g. `/api/items/:id`. */
  route?: string
  description?: string
  /** Human-readable I/O summaries when the manifest provides them. */
  input?: string
  output?: string
  /** Source path, e.g. `api/items/[id]/GET.ts`, when the manifest provides it. */
  path?: string
}

export interface AppHookRun {
  at?: number | string
  status?: string
  error?: string
  durationMs?: number
}

export interface AppHook {
  slug: string
  type?: string
  trigger?: string
  description?: string
  lastRun?: AppHookRun
  path?: string
}

export interface AppBuildStatus {
  status?: string
  ok?: boolean
  startedAt?: number | string
  finishedAt?: number | string
  error?: string
  hash?: string
}

export interface AppManifest {
  tables?: AppTable[]
  pages?: AppPage[]
  endpoints?: AppEndpoint[]
  hooks?: AppHook[]
  build?: AppBuildStatus
  /** `false` for a spaces-only project with no app layer. */
  hasApp?: boolean
}

export interface DataPage {
  rows: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
}

// ── Derived source paths (for the file tree) ─────────────────────────────────

/**
 * Best-effort source path for a page route when the manifest omits `path`.
 * `/` → `pages/index.tsx`; `/items/:id` → `pages/items/[id].tsx`.
 */
export function pagePath(page: AppPage): string {
  if (page.path) return page.path
  const route = page.route === '/' ? '/index' : page.route.replace(/\/$/, '')
  const segs = route
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s))
  return `pages/${segs.join('/')}.tsx`
}

/** Source path for an endpoint (`api/<route>/<METHOD>.ts`). */
export function endpointPath(ep: AppEndpoint): string {
  if (ep.path) return ep.path
  const route = (ep.route ?? '').replace(/^\/?(api\/)?/, '').replace(/\/$/, '')
  const segs = route
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s))
  return `api/${segs.join('/')}/${ep.method.toUpperCase()}.ts`
}

/** Source path for a hook (`hooks/<slug>.ts`). */
export function hookPath(hook: AppHook): string {
  return hook.path ?? `hooks/${hook.slug}.ts`
}

/** Source path for a table schema (`database/<table>.json`). */
export function tablePath(table: AppTable): string {
  return table.path ?? `database/${table.name}.json`
}

/**
 * Collect the editable app-file paths from a manifest (for the Files tree).
 * Excludes generated (`types/`) and runtime (`.data/`) trees, which the API
 * refuses to write anyway.
 */
export function manifestFilePaths(manifest: AppManifest): string[] {
  const paths = new Set<string>(['package.json'])
  for (const t of manifest.tables ?? []) paths.add(tablePath(t))
  for (const p of manifest.pages ?? []) paths.add(pagePath(p))
  for (const e of manifest.endpoints ?? []) paths.add(endpointPath(e))
  for (const h of manifest.hooks ?? []) paths.add(hookPath(h))
  return [...paths].sort()
}
